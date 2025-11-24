import asyncio
import logging
import redis
import io
import time
import re
from datetime import datetime
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from PIL import Image
import pytesseract
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    ContextTypes,
    filters
)
from telegram.constants import ChatAction
from config import (
    BOT_TOKEN, REDIS_URL, ADMIN_IDS, 
    PREMIUM_PRICES, E_WALLET_NUMBER, E_WALLET_NAME,
    TRAKTEER_URL, AVAILABLE_INTERESTS, SEARCH_COOLDOWN,
    AUTO_BAN_REPORTS, PAYMENT_LOG_CHAT_ID
)
from utils import (
    censor_text,
    is_dangerous_file,
    is_rate_limited,
    is_banned,
    ban_user,
    unban_user,
    add_report,
    create_payment_code,
    verify_payment_code,
    delete_payment_code,
    get_active_users,
    get_free_users,
    update_user_activity,
    get_user_stats,
    increment_chat_count,
    get_global_stats,
    is_search_cooldown,
    get_user_language,
    set_user_language,
    get_trust_score,
    get_trust_level,
    add_rating,
    get_user_discount,
    assign_discount_to_user,
    get_discount_info,
    clear_user_discount,
    mark_discount_used,
    log_payment,
    get_payment_history,
    generate_payment_code,
    r,
)

# Setup logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Helper: mendapatkan pasangan obrolan anonim
def get_partner(user_id: int) -> int | None:
    session_key = r.get(f"user:{user_id}")
    if not session_key:
        return None
    user_a = r.hget(session_key, "user_a")
    user_b = r.hget(session_key, "user_b")
    if str(user_a) == str(user_id):
        return int(user_b) if user_b else None
    else:
        return int(user_a) if user_a else None

# Helper: kirim typing indicator
async def send_typing(context: ContextTypes.DEFAULT_TYPE, chat_id: int):
    """Mengirim indikator sedang mengetik ke chat tertentu."""
    try:
        await context.bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)
    except Exception:
        # Jika gagal (misalnya user blokir bot), cukup diabaikan
        pass

# Helper: kirim pesan ke pasangan dengan typing indicator
async def forward_to_partner(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    lang = get_user_language(user_id)

    # Update aktivitas user
    update_user_activity(user_id)

    if is_banned(user_id):
        if lang == "en":
            text = "❌ Your account is blocked. Use /appeal to request a review."
        else:
            text = "❌ Akunmu diblokir. Gunakan /appeal untuk mengajukan banding."
        await update.message.reply_text(text)
        return

    # Rate limiting
    if is_rate_limited(user_id):
        if lang == "en":
            text = "⚠️ You are sending messages too fast. Please wait a few seconds."
        else:
            text = "⚠️ Kamu mengirim pesan terlalu cepat. Tunggu beberapa detik."
        await update.message.reply_text(text)
        return
    
    partner_id = get_partner(user_id)
    if not partner_id:
        return
    
    message = update.message
    
    try:
        # Send typing indicator
        await send_typing(context, partner_id)
        
        if message.text:
            text = censor_text(message.text)
            await context.bot.send_message(chat_id=partner_id, text=text)
        elif message.photo:
            photo = message.photo[-1]
            caption = censor_text(message.caption) if message.caption else None
            await context.bot.send_photo(
                chat_id=partner_id,
                photo=photo.file_id,
                caption=caption
            )
        elif message.voice:
            await context.bot.send_voice(chat_id=partner_id, voice=message.voice.file_id)
        elif message.sticker:
            await context.bot.send_sticker(chat_id=partner_id, sticker=message.sticker.file_id)
        elif message.document:
            if is_dangerous_file(message.document.file_name):
                if lang == "en":
                    text = "❌ Dangerous files are not allowed."
                else:
                    text = "❌ File berbahaya tidak diizinkan."
                await message.reply_text(text)
                return
            caption = censor_text(message.caption) if message.caption else None
            await context.bot.send_document(
                chat_id=partner_id,
                document=message.document.file_id,
                caption=caption
            )
    except Exception as e:
        logger.warning(f"Gagal mengirim ke {partner_id}: {e}")
        if lang == "en":
            text = "⚠️ Your chat partner is no longer active. Type /search to find a new one."
        else:
            text = "⚠️ Pasanganmu tidak aktif. Ketik /search untuk cari yang baru."
        await message.reply_text(text)
        session_key = r.get(f"user:{user_id}")
        if session_key:
            r.delete(session_key)
            r.delete(f"user:{user_id}")

# --- COMMANDS ---
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    user_id = user.id
    lang = get_user_language(user_id)
    update_user_activity(user_id)

    if is_banned(user_id):
        if lang == "en":
            text = "❌ Your account is blocked. Use /appeal to request a review."
        else:
            text = "❌ Akunmu diblokir. Gunakan /appeal untuk mengajukan banding."
        await update.message.reply_text(text)
        return

    raw_name = user.first_name or user.username
    if lang == "en":
        name = raw_name or "there"
    else:
        name = raw_name or "kamu"

    text_id = f"""
👋 Hai, {name}!

Selamat datang di **ShadowChat** — tempat kamu bisa ngobrol **anonim** dengan orang baru ✨

🎯 **Cara pakai singkat:**
• `/search` — cari pasangan obrolan
• `/stop` — hentikan obrolan yang sedang berjalan
• `/next` — ganti ke pasangan berikutnya
• `/showid` — kirim link profil Telegram-mu ke partner
• `/report` — laporkan pengguna yang melanggar aturan

💎 **Pengen lebih terarah?**
Aktifkan premium untuk:
• Cari berdasarkan gender
• Cocokkan berdasarkan minat
• Prioritas dalam antrian
• Statistik obrolan yang lebih lengkap

⚠️ **Catatan penting:**
Jangan kirim konten ilegal, SARA, atau hal yang mengganggu pengguna lain.
Semua obrolan bersifat anonim — jaga sopan santun ya 😊

Siap ngobrol? Ketik `/search` sekarang!
"""

    text_en = f"""
👋 Hey, {name}!

Welcome to **ShadowChat** — an app for **anonymous** chats with new people ✨

🎯 **Quick guide:**
• `/search` — find a chat partner
• `/stop` — end the current chat
• `/next` — switch to the next partner
• `/showid` — share your Telegram profile with your partner
• `/report` — report users who break the rules

💎 **Want a better match?**
Get premium to:
• Search by gender
• Match based on interests
• Get priority in the queue
• See more detailed chat stats

⚠️ **Important:**
Do not send illegal, hateful, or harmful content.
All chats are anonymous — please be respectful 😊

Ready to chat? Type `/search` now!
"""

    text = text_en if lang == "en" else text_id
    await update.message.reply_text(text, parse_mode="Markdown")

async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await start(update, context)

async def premium_info(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    lang = get_user_language(user_id)
    update_user_activity(user_id)

    if is_banned(user_id):
        if lang == "en":
            text = "❌ Your account is blocked. Use /appeal to request a review."
        else:
            text = "❌ Akunmu diblokir. Gunakan /appeal untuk mengajukan banding."
        await update.message.reply_text(text)
        return

    # Kode unik untuk pembayaran via Trakteer (berisi user_id agar mudah dikenali)
    unique_code = f"SC{user_id}-{generate_payment_code()[:4]}"

    text_id = f"""
💎 **Fitur Premium ShadowChat**

Dengan premium, kamu bisa:
• 🔍 Cari berdasarkan jenis kelamin (`/search male` atau `/search female`)
• 🎯 Dipertemukan berdasarkan minat/hobi yang sama
• ⚡ Prioritas dalam antrian pencarian
• 📊 Melihat statistik obrolan yang lebih lengkap

💰 **Harga Premium:**
• Setiap Rp 1.000 = 1 hari premium
• Contoh: Rp 3.000 = 3 hari, Rp 7.000 = 7 hari, dan seterusnya.

📥 **Cara aktifkan:**

**Opsi 1: Trakteer (otomatis)**
• Klik tombol "Bayar via Trakteer"
• Di kolom pesan/ucapan dukungan, tulis salah satu:
  • `ID: {user_id}`
  • atau kode unik: `{unique_code}`
  (bot akan membaca ID/kode ini dan mengaktifkan premium secara otomatis)

**Opsi 2: Transfer manual**
• Gunakan tombol "Transfer manual"
• Ikuti instruksi dan kirim bukti transfer di chat ini
"""

    text_en = f"""
💎 **ShadowChat Premium Features**

With premium, you can:
• 🔍 Search by gender (`/search male` or `/search female`)
• 🎯 Be matched with people who share the same interests
• ⚡ Get priority in the search queue
• 📊 See more detailed chat statistics

💰 **Premium prices:**
• Every Rp 1.000 = 1 day of premium
• Example: Rp 3.000 = 3 days, Rp 7.000 = 7 days, and so on.

📥 **How to activate:**

**Option 1: Trakteer (automatic)**
• Tap the "Pay via Trakteer" button
• In the support message field, write either:
  • `ID: {user_id}`
  • or the unique code: `{unique_code}`
  (the bot will read this ID/code and automatically activate your premium)

**Option 2: Manual transfer**
• Use the "Manual transfer" button
• Follow the instructions and send your payment proof in this chat
"""

    text = text_en if lang == "en" else text_id

    keyboard = [
        [InlineKeyboardButton("💳 Bayar via Trakteer" if lang == "id" else "💳 Pay via Trakteer", url=TRAKTEER_URL)],
        [InlineKeyboardButton("📱 Transfer manual" if lang == "id" else "📱 Manual transfer", callback_data="payment_manual")],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    await update.message.reply_text(text, parse_mode="Markdown", reply_markup=reply_markup)


async def set_language_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Mengatur bahasa tampilan bot (Indonesia / Inggris)."""
    user_id = update.effective_user.id
    current_lang = get_user_language(user_id)

    # Jika user memberikan argumen, set langsung
    if context.args:
        choice = context.args[0].lower()
        if choice in ["id", "indo", "indonesia"]:
            lang = "id"
        elif choice in ["en", "eng", "english"]:
            lang = "en"
        else:
            if current_lang == "en":
                text = "Usage: /lang id | en"
            else:
                text = "Cara pakai: /lang id | en"
            await update.message.reply_text(text)
            return

        set_user_language(user_id, lang)
        if lang == "en":
            text = "✅ Language has been set to English."
        else:
            text = "✅ Bahasa telah diubah ke Bahasa Indonesia."
        await update.message.reply_text(text)
        return

    # Jika tanpa argumen, tampilkan pilihan dengan tombol
    if current_lang == "en":
        text = (
            "Choose the language you want to use:\n"
            "You can change it anytime using /lang."
        )
        btn_id = "Bahasa Indonesia"
        btn_en = "English (current)" if current_lang == "en" else "English"
    else:
        text = (
            "Pilih bahasa yang ingin kamu gunakan:\n"
            "Kamu bisa menggantinya kapan saja dengan /lang."
        )
        btn_id = "Bahasa Indonesia (saat ini)" if current_lang == "id" else "Bahasa Indonesia"
        btn_en = "English"

    keyboard = [
        [
            InlineKeyboardButton(btn_id, callback_data="lang_id"),
            InlineKeyboardButton(btn_en, callback_data="lang_en"),
        ]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text(text, reply_markup=reply_markup)


async def language_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Callback untuk pemilihan bahasa via tombol."""
    query = update.callback_query
    await query.answer()

    user_id = query.from_user.id
    if query.data == "lang_id":
        lang = "id"
    elif query.data == "lang_en":
        lang = "en"
    else:
        return

    set_user_language(user_id, lang)

    if lang == "en":
        text = (
            "✅ Language has been set to English.\n"
            "Type /start to see the updated menu."
        )
    else:
        text = (
            "✅ Bahasa telah diubah ke Bahasa Indonesia.\n"
            "Ketik /start untuk melihat menu yang sudah diperbarui."
        )

    await query.edit_message_text(text)


async def payment_manual_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Callback untuk pembayaran manual."""
    query = update.callback_query
    await query.answer()

    user_id = query.from_user.id
    lang = get_user_language(user_id)

    if lang == "en":
        text = """
📱 **Manual transfer**

Please choose the premium package/duration you want to purchase:

If you have a *discount code*, set it first using `/discount <code>`.

Note:
• Automatic verification is currently most stable for **DANA**.
• GoPay & OVO support is still under development — if it fails, don't worry. You can always use /paymanual and the admin will review your payment manually.
"""
    else:
        text = """
📱 **Transfer manual**

Silakan pilih paket/durasi premium yang ingin kamu beli:

Jika kamu punya *kode diskon*, set dulu dengan `/discount <kode>`.

Catatan:
• Verifikasi otomatis saat ini paling stabil untuk **DANA**.
• Dukungan GoPay & OVO masih dalam tahap pengembangan — kalau gagal, tidak usah khawatir. Kamu tetap bisa pakai /paymanual dan admin akan mengecek pembayaranmu secara manual.
"""

    keyboard = []
    for days, price in PREMIUM_PRICES.items():
        days_text_id = f"{days} hari" if days < 365 else "1 tahun"
        days_text_en = f"{days} days" if days < 365 else "1 year"
        label = days_text_en if lang == "en" else days_text_id
        keyboard.append(
            [
                InlineKeyboardButton(
                    f"{label} - Rp {price:,}",
                    callback_data=f"pay_{days}",
                )
            ]
        )

    reply_markup = InlineKeyboardMarkup(keyboard)
    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=reply_markup)

async def payment_duration_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Callback setelah user memilih durasi premium."""
    query = update.callback_query
    await query.answer()

    user_id = query.from_user.id
    lang = get_user_language(user_id)

    days = int(query.data.split("_")[1])
    base_amount = PREMIUM_PRICES[days]

    # Cek apakah user punya kode diskon aktif
    discount_code = get_user_discount(user_id)
    discount_info = get_discount_info(discount_code) if discount_code else None

    final_amount = base_amount
    discount_percent = 0
    if discount_info:
        discount_percent = discount_info["percent"]
        discount_value = base_amount * discount_percent // 100
        final_amount = max(base_amount - discount_value, 1000)

    # Generate payment code (sertakan kode diskon jika ada)
    code = create_payment_code(user_id, days, final_amount, discount_code=discount_info["code"] if discount_info else None)

    days_text_id = f"{days} hari" if days < 365 else "1 tahun"
    days_text_en = f"{days} days" if days < 365 else "1 year"

    if lang == "en":
        days_text = days_text_en
        parts = [
            "💳 **Payment instructions**",
            "",
            f"📦 Package: **{days_text}**",
        ]
        if discount_info:
            parts.extend(
                [
                    f"💰 Base price: ~~Rp {base_amount:,}~~",
                    f"🎁 Discount: {discount_percent}% (`{discount_info['code']}`)",
                    f"💰 **Final price to pay: Rp {final_amount:,}**",
                ]
            )
        else:
            parts.append(f"💰 Price: **Rp {final_amount:,}**")

        parts.extend(
            [
                "",
                "🔢 **PAYMENT CODE:**",
                f"`{code}`",
                "",
                "📤 **How to pay:**",
                "1. Transfer to one of these:",
                f"   • **GoPay:** {E_WALLET_NUMBER}",
                f"   • **OVO:** {E_WALLET_NUMBER}",
                f"   • **DANA:** {E_WALLET_NUMBER}",
                "",
                f"2. **IMPORTANT:** Put this code in the transfer note: `{code}`",
                "",
                "3. Take a screenshot of your payment",
                "",
                "4. Send the screenshot to this chat",
                "",
                "⏰ The code is valid for 1 hour.",
                "🤖 The bot will auto-verify after you send the screenshot.",
            ]
        )
        text = "\n".join(parts)
    else:
        days_text = days_text_id
        parts = [
            "💳 **Instruksi pembayaran**",
            "",
            f"📦 Paket: **{days_text}**",
        ]
        if discount_info:
            parts.extend(
                [
                    f"💰 Harga awal: ~~Rp {base_amount:,}~~",
                    f"🎁 Diskon: {discount_percent}% (`{discount_info['code']}`)",
                    f"💰 **Harga yang harus dibayar: Rp {final_amount:,}**",
                ]
            )
        else:
            parts.append(f"💰 Harga: **Rp {final_amount:,}**")

        parts.extend(
            [
                "",
                "🔢 **KODE PEMBAYARAN:**",
                f"`{code}`",
                "",
                "📤 **Cara bayar:**",
                "1. Transfer ke salah satu:",
                f"   • **GoPay:** {E_WALLET_NUMBER}",
                f"   • **OVO:** {E_WALLET_NUMBER}",
                f"   • **DANA:** {E_WALLET_NUMBER}",
                "",
                f"2. **PENTING:** Isi berita/catatan transfer dengan kode: `{code}`",
                "",
                "3. Screenshot bukti transfer",
                "",
                "4. Kirim screenshot ke chat ini",
                "",
                "⏰ Kode berlaku 1 jam.",
                "🤖 Bot akan auto-verify setelah kamu kirim screenshot.",
            ]
        )
        text = "\n".join(parts)

    await query.edit_message_text(text, parse_mode="Markdown")

async def verify_screenshot(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Verifikasi otomatis screenshot pembayaran manual menggunakan OCR (pytesseract).

    Alur:
    - Cari payment code aktif milik user (PAY-XXXX).
    - Jalankan OCR pada gambar untuk mencari KODE PEMBAYARAN di teks (misal di Catatan/Pesan).
    - Jika kode ditemukan -> anggap valid, aktifkan premium.
    - Jika gagal ditemukan -> simpan data gagal dan minta user pakai /paymanual untuk cek admin.

    Catatan:
    - Untuk akurasi terbaik, minta user mengisi kolom Catatan/Pesan dengan KODE PEMBAYARAN.
    - Contoh di DANA: bagian \"Catatan\" di detail transaksi.
    """
    if not update.message.photo:
        return

    user_id = update.effective_user.id
    lang = get_user_language(user_id)

    # Cari payment code yang masih aktif untuk user ini
    payment_keys = r.keys("payment:PAY-*")
    user_payment = None

    for key in payment_keys:
        data = r.hgetall(key)
        if data and int(data.get("user_id", 0)) == user_id:
            code = key.split(":")[1]
            user_payment = verify_payment_code(code)
            if user_payment:
                user_payment["code"] = code
                break

    if not user_payment:
        return

    code = user_payment["code"]
    amount = user_payment["amount"]
    days = user_payment["days"]
    discount_code = user_payment.get("discount_code") or ""

    # Beri tahu user bahwa verifikasi sedang diproses
    if lang == "en":
        wait_text = (
            "🔍 Verifying your payment...\n"
            "Please wait while the bot reads the details from your screenshot."
        )
    else:
        wait_text = (
            "🔍 Memverifikasi pembayaran...\n"
            "Tunggu sebentar, bot sedang membaca detail dari screenshot kamu."
        )
    await update.message.reply_text(wait_text)

    # Unduh gambar dengan resolusi tertinggi
    try:
        photo = update.message.photo[-1]
        file = await photo.get_file()
        image_bytes = await file.download_as_bytearray()
        image = Image.open(io.BytesIO(image_bytes))

        # Jalankan OCR (Indonesia + English)
        ocr_text = pytesseract.image_to_string(image, lang="ind+eng")
    except Exception as exc:
        logger.warning(f"OCR failed for user {user_id}: {exc}")
        ocr_text = ""

    # Normalisasi teks OCR untuk pencarian
    ocr_text_str = ocr_text if isinstance(ocr_text, str) else ""
    ocr_upper = ocr_text_str.upper()
    code_upper = code.upper()

    # Deteksi jenis e-wallet secara sederhana dari teks OCR
    wallet = "UNKNOWN"
    if "DANA" in ocr_upper:
        wallet = "DANA"
    elif "GOPAY" in ocr_upper or "GO-PAY" in ocr_upper or "GOJEK" in ocr_upper:
        wallet = "GOPAY"
    elif "OVO" in ocr_upper:
        wallet = "OVO"

    # Cek apakah kode pembayaran muncul di teks OCR
    code_found = code_upper in ocr_upper

    # Ekstrak nominal (yang diawali dengan "Rp") dari teks OCR per-baris, contoh:
    # "Rp150.000", "RP 7.000", dll. Kita simpan juga konteks barisnya agar bisa
    # membedakan:
    # - DANA   : gunakan nominal dengan label "TOTAL"/"TOTAL BAYAR"
    # - GOPAY  : gunakan nominal dengan label "JUMLAH"
    # - OVO    : gunakan nominal dengan label "NOMINAL TRANSFER"
    amount_matches: list[tuple[int, str]] = []
    try:
        lines = ocr_text_str.splitlines()
        for line in lines:
            line_upper = line.upper()
            for m in re.finditer(r"RP\s*([0-9][0-9\.\,]*)", line_upper):
                raw = m.group(1)
                cleaned = re.sub(r"[^0-9]", "", raw)
                if cleaned:
                    amt = int(cleaned)
                    amount_matches.append((amt, line_upper))
    except Exception as exc:
        logger.warning(f"Failed to parse amount from OCR for user {user_id}: {exc}")

    # Pilih kandidat nominal sesuai jenis e-wallet
    filtered_amounts: list[int] = []
    if wallet == "DANA":
        # Cari nominal yang barisnya mengandung "TOTAL" (Total Bayar)
        filtered_amounts = [amt for amt, line in amount_matches if "TOTAL" in line]
    elif wallet == "GOPAY":
        # Cari nominal yang barisnya mengandung label mirip "Jumlah".
        # OCR GoPay kadang membaca "Jumlah" sebagai "Jumiah", dll.
        # Hindari baris yang mengandung "BIAYA"/"ADMIN" agar tidak ambil biaya admin.
        filtered_amounts = [
            amt
            for amt, line in amount_matches
            if ("JUMLAH" in line or "JUMIAH" in line or "JUM" in line)
            and "BIAYA" not in line
            and "ADMIN" not in line
        ]
    elif wallet == "OVO":
        # Cari nominal yang barisnya mengandung "NOMINAL" dan "TRANSFER"
        filtered_amounts = [
            amt for amt, line in amount_matches if "NOMINAL" in line and "TRANSFER" in line
        ]

    if filtered_amounts:
        amount_candidates = set(filtered_amounts)
    else:
        # Jika tidak ditemukan label spesifik:
        # - Untuk GOPAY, abaikan baris yang mengandung BIAYA/ADMIN agar tidak mengambil biaya admin.
        # - Untuk yang lain, gunakan semua nominal yang terdeteksi.
        if wallet == "GOPAY":
            amount_candidates = {
                amt
                for amt, line in amount_matches
                if "BIAYA" not in line and "ADMIN" not in line
            }
        else:
            amount_candidates = {amt for amt, _ in amount_matches}

    amount_found = amount in amount_candidates

    # --- Verifikasi tanggal & waktu transaksi (opsional) ---
    # Kita coba baca tanggal dalam format: "10 Nov 2025", "09 Okt 2025", dll.
    # dan waktu "19:04", "12:50", dsb. Jika sukses, pastikan tidak terlalu jauh
    # dari waktu sekarang (± 72 jam). Jika parsing gagal, pengecekan tanggal
    # tidak menggagalkan verifikasi (hanya sebagai proteksi ekstra).
    transaction_ts = None
    try:
        month_map = {
            "JAN": 1,
            "JANUARI": 1,
            "FEB": 2,
            "FEBRUARI": 2,
            "MAR": 3,
            "MARET": 3,
            "APR": 4,
            "APRIL": 4,
            "MEI": 5,
            "JUN": 6,
            "JUNI": 6,
            "JUL": 7,
            "JULI": 7,
            "AGU": 8,
            "AGUSTUS": 8,
            "SEP": 9,
            "SEPT": 9,
            "SEPTEMBER": 9,
            "OKT": 10,
            "OKTOBER": 10,
            "NOV": 11,
            "NOVEMBER": 11,
            "DES": 12,
            "DESEMBER": 12,
        }
        # Izinkan spasi opsional antara bulan dan tahun, karena OCR kadang menghasilkan
        # "09 Nov2025" (tanpa spasi) atau "09Nov 2025".
        date_regex = (
            r"(\d{1,2})\s*("
            r"JAN|JANUARI|FEB|FEBRUARI|MAR|MARET|APR|APRIL|MEI|"
            r"JUN|JUNI|JUL|JULI|AGU|AGUSTUS|SEP|SEPT|SEPTEMBER|"
            r"OKT|OKTOBER|NOV|NOVEMBER|DES|DESEMBER"
            r")\s*(\d{4})"
        )
        date_match = re.search(date_regex, ocr_upper)
        time_match = re.search(r"(\d{1,2}):(\d{2})", ocr_upper)

        if date_match:
            day_str, mon_str, year_str = date_match.groups()
            day = int(day_str)
            year = int(year_str)
            month = month_map.get(mon_str, None)

            hour = 12
            minute = 0
            if time_match:
                hour = int(time_match.group(1))
                minute = int(time_match.group(2))

            if month is not None:
                dt = datetime(year, month, day, hour, minute)
                transaction_ts = dt.timestamp()
    except Exception as exc:
        logger.warning(f"Failed to parse date/time from OCR for user {user_id}: {exc}")
        transaction_ts = None

    date_time_valid = None
    if transaction_ts is not None:
        now_ts = time.time()
        diff_hours = abs(now_ts - transaction_ts) / 3600.0
        # Anggap valid jika selisih <= 72 jam dari sekarang.
        date_time_valid = diff_hours <= 72

    # Verifikasi hanya lolos jika KODE dan NOMINAL cocok.
    # Jika tanggal/waktu berhasil diparse dan jelas terlalu jauh dari sekarang,
    # maka verifikasi otomatis dianggap gagal.
    verification_ok = code_found and amount_found
    if date_time_valid is False:
        verification_ok = False

    # Siapkan ringkasan hasil OCR untuk dikirim ke grup log (jika diset)
    parsed_amounts_str = ",".join(str(x) for x in sorted(amount_candidates)) if amount_candidates else ""
    tx_info = "unknown"
    if transaction_ts is not None:
        tx_dt = datetime.fromtimestamp(transaction_ts)
        tx_info = tx_dt.strftime("%Y-%m-%d %H:%M")

    if PAYMENT_LOG_CHAT_ID:
        try:
            log_lines = [
                "🧾 *Log verifikasi pembayaran manual*",
                f"User ID: `{user_id}`",
                f"E-wallet: {wallet}",
                f"Kode: `{code}`",
                f"Amount expected: Rp {amount:,}",
                f"Days: {days}",
                f"Nominal parsed: {parsed_amounts_str or '-'}",
                f"Tanggal/waktu OCR: {tx_info}",
                f"Kode ditemukan: {code_found}",
                f"Amount cocok: {amount_found}",
                f"Date/time valid: {date_time_valid}",
                f"Hasil akhir: {'OK' if verification_ok else 'FAILED'}",
                "",
                "Cuplikan OCR:",
                (ocr_text_str or "")[:800],
            ]
            log_text = "\n".join(log_lines)
            await context.bot.send_message(
                chat_id=PAYMENT_LOG_CHAT_ID,
                text=log_text,
            )
        except Exception as exc:
            logger.warning(f"Failed to send payment OCR log to group: {exc}")

    if verification_ok:
        # Verifikasi berhasil -> aktifkan premium
        r.setex(f"user:{user_id}:premium", days * 86400, "1")
        delete_payment_code(code)

        # Jika pembayaran menggunakan kode diskon, tandai sebagai terpakai dan hapus dari user
        if discount_code:
            try:
                mark_discount_used(discount_code)
                clear_user_discount(user_id)
            except Exception:
                pass

        # Catat riwayat pembayaran manual (otomatis terverifikasi)
        try:
            log_payment(
                user_id=user_id,
                source="manual_auto",
                amount=amount,
                days=days,
                wallet=wallet,
                code=code,
                status="ok",
                admin_id=None,
                meta={"discount_code": discount_code} if discount_code else None,
            )
        except Exception:
            pass

        days_text_id = f"{days} hari" if days < 365 else "1 tahun"
        days_text_en = f"{days} days" if days < 365 else "1 year"

        if lang == "en":
            success_text = (
                f"✅ **Payment successful!**\n\n"
                f"Your premium is now active for {days_text_en}.\n"
                f"Use /setgender and /setinterest to set up your premium profile."
            )
        else:
            success_text = (
                f"✅ **Pembayaran berhasil!**\n\n"
                f"Premium aktif untuk {days_text_id}.\n"
                f"Gunakan /setgender dan /setinterest untuk mengatur profil premium-mu!"
            )

        await update.message.reply_text(success_text, parse_mode="Markdown")
        logger.info(
            f"Premium granted to {user_id} for {days} days via manual payment (code={code})"
        )
        return

    # Jika verifikasi otomatis gagal, simpan data untuk pengecekan manual
    failed_key = f"payment_failed:{user_id}"
    r.hset(
        failed_key,
        mapping={
            "code": code,
            "amount": amount,
            "days": days,
            "ocr_text": ocr_text or "",
            "photo_file_id": update.message.photo[-1].file_id,
            "timestamp": int(time.time()),
            "parsed_amounts": parsed_amounts_str,
            "wallet": wallet,
        },
    )
    r.expire(failed_key, 86400)  # Simpan 24 jam

    if lang == "en":
        fail_text = (
            "⚠️ The bot could not automatically verify your payment screenshot.\n\n"
            "Please make sure that the PAYMENT CODE (for example `PAY-XXXX`) is written in the "
            "Notes/Message field of your transfer.\n\n"
            "If you are sure everything is correct, type /paymanual so the admin can check it manually."
        )
        if wallet in ("GOPAY", "OVO"):
            fail_text += (
                "\n\nℹ️ Note: automatic verification for GoPay/OVO is still in development. "
                "Don't worry if this fails — you can still use these methods, and the admin will review "
                "your payment manually via /paymanual."
            )
    else:
        fail_text = (
            "⚠️ Bot belum bisa memverifikasi bukti pembayaran kamu secara otomatis.\n\n"
            "Pastikan **KODE PEMBAYARAN** (misalnya `PAY-XXXX`) ditulis di kolom Catatan/Pesan transaksi.\n\n"
            "Jika kamu yakin sudah benar, ketik /paymanual supaya admin bisa cek secara manual."
        )
        if wallet in ("GOPAY", "OVO"):
            fail_text += (
                "\n\nℹ️ Catatan: verifikasi otomatis untuk GoPay/OVO masih dalam tahap pengembangan. "
                "Jadi kalau gagal seperti ini tidak apa-apa. Kamu tetap bisa menggunakan metode ini dan "
                "admin akan mengecek secara manual lewat /paymanual."
            )

    await update.message.reply_text(fail_text, parse_mode="Markdown")
    logger.info(
        f"Manual payment verification FAILED for user {user_id}, code={code}, amount={amount}"
    )

    # Catat juga sebagai riwayat gagal (untuk debugging/admin)
    try:
        log_payment(
            user_id=user_id,
            source="manual_auto",
            amount=amount,
            days=days,
            wallet=wallet,
            code=code,
            status="failed",
            admin_id=None,
            meta={"reason": "ocr_failed"},
        )
    except Exception:
        pass

async def set_gender(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    lang = get_user_language(user_id)
    update_user_activity(user_id)

    if is_banned(user_id):
        if lang == "en":
            text = "❌ Your account is blocked. Use /appeal to request a review."
        else:
            text = "❌ Akunmu diblokir. Gunakan /appeal untuk mengajukan banding."
        await update.message.reply_text(text)
        return

    if not context.args:
        if lang == "en":
            text = "Usage: /setgender male | female | skip"
        else:
            text = "Cara pakai: /setgender male | female | skip"
        await update.message.reply_text(text)
        return

    gender = context.args[0].lower()
    if gender not in ["male", "female", "skip"]:
        if lang == "en":
            text = "Please choose: male, female, or skip."
        else:
            text = "Pilih salah satu: male, female, atau skip."
        await update.message.reply_text(text)
        return

    r.set(f"user:{user_id}:gender", gender if gender != "skip" else "")

    if lang == "en":
        text = f"✅ Your gender has been set to: {gender}"
    else:
        text = f"✅ Jenis kelaminmu diatur ke: {gender}"

    await update.message.reply_text(text)

async def set_interest(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Mengatur minat/hobi user untuk kebutuhan pencocokan."""
    user_id = update.effective_user.id
    lang = get_user_language(user_id)
    update_user_activity(user_id)

    if is_banned(user_id):
        if lang == "en":
            text = "❌ Your account is blocked."
        else:
            text = "❌ Akunmu diblokir."
        await update.message.reply_text(text)
        return

    if not context.args:
        interests_list = ", ".join(AVAILABLE_INTERESTS)
        if lang == "en":
            text = (
                f"**Available interests:**\n{interests_list}\n\n"
                f"**How to use:** /setinterest gaming music sports\n"
                f"(You can choose 1–3 interests)"
            )
        else:
            text = (
                f"**Minat yang tersedia:**\n{interests_list}\n\n"
                f"**Cara pakai:** /setinterest gaming music sports\n"
                f"(Kamu bisa memilih 1–3 minat)"
            )
        await update.message.reply_text(text, parse_mode="Markdown")
        return

    selected = [i.lower() for i in context.args if i.lower() in AVAILABLE_INTERESTS]

    if not selected:
        text = "❌ Invalid interest." if lang == "en" else "❌ Minat tidak valid."
        await update.message.reply_text(text)
        return

    if len(selected) > 3:
        text = "❌ Maximum 3 interests." if lang == "en" else "❌ Maksimal 3 minat."
        await update.message.reply_text(text)
        return

    # Simpan minat user
    key = f"user:{user_id}:interests"
    r.delete(key)
    for interest in selected:
        r.sadd(key, interest)

    if lang == "en":
        text = f"✅ Interests set to: {', '.join(selected)}"
    else:
        text = f"✅ Minat disetel: {', '.join(selected)}"

    await update.message.reply_text(text)

async def search(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    lang = get_user_language(user_id)
    update_user_activity(user_id)

    if is_banned(user_id):
        text = "❌ Your account is blocked." if lang == "en" else "❌ Akunmu diblokir."
        await update.message.reply_text(text)
        return

    if r.get(f"user:{user_id}"):
        if lang == "en":
            text = "ℹ️ You are already in a chat. Type /stop to leave first."
        else:
            text = "ℹ️ Kamu sudah dalam obrolan. Ketik /stop untuk keluar."
        await update.message.reply_text(text)
        return

    # Cooldown check
    if is_search_cooldown(user_id, SEARCH_COOLDOWN):
        if lang == "en":
            text = f"⏳ Please wait {SEARCH_COOLDOWN} seconds before searching again."
        else:
            text = f"⏳ Tunggu {SEARCH_COOLDOWN} detik sebelum mencari lagi."
        await update.message.reply_text(text)
        return

    # Trust level user (untuk menentukan queue)
    trust_level = get_trust_level(user_id)

    # User dengan trust level tertinggi (normal/high) menggunakan queue biasa,
    # sedangkan level "hell" hanya dipertemukan dengan sesama low-trust/hell.
    is_premium = r.exists(f"user:{user_id}:premium")
    user_gender = r.get(f"user:{user_id}:gender") or ""
    user_interests = r.smembers(f"user:{user_id}:interests")

    # Jika user sudah di level "hell", gunakan queue khusus spammer
    if trust_level == "hell":
        # Coba cari partner di queue hell
        partner_id = r.lpop("queue:hell")

        if partner_id:
            partner_id = int(partner_id)
            session_key = f"session:{user_id}:{partner_id}"
            r.hset(session_key, mapping={"user_a": user_id, "user_b": partner_id})
            r.set(f"user:{user_id}", session_key)
            r.set(f"user:{partner_id}", session_key)
            r.expire(session_key, 604800)

            increment_chat_count(user_id)
            increment_chat_count(partner_id)

            partner_interests = r.smembers(f"user:{partner_id}:interests")
            common = user_interests.intersection(partner_interests)

            if lang == "en":
                msg_user = "✅ You are connected!"
            else:
                msg_user = "✅ Terhubung!"

            partner_lang = get_user_language(partner_id)
            msg_partner = "✅ You are connected!" if partner_lang == "en" else "✅ Terhubung!"

            if common:
                common_str = ", ".join(common)
                if lang == "en":
                    msg_user += f"\n🎯 Shared interests: {common_str}"
                else:
                    msg_user += f"\n🎯 Minat sama: {common_str}"

                if partner_lang == "en":
                    msg_partner += f"\n🎯 Shared interests: {common_str}"
                else:
                    msg_partner += f"\n🎯 Minat sama: {common_str}"

            await update.message.reply_text(msg_user, parse_mode="Markdown")
            await context.bot.send_message(partner_id, msg_partner, parse_mode="Markdown")
        else:
            # Masukkan user ke queue khusus hell
            r.rpush("queue:hell", user_id)
            r.expire("queue:hell", 300)

            if lang == "en":
                text = (
                    "🔍 Searching for a partner...\n"
                    "Note: due to repeated reports, you may be matched with users who have a similar trust level.\n"
                    "Type /stop to cancel."
                )
            else:
                text = (
                    "🔍 Mencari pasangan...\n"
                    "Catatan: karena akunmu sering dilaporkan, kamu akan lebih sering dipertemukan dengan pengguna "
                    "dengan tingkat kepercayaan yang rendah.\n"
                    "Ketik /stop untuk batal."
                )
            await update.message.reply_text(text)
        return

    # --- Alur normal/premium (trust normal/high/low) ---

    target_queue = "queue:free"

    if is_premium and context.args:
        req = context.args[0].lower()
        if req in ["male", "female"]:
            if not user_gender:
                if lang == "en":
                    text = "⚠️ Set your gender first using /setgender."
                else:
                    text = "⚠️ Atur jenis kelaminmu dulu dengan /setgender."
                await update.message.reply_text(text)
                return
            target_queue = f"queue:premium:{req}"
        elif req == "any":
            target_queue = "queue:free"
        else:
            text = "Usage: /search [male|female|any]" if lang == "en" else "Cara pakai: /search [male|female|any]"
            await update.message.reply_text(text)
            return
    elif is_premium and user_gender:
        opposite = "female" if user_gender == "male" else "male"
        target_queue = f"queue:premium:{opposite}"
    elif not is_premium:
        if context.args:
            if lang == "en":
                text = "🔒 This feature is only for premium users. Type /premium for more info."
            else:
                text = "🔒 Fitur ini hanya untuk pengguna premium. Ketik /premium untuk info."
            await update.message.reply_text(text)
            return
        target_queue = "queue:free"

    # Try to find match di queue normal/premium
    partner_id = r.lpop(target_queue)

    if partner_id:
        partner_id = int(partner_id)
        session_key = f"session:{user_id}:{partner_id}"
        r.hset(session_key, mapping={"user_a": user_id, "user_b": partner_id})
        r.set(f"user:{user_id}", session_key)
        r.set(f"user:{partner_id}", session_key)
        r.expire(session_key, 604800)

        # Increment chat count
        increment_chat_count(user_id)
        increment_chat_count(partner_id)

        # Check common interests
        partner_interests = r.smembers(f"user:{partner_id}:interests")
        common = user_interests.intersection(partner_interests)

        if lang == "en":
            msg_user = "✅ You are connected!"
        else:
            msg_user = "✅ Terhubung!"

        # Partner language bisa berbeda
        partner_lang = get_user_language(partner_id)
        msg_partner = "✅ You are connected!" if partner_lang == "en" else "✅ Terhubung!"

        if common:
            common_str = ", ".join(common)
            if lang == "en":
                msg_user += f"\n🎯 Shared interests: {common_str}"
            else:
                msg_user += f"\n🎯 Minat sama: {common_str}"

            if partner_lang == "en":
                msg_partner += f"\n🎯 Shared interests: {common_str}"
            else:
                msg_partner += f"\n🎯 Minat sama: {common_str}"

        await update.message.reply_text(msg_user, parse_mode="Markdown")
        await context.bot.send_message(partner_id, msg_partner, parse_mode="Markdown")
    else:
        if is_premium and user_gender:
            r.rpush(f"queue:premium:{user_gender}", user_id)
            r.expire(f"queue:premium:{user_gender}", 300)
        else:
            r.rpush("queue:free", user_id)
            r.expire("queue:free", 300)

        if lang == "en":
            text = "🔍 Searching for a partner...\nType /stop to cancel."
        else:
            text = "🔍 Mencari pasangan...\nKetik /stop untuk batal."
        await update.message.reply_text(text)

async def _end_chat(update: Update, context: ContextTypes.DEFAULT_TYPE, mode: str) -> None:
    """Mengakhiri obrolan, dengan pesan berbeda untuk /stop dan /next, lalu minta rating/report."""
    user_id = update.effective_user.id
    lang = get_user_language(user_id)
    update_user_activity(user_id)

    if is_banned(user_id):
        text = "❌ Your account is blocked." if lang == "en" else "❌ Akunmu diblokir."
        await update.message.reply_text(text)
        return

    session_key = r.get(f"user:{user_id}")
    if not session_key:
        text = "ℹ️ You are not currently in a chat." if lang == "en" else "ℹ️ Kamu tidak sedang dalam obrolan."
        await update.message.reply_text(text)
        return

    partner_id = get_partner(user_id)
    r.delete(session_key)
    r.delete(f"user:{user_id}")

    # Beri tahu partner bahwa obrolan diakhiri oleh user
    if partner_id:
        r.delete(f"user:{partner_id}")
        try:
            partner_lang = get_user_language(partner_id)
            if partner_lang == "en":
                partner_text = (
                    "😕 Your chat partner has ended the conversation.\n\n"
                    "Don't worry, maybe the next one will be a better match 😉\n"
                    "Type /search to look for a new partner."
                )
            else:
                partner_text = (
                    "😕 Partner kamu baru saja mengakhiri obrolan.\n\n"
                    "Tenang, mungkin yang berikutnya lebih seru 😉\n"
                    "Ketik /search untuk mencari pasangan baru."
                )
            await context.bot.send_message(partner_id, partner_text)
        except Exception:
            pass

    # Pesan untuk user yang mengetik /stop atau /next
    if mode == "next":
        if lang == "en":
            text_user = (
                "⏭ You skipped this partner.\n\n"
                "Hopefully the next one will be a better match!\n"
                "Type /search again anytime to look for a new partner ✨"
            )
        else:
            text_user = (
                "⏭ Kamu melewati partner ini.\n\n"
                "Semoga partner berikutnya lebih cocok!\n"
                "Ketik /search lagi kapan saja kalau mau mencari pasangan baru ✨"
            )
    else:  # mode == "stop"
        if lang == "en":
            text_user = (
                "🛑 You ended this chat.\n\n"
                "No worries, not every conversation has to last forever 🙂\n"
                "If you want to talk to someone new, just type /search."
            )
        else:
            text_user = (
                "🛑 Kamu telah menghentikan obrolan ini.\n\n"
                "Tidak masalah, kadang obrolan memang cukup sampai di sini 🙂\n"
                "Kalau mau lanjut dengan orang baru, ketik saja /search."
            )

    await update.message.reply_text(text_user)

    # Kirim menu rating + report setelah obrolan berakhir
    if partner_id:
        if lang == "en":
            text_feedback = (
                "How was your chat experience?\n"
                "You can also report your partner if needed."
            )
            keyboard = [
                [
                    InlineKeyboardButton("👍 Good chat", callback_data=f"rate_good:{partner_id}"),
                    InlineKeyboardButton("😐 Just okay", callback_data=f"rate_neutral:{partner_id}"),
                    InlineKeyboardButton("👎 Not pleasant", callback_data=f"rate_bad:{partner_id}"),
                ],
                [
                    InlineKeyboardButton("🚨 Report this user", callback_data=f"report_menu:{partner_id}")
                ],
            ]
        else:
            text_feedback = (
                "Bagaimana pengalaman obrolan barusan?\n"
                "Kamu juga bisa melaporkan partner jika perlu."
            )
            keyboard = [
                [
                    InlineKeyboardButton("👍 Obrolan oke", callback_data=f"rate_good:{partner_id}"),
                    InlineKeyboardButton("😐 Biasa saja", callback_data=f"rate_neutral:{partner_id}"),
                    InlineKeyboardButton("👎 Tidak menyenangkan", callback_data=f"rate_bad:{partner_id}"),
                ],
                [
                    InlineKeyboardButton("🚨 Laporkan pengguna", callback_data=f"report_menu:{partner_id}")
                ],
            ]
        reply_markup = InlineKeyboardMarkup(keyboard)
        await update.message.reply_text(text_feedback, reply_markup=reply_markup)


async def stop(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await _end_chat(update, context, mode="stop")


async def skip(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await _end_chat(update, context, mode="next")

async def showid(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Mengirim link profil Telegram ke partner saat ini."""
    user_id = update.effective_user.id
    username = update.effective_user.username
    lang = get_user_language(user_id)

    if is_banned(user_id):
        text = "❌ Your account is blocked." if lang == "en" else "❌ Akunmu diblokir."
        await update.message.reply_text(text)
        return

    partner_id = get_partner(user_id)
    if not partner_id:
        text = "ℹ️ You are not currently in a chat." if lang == "en" else "ℹ️ Kamu tidak sedang dalam obrolan."
        await update.message.reply_text(text)
        return

    if username:
        profile_link = f"https://t.me/{username}"
        partner_lang = get_user_language(partner_id)

        if partner_lang == "en":
            text_partner = f"👤 Your chat partner wants to share their profile:\n{profile_link}"
        else:
            text_partner = f"👤 Partner ingin berbagi profil:\n{profile_link}"

        await context.bot.send_message(partner_id, text_partner)

        if lang == "en":
            text_user = "✅ Your profile link has been sent to your partner."
        else:
            text_user = "✅ Link profil terkirim ke partner!"
        await update.message.reply_text(text_user)
    else:
        if lang == "en":
            text = (
                "❌ You don't have a Telegram username set.\n"
                "Set your username first in Telegram settings."
            )
        else:
            text = (
                "❌ Kamu belum set username Telegram.\n"
                "Set username dulu di pengaturan (Settings) Telegram."
            )
        await update.message.reply_text(text)

def build_report_text_and_keyboard(lang: str, partner_id: int) -> tuple[str, InlineKeyboardMarkup]:
    """Membangun teks dan keyboard alasan laporan untuk seorang partner."""
    if lang == "en":
        text = (
            "Choose a reason to report this chat partner:\n\n"
            "Please only report if they clearly broke the rules."
        )
        keyboard = [
            [
                InlineKeyboardButton(
                    "🔞 Explicit sexual content", callback_data=f"rep_sex:{partner_id}"
                )
            ],
            [
                InlineKeyboardButton(
                    "🤬 Harsh language / bullying", callback_data=f"rep_abuse:{partner_id}"
                )
            ],
            [
                InlineKeyboardButton(
                    "🧨 Hate speech / discrimination", callback_data=f"rep_sara:{partner_id}"
                )
            ],
            [
                InlineKeyboardButton(
                    "📨 Spam / promotion", callback_data=f"rep_spam:{partner_id}"
                )
            ],
            [
                InlineKeyboardButton("Lainnya / Other", callback_data=f"rep_other:{partner_id}")
            ],
        ]
    else:
        text = (
            "Pilih alasan laporan untuk partner obrolan ini:\n\n"
            "Gunakan fitur ini hanya jika mereka jelas melanggar aturan."
        )
        keyboard = [
            [
                InlineKeyboardButton(
                    "🔞 Konten seksual berlebihan", callback_data=f"rep_sex:{partner_id}"
                )
            ],
            [
                InlineKeyboardButton(
                    "🤬 Kata-kata kasar / bullying", callback_data=f"rep_abuse:{partner_id}"
                )
            ],
            [
                InlineKeyboardButton(
                    "🧨 SARA / kebencian", callback_data=f"rep_sara:{partner_id}"
                )
            ],
            [
                InlineKeyboardButton(
                    "📨 Spam / promosi", callback_data=f"rep_spam:{partner_id}"
                )
            ],
            [
                InlineKeyboardButton("Lainnya", callback_data=f"rep_other:{partner_id}")
            ],
        ]
    return text, InlineKeyboardMarkup(keyboard)


async def report(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Memulai proses laporan selama masih dalam sesi chat (memunculkan menu alasan)."""
    user_id = update.effective_user.id
    lang = get_user_language(user_id)
    update_user_activity(user_id)

    if is_banned(user_id):
        text = "❌ Your account is blocked." if lang == "en" else "❌ Akunmu diblokir."
        await update.message.reply_text(text)
        return

    partner_id = get_partner(user_id)
    if not partner_id:
        text = (
            "ℹ️ You are not currently in a chat."
            if lang == "en"
            else "ℹ️ Kamu tidak sedang dalam obrolan."
        )
        await update.message.reply_text(text)
        return

    text, reply_markup = build_report_text_and_keyboard(lang, partner_id)
    await update.message.reply_text(text, reply_markup=reply_markup)


async def report_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Callback dari tombol 'Laporkan pengguna' setelah sesi berakhir."""
    query = update.callback_query
    await query.answer()

    user_id = query.from_user.id
    lang = get_user_language(user_id)

    data = query.data or ""
    parts = data.split(":", 1)
    if len(parts) != 2:
        return
    try:
        partner_id = int(parts[1])
    except ValueError:
        return

    text, reply_markup = build_report_text_and_keyboard(lang, partner_id)
    await query.edit_message_text(text, reply_markup=reply_markup)


async def report_reason_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Callback ketika user memilih salah satu alasan laporan."""
    query = update.callback_query
    await query.answer()

    user_id = query.from_user.id
    lang = get_user_language(user_id)

    data = query.data or ""
    parts = data.split(":", 1)
    if len(parts) != 2:
        return

    prefix = parts[0]  # contoh: "rep_sex"
    try:
        partner_id = int(parts[1])
    except ValueError:
        return

    reason_code = prefix.replace("rep_", "", 1)

    # Tambahkan laporan dan turunkan trust user yang dilaporkan
    report_count = add_report(partner_id, user_id)
    trust_score = get_trust_score(partner_id)
    trust_level = get_trust_level(partner_id)

    logger.info(
        f"LAPORAN: User {user_id} melaporkan {partner_id} "
        f"(reason={reason_code}, total={report_count}, trust={trust_score}, level={trust_level})"
    )

    # Logika auto-ban bertingkat:
    # - User yang sudah di level "hell" dan masih sering dilaporkan -> kandidat ban.
    # - Atau jika skor trust jatuh di bawah 0 (sangat sering dilaporkan).
    should_ban = False
    if trust_score <= 0:
        should_ban = True
    elif trust_level == "hell" and report_count >= AUTO_BAN_REPORTS:
        should_ban = True

    if should_ban:
        ban_user(partner_id, "Auto-ban: Too many reports / low trust")

        # Beri tahu admin
        for admin_id in ADMIN_IDS:
            try:
                admin_lang = get_user_language(admin_id)
                if admin_lang == "en":
                    admin_text = (
                        "🚨 **Auto-ban alert**\n"
                        f"User `{partner_id}` has been automatically banned.\n"
                        f"Reason: low trust score ({trust_score}), "
                        f"{report_count} reports in 24 hours, last reason: {reason_code}."
                    )
                else:
                    admin_text = (
                        "🚨 **Auto-Ban Alert**\n"
                        f"Pengguna `{partner_id}` telah di-ban otomatis.\n"
                        f"Alasan: skor trust rendah ({trust_score}), "
                        f"{report_count} laporan dalam 24 jam, alasan terakhir: {reason_code}."
                    )
                await context.bot.send_message(admin_id, admin_text, parse_mode="Markdown")
            except Exception:
                pass

        if lang == "en":
            text_user = (
                "✅ Thank you for your report.\n"
                "That user has been automatically blocked due to repeated reports."
            )
        else:
            text_user = (
                "✅ Terima kasih atas laporanmu.\n"
                "Pengguna tersebut telah diblokir otomatis karena sering dilaporkan."
            )
    else:
        if lang == "en":
            text_user = "✅ Thank you for your report. The admins will review it."
        else:
            text_user = "✅ Terima kasih atas laporanmu. Admin akan meninjau."

    # Edit pesan menu laporan menjadi pesan konfirmasi
    await query.edit_message_text(text_user)


async def rating_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Callback untuk rating setelah obrolan berakhir (👍 / 😐 / 👎)."""
    query = update.callback_query
    await query.answer()

    user_id = query.from_user.id
    lang = get_user_language(user_id)

    data = query.data or ""
    parts = data.split(":", 1)
    if len(parts) != 2:
        return

    prefix = parts[0]  # contoh: "rate_good"
    try:
        partner_id = int(parts[1])
    except ValueError:
        return

    rating_type = prefix.replace("rate_", "", 1)  # good / neutral / bad
    add_rating(partner_id, rating_type)

    logger.info(
        f"RATING: User {user_id} memberi rating {rating_type} untuk {partner_id}"
    )

    if lang == "en":
        text = "✅ Thanks for your feedback!"
    else:
        text = "✅ Terima kasih atas feedback-mu!"

    await query.edit_message_text(text)

async def stats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Menampilkan statistik dasar user."""
    user_id = update.effective_user.id
    lang = get_user_language(user_id)
    update_user_activity(user_id)

    if is_banned(user_id):
        text = "❌ Your account is blocked." if lang == "en" else "❌ Akunmu diblokir."
        await update.message.reply_text(text)
        return

    stats = get_user_stats(user_id)

    # Status premium
    if stats["premium"]:
        if lang == "en":
            premium_status = f"✅ Premium ({stats['premium_days_left']} days remaining)"
        else:
            premium_status = f"✅ Premium ({stats['premium_days_left']} hari tersisa)"
    else:
        premium_status = "❌ Free" if lang == "en" else "❌ Gratis"

    # Gender
    if stats["gender"] == "not_set":
        gender = "Not set" if lang == "en" else "Belum diatur"
    else:
        gender = stats["gender"]

    # Interests
    if stats["interests"]:
        interests = ", ".join(stats["interests"])
    else:
        interests = "Not set" if lang == "en" else "Belum diatur"

    if lang == "en":
        text = f"""
📊 **Your stats**

👤 **Status:** {premium_status}
🔢 **Total chats:** {stats['total_chats']}
⚥ **Gender:** {gender}
🎯 **Interests:** {interests}

Type /premium for upgrade info.
"""
    else:
        text = f"""
📊 **Statistik kamu**

👤 **Status:** {premium_status}
🔢 **Total obrolan:** {stats['total_chats']}
⚥ **Jenis kelamin:** {gender}
🎯 **Minat:** {interests}

Ketik /premium untuk info upgrade.
"""

    await update.message.reply_text(text, parse_mode="Markdown")

# --- ADMIN COMMANDS ---
async def grant_premium(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id not in ADMIN_IDS:
        return

    admin_lang = get_user_language(update.effective_user.id)

    if len(context.args) != 2:
        text = (
            "Usage: /grant_premium <user_id> <days>"
            if admin_lang == "en"
            else "Cara pakai: /grant_premium <user_id> <days>"
        )
        await update.message.reply_text(text)
        return

    try:
        user_id = int(context.args[0])
        days = int(context.args[1])
        r.setex(f"user:{user_id}:premium", days * 86400, "1")

        if admin_lang == "en":
            text_admin = f"✅ Premium has been granted to {user_id} for {days} days."
        else:
            text_admin = f"✅ Premium diberikan ke {user_id} untuk {days} hari."
        await update.message.reply_text(text_admin)

        try:
            user_lang = get_user_language(user_id)
            if user_lang == "en":
                text_user = (
                    f"🎉 Your premium is now active for {days} days!\n"
                    f"Use /setgender and /setinterest to set up your profile."
                )
            else:
                text_user = (
                    f"🎉 Premium kamu aktif untuk {days} hari!\n"
                    f"Gunakan /setgender dan /setinterest untuk mengatur profilmu."
                )
            await context.bot.send_message(user_id, text_user, parse_mode="Markdown")
        except Exception:
            pass
    except ValueError:
        text = "User ID and days must be numbers." if admin_lang == "en" else "ID dan hari harus angka."
        await update.message.reply_text(text)

async def gift_premium(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Memberikan premium ke sejumlah pengguna acak (admin only)."""
    if update.effective_user.id not in ADMIN_IDS:
        return

    admin_lang = get_user_language(update.effective_user.id)

    if len(context.args) != 2:
        text = (
            "Usage: /giftpremium <user_count> <days>"
            if admin_lang == "en"
            else "Cara pakai: /giftpremium <jumlah_user> <days>"
        )
        await update.message.reply_text(text)
        return

    try:
        count = int(context.args[0])
        days = int(context.args[1])

        # Ambil pengguna gratis yang aktif 24 jam terakhir
        free_users = get_free_users()

        if not free_users:
            text = (
                "❌ There are no active free users in the last 24 hours."
                if admin_lang == "en"
                else "❌ Tidak ada pengguna gratis yang aktif dalam 24 jam terakhir."
            )
            await update.message.reply_text(text)
            return

        # Pilih acak
        import random

        selected = random.sample(free_users, min(count, len(free_users)))

        success = 0
        for user_id in selected:
            try:
                r.setex(f"user:{user_id}:premium", days * 86400, "1")
                user_lang = get_user_language(user_id)
                if user_lang == "en":
                    text_user = (
                        f"🎁 **CONGRATULATIONS!**\n\n"
                        f"You have received **FREE premium** for {days} days!\n"
                        f"Use /setgender and /setinterest to set up your profile."
                    )
                else:
                    text_user = (
                        f"🎁 **SELAMAT!**\n\n"
                        f"Kamu mendapat premium **GRATIS** untuk {days} hari!\n"
                        f"Gunakan /setgender dan /setinterest untuk setup."
                    )
                await context.bot.send_message(user_id, text_user, parse_mode="Markdown")
                success += 1
            except Exception:
                pass

        if admin_lang == "en":
            text_admin = f"✅ Premium was given to {success}/{count} users for {days} days."
        else:
            text_admin = f"✅ Premium diberikan ke {success}/{count} pengguna untuk {days} hari."
        await update.message.reply_text(text_admin)

        logger.info(f"Admin {update.effective_user.id} gifted premium to {success} users")

    except ValueError:
        text = "User count and days must be numbers." if admin_lang == "en" else "Jumlah dan hari harus angka."
        await update.message.reply_text(text)


async def paymanual(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Meminta verifikasi manual ke admin untuk pembayaran yang gagal diverifikasi otomatis."""
    user_id = update.effective_user.id
    lang = get_user_language(user_id)
    update_user_activity(user_id)

    failed_key = f"payment_failed:{user_id}"
    data = r.hgetall(failed_key)

    if not data:
        if lang == "en":
            text = (
                "ℹ️ There is no pending payment that failed automatic verification.\n"
                "If you have already paid, please send your payment screenshot again."
            )
        else:
            text = (
                "ℹ️ Tidak ada pembayaran tertunda yang gagal diverifikasi otomatis.\n"
                "Jika kamu sudah membayar, kirim lagi screenshot bukti pembayaranmu."
            )
        await update.message.reply_text(text)
        return

    code = data.get("code", "")
    amount = int(data.get("amount", 0)) if data.get("amount") else 0
    days = int(data.get("days", 0)) if data.get("days") else 0
    ocr_text = data.get("ocr_text", "")
    photo_file_id = data.get("photo_file_id")
    wallet = data.get("wallet", "UNKNOWN")
    parsed_amounts = data.get("parsed_amounts", "")

    # Simpan data ini ke Redis sebagai item yang menunggu keputusan admin
    review_key = f"payment_review:{user_id}:{code}"
    review_mapping = {
        "user_id": user_id,
        "code": code,
        "amount": amount,
        "days": days,
        "ocr_text": ocr_text,
        "photo_file_id": photo_file_id or "",
        "wallet": wallet,
        "parsed_amounts": parsed_amounts,
    }
    r.hset(review_key, mapping=review_mapping)
    # Simpan maksimal 7 hari
    r.expire(review_key, 7 * 24 * 3600)

    # Kirim ke semua admin untuk dicek manual, lengkap dengan tombol Terima/Tolak
    for admin_id in ADMIN_IDS:
        try:
            admin_lang = get_user_language(admin_id)
        except Exception:
            admin_lang = "id"

        if admin_lang == "en":
            caption_lines = [
                "📩 Manual payment verification request",
                "",
                f"User ID: `{user_id}`",
                f"Payment code: `{code}`",
                f"Wallet: {wallet}",
                f"Expected amount: Rp {amount:,}",
                f"Days: {days}",
            ]
            if parsed_amounts:
                caption_lines.append(f"Detected amounts from OCR: {parsed_amounts}")
            caption_lines.extend(
                [
                    "",
                    "OCR text (for reference):",
                    ocr_text[:800],
                    "",
                    "Use the buttons below to *ACCEPT* or *REJECT* this payment.",
                ]
            )
            caption = "\n".join(caption_lines)
            btn_accept = "✅ Accept"
            btn_reject = "❌ Reject"
        else:
            caption_lines = [
                "📩 Permintaan verifikasi manual pembayaran",
                "",
                f"User ID: `{user_id}`",
                f"Kode pembayaran: `{code}`",
                f"E-wallet: {wallet}",
                f"Jumlah yang seharusnya: Rp {amount:,}",
                f"Durasi: {days} hari",
            ]
            if parsed_amounts:
                caption_lines.append(f"Nominal yang terdeteksi dari OCR: {parsed_amounts}")
            caption_lines.extend(
                [
                    "",
                    "Teks OCR (referensi):",
                    ocr_text[:800],
                    "",
                    "Gunakan tombol di bawah untuk *MENERIMA* atau *MENOLAK* pembayaran ini.",
                ]
            )
            caption = "\n".join(caption_lines)
            btn_accept = "✅ Terima"
            btn_reject = "❌ Tolak"

        keyboard = InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton(
                        btn_accept, callback_data=f"payreview_ok:{user_id}:{code}"
                    ),
                    InlineKeyboardButton(
                        btn_reject, callback_data=f"payreview_ng:{user_id}:{code}"
                    ),
                ]
            ]
        )

        try:
            if photo_file_id:
                await context.bot.send_photo(
                    chat_id=admin_id,
                    photo=photo_file_id,
                    caption=caption,
                    reply_markup=keyboard,
                )
            else:
                await context.bot.send_message(
                    chat_id=admin_id,
                    text=caption,
                    reply_markup=keyboard,
                )
        except Exception as exc:
            logger.warning(f"Gagal mengirim permintaan paymanual ke admin {admin_id}: {exc}")

    # Hapus data gagal agar tidak dikirim berkali-kali dari sisi user
    r.delete(failed_key)

    if lang == "en":
        text_user = (
            "✅ Your manual verification request has been sent to the admin.\n"
            "Please wait while they review your payment."
        )
    else:
        text_user = (
            "✅ Permintaan verifikasi manual sudah dikirim ke admin.\n"
            "Mohon tunggu, admin akan mengecek pembayaranmu."
        )
    await update.message.reply_text(text_user)


async def payreview_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Callback ketika admin menekan tombol Terima/Tolak pada permintaan paymanual."""
    query = update.callback_query
    await query.answer()

    admin_id = query.from_user.id
    if admin_id not in ADMIN_IDS:
        return

    data = query.data or ""
    parts = data.split(":", 2)
    if len(parts) != 3:
        return

    action = parts[0]  # payreview_ok / payreview_ng
    try:
        target_user_id = int(parts[1])
    except ValueError:
        return
    code = parts[2]

    review_key = f"payment_review:{target_user_id}:{code}"
    info = r.hgetall(review_key)
    if not info:
        # Sudah diproses atau data kadaluarsa
        admin_lang = get_user_language(admin_id)
        if admin_lang == "en":
            msg = "ℹ️ This payment has already been processed or the data is no longer available."
        else:
            msg = "ℹ️ Pembayaran ini sudah diproses atau datanya sudah tidak tersedia."
        await context.bot.send_message(chat_id=admin_id, text=msg)
        return

    amount = int(info.get("amount", 0)) if info.get("amount") else 0
    days = int(info.get("days", 0)) if info.get("days") else 0
    wallet = info.get("wallet", "UNKNOWN")

    # Cari info payment code (untuk mengetahui apakah ada diskon)
    discount_code = ""
    try:
        payment_info = verify_payment_code(code)
        if payment_info and payment_info.get("discount_code"):
            discount_code = payment_info["discount_code"]
    except Exception:
        discount_code = ""

    # Bersihkan key review agar tidak diproses dua kali
    r.delete(review_key)

    # Bahasa admin & user
    try:
        admin_lang = get_user_language(admin_id)
    except Exception:
        admin_lang = "id"

    try:
        user_lang = get_user_language(target_user_id)
    except Exception:
        user_lang = "id"

    if action == "payreview_ok":
        # Terima pembayaran: aktifkan premium dan hapus payment code
        try:
            r.setex(f"user:{target_user_id}:premium", days * 86400, "1")
            if code:
                delete_payment_code(code)
            # Jika ada kode diskon, tandai sebagai terpakai dan hapus dari user
            if discount_code:
                mark_discount_used(discount_code)
                clear_user_discount(target_user_id)
        except Exception as exc:
            logger.warning(f"Failed to grant premium in payreview for user {target_user_id}: {exc}")

        # Catat riwayat pembayaran manual (disetujui admin)
        try:
            log_payment(
                user_id=target_user_id,
                source="manual_admin",
                amount=amount,
                days=days,
                wallet=wallet,
                code=code,
                status="ok",
                admin_id=admin_id,
                meta={"discount_code": discount_code} if discount_code else None,
            )
        except Exception:
            pass

        # Beri tahu user
        if user_lang == "en":
            text_user = (
                f"🎉 Your manual payment has been *approved* by the admin.\n\n"
                f"Premium is now active for {days} day(s).\n"
                f"Use /setgender and /setinterest to set up your profile."
            )
        else:
            text_user = (
                f"🎉 Pembayaran manual kamu telah *disetujui* admin.\n\n"
                f"Premium sekarang aktif selama {days} hari.\n"
                f"Gunakan /setgender dan /setinterest untuk mengatur profilmu."
            )
        try:
            await context.bot.send_message(chat_id=target_user_id, text=text_user, parse_mode="Markdown")
        except Exception as exc:
            logger.warning(f"Failed to notify user {target_user_id} about approved payment: {exc}")

        # Beri tahu admin
        if admin_lang == "en":
            text_admin = (
                f"✅ Payment accepted.\n\n"
                f"User ID: `{target_user_id}`\n"
                f"Code: `{code}`\n"
                f"Wallet: {wallet}\n"
                f"Amount: Rp {amount:,}\n"
                f"Days: {days}"
            )
        else:
            text_admin = (
                f"✅ Pembayaran *disetujui*.\n\n"
                f"User ID: `{target_user_id}`\n"
                f"Kode: `{code}`\n"
                f"E-wallet: {wallet}\n"
                f"Jumlah: Rp {amount:,}\n"
                f"Durasi: {days} hari"
            )
    else:
        # Tolak pembayaran: tidak mengubah premium, hanya info ke user
        # Catat sebagai riwayat gagal / ditolak admin
        try:
            log_payment(
                user_id=target_user_id,
                source="manual_admin",
                amount=amount,
                days=days,
                wallet=wallet,
                code=code,
                status="rejected",
                admin_id=admin_id,
                meta={"discount_code": discount_code} if discount_code else None,
            )
        except Exception:
            pass

        if user_lang == "en":
            text_user = (
                "❌ Your manual payment could not be verified and was *rejected* by the admin.\n\n"
                "If you believe this is a mistake, please contact the admin or send a clearer screenshot."
            )
        else:
            text_user = (
                "❌ Pembayaran manual kamu *tidak dapat diverifikasi* dan telah *ditolak* admin.\n\n"
                "Jika kamu merasa ini keliru, silakan hubungi admin atau kirim ulang bukti pembayaran yang lebih jelas."
            )
        try:
            await context.bot.send_message(chat_id=target_user_id, text=text_user, parse_mode="Markdown")
        except Exception as exc:
            logger.warning(f"Failed to notify user {target_user_id} about rejected payment: {exc}")

        if admin_lang == "en":
            text_admin = (
                f"❌ Payment *rejected*.\n\n"
                f"User ID: `{target_user_id}`\n"
                f"Code: `{code}`\n"
                f"Wallet: {wallet}\n"
                f"Amount: Rp {amount:,}\n"
                f"Days: {days}"
            )
        else:
            text_admin = (
                f"❌ Pembayaran *ditolak*.\n\n"
                f"User ID: `{target_user_id}`\n"
                f"Kode: `{code}`\n"
                f"E-wallet: {wallet}\n"
                f"Jumlah: Rp {amount:,}\n"
                f"Durasi: {days} hari"
            )

    # Kirim konfirmasi ke admin (separate message agar tidak perlu edit caption/text)
    await context.bot.send_message(chat_id=admin_id, text=text_admin, parse_mode="Markdown")



async def create_discount(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Membuat kode diskon baru (admin only).

    Cara pakai:
    /creatediscount KODE PERSEN MAX_USES VALID_HOURS MIN_AMOUNT
    Contoh:
    /creatediscount DISKON50 50 10 72 7000
    """
    if update.effective_user.id not in ADMIN_IDS:
        return

    admin_lang = get_user_language(update.effective_user.id)

    if len(context.args) != 5:
        if admin_lang == "en":
            text = "Usage: /creatediscount <code> <percent> <max_uses> <valid_hours> <min_amount>"
        else:
            text = "Cara pakai: /creatediscount <kode> <persen> <max_uses> <valid_hours> <min_amount>"
        await update.message.reply_text(text)
        return

    raw_code = context.args[0]
    try:
        percent = int(context.args[1])
        max_uses = int(context.args[2])
        valid_hours = int(context.args[3])
        min_amount = int(context.args[4])
    except ValueError:
        if admin_lang == "en":
            text = "Percent, max_uses, valid_hours, and min_amount must be numbers."
        else:
            text = "Persen, max_uses, valid_hours, dan min_amount harus berupa angka."
        await update.message.reply_text(text)
        return

    try:
        info = create_discount_code(
            raw_code=raw_code,
            percent=percent,
            max_uses=max_uses,
            valid_hours=valid_hours,
            created_by=update.effective_user.id,
            min_amount=min_amount,
        )
    except ValueError as exc:
        await update.message.reply_text(str(exc))
        return

    code = info["code"]
    percent = info["percent"]
    max_uses = info["max_uses"]
    expire_at = info["expire_at"]
    min_amount = info.get("min_amount", 0)

    if expire_at > 0:
        dt = datetime.fromtimestamp(expire_at)
        expire_str = dt.strftime("%Y-%m-%d %H:%M")
    else:
        expire_str = "∞"

    if max_uses <= 0:
        uses_str = "∞"
    else:
        uses_str = str(max_uses)

    if admin_lang == "en":
        text = (
            f"✅ Discount code created.\n\n"
            f"Code: `{code}`\n"
            f"Percent: {percent}%\n"
            f"Max uses: {uses_str}\n"
            f"Min amount: Rp {min_amount:,}\n"
            f"Valid until: {expire_str}"
        )
    else:
        text = (
            f"✅ Kode diskon dibuat.\n\n"
            f"Kode: `{code}`\n"
            f"Diskon: {percent}%\n"
            f"Maks pemakaian: {uses_str}\n"
            f"Minimal harga paket: Rp {min_amount:,}\n"
            f"Berlaku sampai: {expire_str}"
        )
    await update.message.reply_text(text, parse_mode="Markdown")


async def apply_discount(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Dipakai user untuk memasang kode diskon ke akunnya: /discount KODE."""
    user_id = update.effective_user.id
    lang = get_user_language(user_id)
    update_user_activity(user_id)

    if is_banned(user_id):
        text = "❌ Your account is blocked." if lang == "en" else "❌ Akunmu diblokir."
        await update.message.reply_text(text)
        return

    if not context.args:
        if lang == "en":
            text = "Usage: /discount <code>"
        else:
            text = "Cara pakai: /discount <kode>"
        await update.message.reply_text(text)
        return

    raw_code = context.args[0]
    info = assign_discount_to_user(user_id, raw_code)
    if not info:
        if lang == "en":
            text = "❌ Invalid or expired discount code."
        else:
            text = "❌ Kode diskon tidak valid atau sudah kadaluarsa."
        await update.message.reply_text(text)
        return

    code = info["code"]
    percent = info["percent"]
    expire_at = info["expire_at"]
    min_amount = info.get("min_amount", 0)

    if expire_at > 0:
        dt = datetime.fromtimestamp(expire_at)
        expire_str = dt.strftime("%Y-%m-%d %H:%M")
    else:
        expire_str = "tidak terbatas" if lang != "en" else "unlimited"

    if lang == "en":
        text = (
            f"✅ Discount code applied: `{code}` ({percent}%).\n"
            f"You can now use manual payment with a lower price.\n"
            f"Valid until: {expire_str}.\n"
            f"Minimum package price to use this discount: Rp {min_amount:,}."
        )
    else:
        text = (
            f"✅ Kode diskon berhasil dipasang: `{code}` ({percent}%).\n"
            f"Sekarang kamu bisa bayar manual dengan harga lebih murah.\n"
            f"Berlaku sampai: {expire_str}.\n"
            f"Minimal harga paket untuk memakai diskon ini: Rp {min_amount:,}."
        )
    await update.message.reply_text(text, parse_mode="Markdown")


async def payhistory(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Menampilkan riwayat pembayaran user (admin only): /payhistory <user_id> [limit]."""
    if update.effective_user.id not in ADMIN_IDS:
        return

    admin_lang = get_user_language(update.effective_user.id)

    if not context.args:
        if admin_lang == "en":
            text = "Usage: /payhistory <user_id> [limit]"
        else:
            text = "Cara pakai: /payhistory <user_id> [limit]"
        await update.message.reply_text(text)
        return

    try:
        target_user_id = int(context.args[0])
    except ValueError:
        if admin_lang == "en":
            text = "User ID must be a number."
        else:
            text = "User ID harus berupa angka."
        await update.message.reply_text(text)
        return

    limit = 10
    if len(context.args) >= 2:
        try:
            limit = max(int(context.args[1]), 1)
        except ValueError:
            limit = 10

    history = get_payment_history(target_user_id, limit=limit)
    if not history:
        if admin_lang == "en":
            text = f"ℹ️ No payment history for user {target_user_id}."
        else:
            text = f"ℹ️ Belum ada riwayat pembayaran untuk user {target_user_id}."
        await update.message.reply_text(text)
        return

    lines: list[str] = []
    for item in history:
        ts = item.get("ts", 0)
        dt = datetime.fromtimestamp(ts)
        ts_str = dt.strftime("%Y-%m-%d %H:%M")
        source = item.get("source", "")
        amount = item.get("amount", 0)
        days = item.get("days", 0)
        wallet = item.get("wallet", "")
        code = item.get("code", "")
        status = item.get("status", "")
        admin_id = item.get("admin_id")

        if admin_lang == "en":
            line = (
                f"{ts_str} • {source} • Rp {amount:,} • {days} day(s) • "
                f"wallet={wallet or '-'} • code={code or '-'} • status={status}"
            )
            if admin_id:
                line += f" • by_admin={admin_id}"
        else:
            line = (
                f"{ts_str} • {source} • Rp {amount:,} • {days} hari • "
                f"wallet={wallet or '-'} • code={code or '-'} • status={status}"
            )
            if admin_id:
                line += f" • admin={admin_id}"

        lines.append(line)

    header = f"🧾 Riwayat pembayaran user `{target_user_id}`:" if admin_lang != "en" else f"🧾 Payment history for user `{target_user_id}`:"
    text = header + "\n\n" + "\n".join(lines)
    await update.message.reply_text(text, parse_mode="Markdown")


async def broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Mengirim pesan broadcast ke semua pengguna aktif (admin only)."""
    if update.effective_user.id not in ADMIN_IDS:
        return

    admin_lang = get_user_language(update.effective_user.id)

    if not context.args:
        text = (
            "Usage: /broadcast <message>"
            if admin_lang == "en"
            else "Cara pakai: /broadcast <pesan>"
        )
        await update.message.reply_text(text)
        return

    message = " ".join(context.args)
    active_users = get_active_users(24)

    success = 0
    for user_id in active_users:
        try:
            user_lang = get_user_language(user_id)
            if user_lang == "en":
                header = "📢 **Announcement**"
            else:
                header = "📢 **Pengumuman**"
            await context.bot.send_message(
                user_id,
                f"{header}\n\n{message}",
                parse_mode="Markdown",
            )
            success += 1
            await asyncio.sleep(0.05)  # Prevent flood
        except Exception:
            pass

    if admin_lang == "en":
        text_admin = f"✅ Broadcast sent to {success} users."
    else:
        text_admin = f"✅ Broadcast terkirim ke {success} pengguna."
    await update.message.reply_text(text_admin)

async def admin_stats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Menampilkan statistik global (khusus admin)."""
    if update.effective_user.id not in ADMIN_IDS:
        return

    admin_lang = get_user_language(update.effective_user.id)
    stats = get_global_stats()

    if admin_lang == "en":
        text = f"""
📊 **Global statistics**

👥 **Total users:** {stats['total_users']}
💬 **Active sessions:** {stats['active_sessions']}
⏳ **Waiting in queue:** {stats['queue_waiting']}
💎 **Premium users:** {stats['total_premium']}
🚫 **Blocked users:** {stats['total_banned']}
"""
    else:
        text = f"""
📊 **Statistik global**

👥 **Total pengguna:** {stats['total_users']}
💬 **Sesi aktif:** {stats['active_sessions']}
⏳ **Sedang menunggu di antrian:** {stats['queue_waiting']}
💎 **Pengguna premium:** {stats['total_premium']}
🚫 **Pengguna yang diblokir:** {stats['total_banned']}
"""

    await update.message.reply_text(text, parse_mode="Markdown")

async def list_banned(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id not in ADMIN_IDS:
        return

    admin_lang = get_user_language(update.effective_user.id)

    cursor = 0
    banned_ids: list[str] = []
    while True:
        cursor, keys = r.scan(cursor=cursor, match="user:*:banned", count=100)
        for key in keys:
            user_id = key.split(":")[1]
            banned_ids.append(user_id)
        if cursor == 0:
            break

    if not banned_ids:
        text = "There are no blocked users." if admin_lang == "en" else "Tidak ada pengguna yang diblokir."
        await update.message.reply_text(text)
    else:
        if admin_lang == "en":
            text = "📋 List of blocked users:\n" + "\n".join(banned_ids[:50])
            if len(banned_ids) > 50:
                text += f"\n\n... and {len(banned_ids) - 50} more"
        else:
            text = "📋 Daftar pengguna yang diblokir:\n" + "\n".join(banned_ids[:50])
            if len(banned_ids) > 50:
                text += f"\n\n... dan {len(banned_ids) - 50} lainnya"
        await update.message.reply_text(text)

async def unban(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id not in ADMIN_IDS:
        return

    admin_lang = get_user_language(update.effective_user.id)

    if not context.args:
        text = (
            "Usage: /unban <user_id>"
            if admin_lang == "en"
            else "Cara pakai: /unban <user_id>"
        )
        await update.message.reply_text(text)
        return

    try:
        user_id = int(context.args[0])
        unban_user(user_id)

        if admin_lang == "en":
            text_admin = f"✅ User {user_id} has been unbanned."
        else:
            text_admin = f"✅ Pengguna {user_id} telah di-unban."
        await update.message.reply_text(text_admin)

        try:
            user_lang = get_user_language(user_id)
            if user_lang == "en":
                text_user = "🎉 Your account block has been lifted. Welcome back!"
            else:
                text_user = "🎉 Blokir akunmu telah dicabut. Selamat datang kembali!"
            await context.bot.send_message(user_id, text_user)
        except Exception:
            pass
    except ValueError:
        text = "User ID must be a number." if admin_lang == "en" else "ID harus berupa angka."
        await update.message.reply_text(text)

async def appeal(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    
    if not is_banned(user_id):
        await update.message.reply_text("ℹ️ Kamu tidak sedang diblokir.")
        return
    
    msg = f"📨 **Permohonan Banding**\nUser `{user_id}` meminta pencabutan blokir."
    
    for admin_id in ADMIN_IDS:
        try:
            await context.bot.send_message(admin_id, msg, parse_mode="Markdown")
        except:
            pass
    
    await update.message.reply_text("✅ Permohonan terkirim ke admin. Mohon tunggu.")

# --- MESSAGE HANDLER ---
async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    lang = get_user_language(user_id)

    if update.message.text and update.message.text.startswith("/"):
        if lang == "en":
            text = (
                "ℹ️ Commands only work outside of an active chat.\n"
                "While in a chat, just send normal messages.\n"
                "To leave, use /stop or /next."
            )
        else:
            text = (
                "ℹ️ Perintah hanya berlaku di luar obrolan.\n"
                "Saat dalam obrolan, kirim pesan biasa.\n"
                "Untuk keluar, gunakan /stop atau /next."
            )
        await update.message.reply_text(text)
        return

    # Check if this is a payment screenshot
    if update.message.photo:
        await verify_screenshot(update, context)

    await forward_to_partner(update, context)

# --- MAIN ---
def main():
    if not BOT_TOKEN:
        raise ValueError("BOT_TOKEN tidak ditemukan! Buat file .env dan isi BOT_TOKEN")
    
    application = Application.builder().token(BOT_TOKEN).build()
    
    # User commands
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(CommandHandler("premium", premium_info))
    application.add_handler(CommandHandler("setgender", set_gender))
    application.add_handler(CommandHandler("setinterest", set_interest))
    application.add_handler(CommandHandler("lang", set_language_command))
    application.add_handler(CommandHandler("search", search))
    application.add_handler(CommandHandler("stop", stop))
    application.add_handler(CommandHandler("skip", skip))
    application.add_handler(CommandHandler("next", skip))
    application.add_handler(CommandHandler("showid", showid))
    application.add_handler(CommandHandler("report", report))
    application.add_handler(CommandHandler("appeal", appeal))
    application.add_handler(CommandHandler("stats", stats))
    application.add_handler(CommandHandler("paymanual", paymanual))
    application.add_handler(CommandHandler("discount", apply_discount))
    
    # Admin commands
    application.add_handler(CommandHandler("grant_premium", grant_premium))
    application.add_handler(CommandHandler("giftpremium", gift_premium))
    application.add_handler(CommandHandler("broadcast", broadcast))
    application.add_handler(CommandHandler("adminstats", admin_stats))
    application.add_handler(CommandHandler("list_banned", list_banned))
    application.add_handler(CommandHandler("unban", unban))
    application.add_handler(CommandHandler("creatediscount", create_discount))
    application.add_handler(CommandHandler("payhistory", payhistory))
    
    # Callback handlers
    application.add_handler(CallbackQueryHandler(payment_manual_callback, pattern="^payment_manual$"))
    application.add_handler(CallbackQueryHandler(payment_duration_callback, pattern="^pay_"))
    application.add_handler(CallbackQueryHandler(language_callback, pattern="^lang_"))
    application.add_handler(CallbackQueryHandler(rating_callback, pattern="^rate_"))
    application.add_handler(CallbackQueryHandler(report_menu_callback, pattern="^report_menu"))
    application.add_handler(CallbackQueryHandler(report_reason_callback, pattern="^rep_"))
    application.add_handler(CallbackQueryHandler(payreview_callback, pattern="^payreview_"))
    
    # Message handler
    application.add_handler(MessageHandler(
        filters.TEXT | filters.PHOTO | filters.VOICE | filters.Sticker.ALL | filters.Document.ALL,
        handle_message
    ))
    
    logger.info("✅ ShadowChat Bot siap dengan semua fitur premium!")
    application.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()