import hmac
import hashlib
import re
import asyncio
from typing import Any, Dict

from flask import Flask, request, jsonify

from config import BOT_TOKEN, TRAKTEER_WEBHOOK_SECRET
from utils import r, get_user_language, log_payment
from telegram import Bot

app = Flask(__name__)

# Bot Telegram untuk mengirim notifikasi ke user setelah donasi Trakteer.
bot: Bot | None = Bot(token=BOT_TOKEN) if BOT_TOKEN else None

# Event loop khusus untuk operasi async di dalam proses Flask (pytgram bot).
loop: asyncio.AbstractEventLoop | None = None
if bot is not None:
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)


def verify_trakteer_signature(raw_body: bytes) -> bool:
    """Memverifikasi signature webhook dari Trakteer (jika secret diset)."""
    secret = TRAKTEER_WEBHOOK_SECRET
    if not secret:
        # Jika tidak ada secret, lewati verifikasi (tidak direkomendasikan untuk production).
        return True

    signature = request.headers.get("X-Trakteer-Signature") or request.headers.get(
        "x-trakteer-signature"
    )
    if not signature:
        return False

    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def extract_amount(data: Dict[str, Any]) -> int:
    """Mengambil nominal donasi dari payload webhook."""
    for key in ("amount", "nominal", "price", "value"):
        if key in data:
            try:
                return int(data[key])
            except (TypeError, ValueError):
                continue
    return 0


def extract_message(data: Dict[str, Any]) -> str:
    """Mengambil pesan dukungan dari payload webhook."""
    for key in ("message", "note", "support_message", "supporter_message", "pesan"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def extract_user_id_from_message(message: str) -> int | None:
    """Mencari user_id dari pesan Trakteer.

    Prioritas:
    1. Pola "ID: <user_id>"
    2. Pola kode unik seperti "SC<user_id>-XXXX"
    3. Fallback: pesan yang isinya hanya angka (mis. "7446955510")
    """
    if not message:
        return None

    # 1) Pola eksplisit: "ID: 123456789"
    match = re.search(r"[Ii][Dd]\s*[:\-]?\s*(\d{5,15})", message)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            pass

    # 2) Pola kode unik: "SC<user_id>-ABCD"
    upper = message.upper()
    match = re.search(r"SC(\d{5,15})-[A-Z0-9]{1,8}", upper)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            pass

    # 3) Fallback: jika pesan hanya berisi angka 5–15 digit (misal "7446955510")
    stripped = message.strip()
    if re.fullmatch(r"\d{5,15}", stripped):
        try:
            return int(stripped)
        except ValueError:
            pass

    return None


@app.route("/trakteer/webhook", methods=["POST"])
def trakteer_webhook() -> Any:
    """Endpoint webhook untuk menerima notifikasi donasi dari Trakteer.

    Aturan:
    - Setiap Rp 1.000 = 1 hari premium.
    - User harus menulis pesan: `ID: <user_id_telegram>` di kolom pesan dukungan.
    """
    raw_body = request.get_data() or b""

    # Verifikasi signature jika secret diset
    if not verify_trakteer_signature(raw_body):
        return "invalid signature", 401

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return "invalid payload", 400

    amount = extract_amount(data)
    if amount <= 0:
        return jsonify({"status": "ignored", "reason": "no_amount"}), 200

    message = extract_message(data)
    user_id = extract_user_id_from_message(message)
    if not user_id:
        return jsonify({"status": "ignored", "reason": "no_user_id_in_message"}), 200

    # Hitung durasi premium dari nominal (Rp 1.000 = 1 hari)
    days = amount // 1000
    if days <= 0:
        return jsonify({"status": "ignored", "reason": "amount_below_minimum"}), 200

    # Perpanjang atau set premium di Redis
    key = f"user:{user_id}:premium"
    current_ttl = r.ttl(key)
    extra_seconds = days * 86400

    if current_ttl and current_ttl > 0:
        new_ttl = current_ttl + extra_seconds
    else:
        new_ttl = extra_seconds

    r.setex(key, new_ttl, "1")

    # Catat riwayat pembayaran Trakteer
    try:
        meta = {
            "transaction_id": data.get("transaction_id", ""),
            "supporter_name": data.get("supporter_name", ""),
        }
        log_payment(
            user_id=user_id,
            source="trakteer",
            amount=amount,
            days=days,
            wallet="TRAKTEER",
            code="",
            status="ok",
            admin_id=None,
            meta=meta,
        )
    except Exception:
        pass

    # Beri tahu user di Telegram (jika memungkinkan)
    if bot is not None and loop is not None:
        try:
            lang = get_user_language(user_id)
        except Exception:
            lang = "id"

        total_days_left = new_ttl // 86400

        if lang == "en":
            text = (
                "🎉 Thank you for supporting via Trakteer!\n\n"
                f"Your premium has been extended by {days} day(s).\n"
                f"Total remaining premium: {total_days_left} day(s).\n\n"
                "Use /setgender and /setinterest to set up your profile."
            )
        else:
            text = (
                "🎉 Terima kasih sudah mendukung via Trakteer!\n\n"
                f"Premium kamu bertambah {days} hari.\n"
                f"Total sisa premium: {total_days_left} hari.\n\n"
                "Gunakan /setgender dan /setinterest untuk mengatur profilmu."
            )

        try:
            # Jalankan send_message di event loop async.
            loop.run_until_complete(bot.send_message(chat_id=user_id, text=text))
        except Exception as exc:  # pragma: no cover - hanya logging sederhana
            print(f"Failed to notify user {user_id}: {exc}")

    return jsonify({"status": "ok", "user_id": user_id, "days_added": days}), 200


if __name__ == "__main__":
    # Jalankan server webhook di port 8000
    app.run(host="0.0.0.0", port=8000)