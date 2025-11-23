import re
import unicodedata
import time
import random
import string
import math
from typing import Optional, List
import redis
from config import (
    REDIS_URL,
    BAD_WORDS,
    DANGEROUS_EXTENSIONS,
    RATE_LIMIT_WINDOW,
    RATE_LIMIT_MAX_MSGS,
    AUTO_BAN_REPORTS,
    REPORT_WINDOW,
    MILD_SLANG_WORDS,
    TRUST_INITIAL,
    TRUST_HIGH_THRESHOLD,
    TRUST_NORMAL_THRESHOLD,
    TRUST_LOW_THRESHOLD,
    TRUST_PENALTY_PER_REPORT,
)

# Client Redis untuk koneksi lokal maupun production
r = redis.from_url(REDIS_URL, decode_responses=True)

TRUST_MIN = 0
TRUST_MAX = 100


def get_user_language(user_id: int) -> str:
    """Mengembalikan bahasa tampilan untuk user (id/en)."""
    lang = r.get(f"user:{user_id}:lang")
    return lang if lang in ("id", "en") else "id"


def set_user_language(user_id: int, lang: str) -> None:
    """Menyetel bahasa tampilan untuk user."""
    if lang not in ("id", "en"):
        lang = "id"
    r.set(f"user:{user_id}:lang", lang)

def normalize_text(text: str) -> str:
    """Menormalisasi teks untuk mendeteksi kata kasar yang di-obfuscate."""
    text = unicodedata.normalize("NFD", text)
    text = text.encode("ascii", "ignore").decode("utf-8")
    replacements = {"1": "i", "3": "e", "4": "a", "0": "o", "7": "t", "5": "s"}
    for k, v in replacements.items():
        text = text.replace(k, v)
    return text

def censor_text(text: str) -> str:
    """Menyensor kata-kata kasar dalam teks.

    Hanya kata dengan level kekasaran berat (BAD_WORDS) yang disensor.
    Kata-kata gaul kasar-sedang (MILD_SLANG_WORDS) dibiarkan.
    """
    if not text:
        return text
    words = text.split()
    censored: list[str] = []
    for word in words:
        clean = re.sub(r"[^a-zA-Z]", "", normalize_text(word).lower())
        if clean in BAD_WORDS:
            censored.append("*" * len(word))
        else:
            censored.append(word)
    return " ".join(censored)

def is_dangerous_file(filename: str) -> bool:
    """Memeriksa apakah nama file mengandung ekstensi berbahaya."""
    if not filename or "." not in filename:
        return False

    parts = filename.split(".")
    for part in parts[1:]:
        if f".{part.lower()}" in DANGEROUS_EXTENSIONS:
            return True
    return False

def is_rate_limited(user_id: int) -> bool:
    """Memeriksa apakah user sedang terkena rate limit pengiriman pesan."""
    key = f"rate:{user_id}"
    now = int(time.time())

    # Hapus entri yang sudah terlalu lama
    r.zremrangebyscore(key, 0, now - RATE_LIMIT_WINDOW)

    # Hitung jumlah pesan dalam window waktu
    count = r.zcard(key)
    if count >= RATE_LIMIT_MAX_MSGS:
        return True

    # Tambahkan timestamp saat ini
    r.zadd(key, {now: now})
    r.expire(key, RATE_LIMIT_WINDOW)
    return False

def is_search_cooldown(user_id: int, cooldown: int = 3) -> bool:
    """Memeriksa apakah user masih dalam cooldown untuk perintah /search."""
    key = f"cooldown:search:{user_id}"
    if r.exists(key):
        return True
    r.setex(key, cooldown, "1")
    return False

def generate_payment_code() -> str:
    """Menghasilkan kode pembayaran unik."""
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=8))

def create_payment_code(user_id: int, days: int, amount: int) -> str:
    """Membuat dan menyimpan kode pembayaran untuk user."""
    code = f"PAY-{generate_payment_code()}"
    key = f"payment:{code}"

    r.hset(
        key,
        mapping={
            "user_id": user_id,
            "days": days,
            "amount": amount,
            "created_at": int(time.time()),
        },
    )
    r.expire(key, 3600)  # Berlaku selama 1 jam

    return code

def verify_payment_code(code: str) -> Optional[dict]:
    """Memeriksa dan mengambil data kode pembayaran jika masih berlaku."""
    key = f"payment:{code}"
    if not r.exists(key):
        return None

    data = r.hgetall(key)
    if data:
        return {
            "user_id": int(data["user_id"]),
            "days": int(data["days"]),
            "amount": int(data["amount"]),
            "created_at": int(data["created_at"]),
        }
    return None

def delete_payment_code(code: str) -> None:
    """Menghapus kode pembayaran setelah diverifikasi."""
    key = f"payment:{code}"
    r.delete(key)

def get_trust_score(user_id: int) -> int:
    """Mengembalikan skor trust user dalam rentang 0–100."""
    raw = r.get(f"user:{user_id}:trust")
    if raw is None:
        return TRUST_INITIAL
    try:
        score = int(raw)
    except (TypeError, ValueError):
        score = TRUST_INITIAL
    if score < TRUST_MIN:
        score = TRUST_MIN
    if score > TRUST_MAX:
        score = TRUST_MAX
    return score


def set_trust_score(user_id: int, score: int) -> int:
    """Menyetel skor trust user (otomatis di-clamp ke 0–100)."""
    if score < TRUST_MIN:
        score = TRUST_MIN
    if score > TRUST_MAX:
        score = TRUST_MAX
    r.set(f"user:{user_id}:trust", score)
    return score


def update_trust(user_id: int, delta: int) -> int:
    """Mengubah skor trust user dengan delta tertentu."""
    current = get_trust_score(user_id)
    return set_trust_score(user_id, current + delta)


def get_trust_level(user_id: int) -> str:
    """Mengembalikan level trust user: high / normal / low / hell."""
    score = get_trust_score(user_id)
    if score >= TRUST_HIGH_THRESHOLD:
        return "high"
    if score >= TRUST_NORMAL_THRESHOLD:
        return "normal"
    if score >= TRUST_LOW_THRESHOLD:
        return "low"
    return "hell"


def add_report(user_id: int, reporter_id: int) -> int:
    """Menambahkan laporan untuk user, mengembalikan jumlah laporan 24 jam terakhir."""
    key = f"reports:{user_id}"
    now = int(time.time())

    # Hapus laporan yang lebih dari 24 jam
    r.zremrangebyscore(key, 0, now - REPORT_WINDOW)

    # Tambahkan laporan baru
    r.zadd(key, {reporter_id: now})
    r.expire(key, REPORT_WINDOW)

    # Kurangi skor trust user yang dilaporkan
    update_trust(user_id, -TRUST_PENALTY_PER_REPORT)

    # Kembalikan total laporan dalam periode
    return r.zcard(key)

def ban_user(user_id: int, reason: str = "Multiple reports") -> None:
    """Memblokir (ban) user dengan alasan tertentu."""
    r.set(f"user:{user_id}:banned", reason)

def is_banned(user_id: int) -> bool:
    """Memeriksa apakah user sedang diblokir (banned)."""
    return bool(r.exists(f"user:{user_id}:banned"))

def unban_user(user_id: int) -> None:
    """Membuka blokir (unban) user dan menghapus riwayat laporan."""
    r.delete(f"user:{user_id}:banned")
    r.delete(f"reports:{user_id}")

def get_active_users(hours: int = 24) -> List[int]:
    """Mengembalikan daftar user ID yang aktif dalam X jam terakhir."""
    key = "active_users"
    now = int(time.time())
    cutoff = now - (hours * 3600)

    user_ids = r.zrangebyscore(key, cutoff, now)
    return [int(uid) for uid in user_ids]

def update_user_activity(user_id: int) -> None:
    """Memperbarui waktu aktivitas terakhir user."""
    key = "active_users"
    now = int(time.time())
    r.zadd(key, {user_id: now})

def get_free_users() -> List[int]:
    """Mengembalikan daftar user aktif yang tidak memiliki premium."""
    active_users = get_active_users(24)
    free_users: List[int] = []

    for user_id in active_users:
        if not r.exists(f"user:{user_id}:premium"):
            free_users.append(user_id)

    return free_users

def get_user_stats(user_id: int) -> dict:
    """Mengembalikan statistik dasar untuk user tertentu."""
    stats = {
        "total_chats": int(r.get(f"stats:{user_id}:total_chats") or 0),
        "premium": bool(r.exists(f"user:{user_id}:premium")),
        "gender": r.get(f"user:{user_id}:gender") or "not_set",
        "interests": r.smembers(f"user:{user_id}:interests") or set(),
    }

    if stats["premium"]:
        ttl = r.ttl(f"user:{user_id}:premium")
        if ttl and ttl > 0:
            # Gunakan pembulatan ke atas agar 86399 detik tetap dianggap 1 hari.
            stats["premium_days_left"] = math.ceil(ttl / 86400)
        else:
            stats["premium_days_left"] = 0

    return stats


def increment_chat_count(user_id: int) -> None:
    """Menambah total jumlah obrolan untuk user."""
    key = f"stats:{user_id}:total_chats"
    r.incr(key)


def add_rating(user_id: int, rating: str) -> None:
    """Menambahkan rating untuk user (good/neutral/bad)."""
    if rating not in {"good", "neutral", "bad"}:
        return
    key = f"rating:{user_id}:{rating}"
    r.incr(key)


def get_global_stats() -> dict:
    """Mengembalikan statistik global untuk keperluan admin."""
    all_users = r.keys("user:*:premium") + r.keys("stats:*:total_chats")
    unique_users = set()

    for key in all_users:
        parts = key.split(":")
        if len(parts) >= 2 and parts[1].isdigit():
            unique_users.add(parts[1])

    active_sessions = len(r.keys("session:*"))
    queue_free = r.llen("queue:free")
    queue_premium_male = r.llen("queue:premium:male")
    queue_premium_female = r.llen("queue:premium:female")

    total_premium = len(r.keys("user:*:premium"))
    total_banned = len(r.keys("user:*:banned"))

    return {
        "total_users": len(unique_users),
        "active_sessions": active_sessions,
        "queue_waiting": queue_free + queue_premium_male + queue_premium_female,
        "total_premium": total_premium,
        "total_banned": total_banned,
    }
