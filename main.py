import asyncio
import logging
import redis
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
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
    AUTO_BAN_REPORTS
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

    text_id = """
💎 **Fitur Premium ShadowChat**

Dengan premium, kamu bisa:
• 🔍 Cari berdasarkan jenis kelamin (`/search male` atau `/search female`)
• 🎯 Dipertemukan berdasarkan minat/hobi yang sama
• ⚡ Prioritas dalam antrian pencarian
• 📊 Melihat statistik obrolan yang lebih lengkap

💰 **Harga Premium:**
• 3 hari → Rp 3.000
• 7 hari → Rp 7.000
• 15 hari → Rp 15.000
• 30 hari → Rp 30.000
• 1 tahun → Rp 365.000

📥 **Cara aktifkan:**

**Opsi 1: Trakteer (disarankan)**
Klik tombol di bawah untuk bayar via Trakteer (QRIS / e-wallet)
"""

    text_en = """
💎 **ShadowChat Premium Features**

With premium, you can:
• 🔍 Search by gender (`/search male` or `/search female`)
• 🎯 Be matched with people who share the same interests
• ⚡ Get priority in the search queue
• 📊 See more detailed chat statistics

💰 **Premium prices:**
• 3 days → Rp 3.000
• 7 days → Rp 7.000
• 15 days → Rp 15.000
• 30 days → Rp 30.000
• 1 year → Rp 365.000

📥 **How to activate:**

**Option 1: Trakteer (recommended)**
Tap the button below to pay via Trakteer (QRIS / e-wallet)
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
"""
    else:
        text = """
📱 **Transfer manual**

Silakan pilih paket/durasi premium yang ingin kamu beli:
"""

    keyboard = []
    for days, price in PREMIUM_PRICES.items():
        days_text_id = f"{days} hari" if days &lt; 365 else "1 tahun"
        days_text_en = f"{days} days" if days &lt; 365 else "1 year"
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
    amount = PREMIUM_PRICES[days]

    # Generate payment code
    code = create_payment_code(user_id, days, amount)

    days_text_id = f"{days} hari" if days &lt; 365 else "1 tahun"
    days_text_en = f"{days} days" if days &lt; 365 else "1 year"

    if lang == "en":
        days_text = days_text_en
        text = f"""
💳 **Payment instructions**

📦 Package: **{days_text}**
💰 Price: **Rp {amount:,}**

🔢 **PAYMENT CODE:**
`{code}`

📤 **How to pay:**
1. Transfer to one of these:
   • **GoPay:** {E_WALLET_NUMBER}
   • **OVO:** {E_WALLET_NUMBER}
   • **DANA:** {E_WALLET_NUMBER}
   
2. **IMPORTANT:** Put this code in the transfer note: `{code}`

3. Take a screenshot of your payment

4. Send the screenshot to this chat

⏰ The code is valid for 1 hour.
🤖 The bot will auto-verify after you send the screenshot.
"""
    else:
        days_text = days_text_id
        text = f"""
💳 **Instruksi pembayaran**

📦 Paket: **{days_text}**
💰 Harga: **Rp {amount:,}**

🔢 **KODE PEMBAYARAN:**
`{code}`

📤 **Cara bayar:**
1. Transfer ke salah satu:
   • **GoPay:** {E_WALLET_NUMBER}
   • **OVO:** {E_WALLET_NUMBER}
   • **DANA:** {E_WALLET_NUMBER}
   
2. **PENTING:** Isi berita/catatan transfer dengan kode: `{code}`

3. Screenshot bukti transfer

4. Kirim screenshot ke chat ini

⏰ Kode berlaku 1 jam.
🤖 Bot akan auto-verify setelah kamu kirim screenshot.
"""

    await query.edit_message_text(text, parse_mode="Markdown")

async def verify_screenshot(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Auto-verify screenshot pembayaran/manual payment."""
    if not update.message.photo:
        return

    user_id = update.effective_user.id
    lang = get_user_language(user_id)

    # Cek apakah user sedang menunggu verifikasi pembayaran
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

    # Simulasi proses verifikasi (di production gunakan OCR/AI/dll)
    if lang == "en":
        wait_text = "🔍 Verifying your payment..."
    else:
        wait_text = "🔍 Memverifikasi pembayaran..."

    await update.message.reply_text(wait_text)
    await asyncio.sleep(2)

    # Grant premium (di sini diasumsikan pembayaran valid)
    days = user_payment["days"]
    r.setex(f"user:{user_id}:premium", days * 86400, "1")
    delete_payment_code(user_payment["code"])

    days_text_id = f"{days} hari" if days < 365 else "1 tahun"
    days_text_en = f"{days} days" if days < 365 else "1 year"

    if lang == "en":
        days_text = days_text_en
        success_text = (
            f"✅ **Payment successful!**\n\n"
            f"Your premium is now active for {days_text}.\n"
            f"Use /setgender and /setinterest to set up your premium profile."
        )
    else:
        days_text = days_text_id
        success_text = (
            f"✅ **Pembayaran berhasil!**\n\n"
            f"Premium aktif untuk {days_text}.\n"
            f"Gunakan /setgender dan /setinterest untuk mengatur profil premium-mu!"
        )

    await update.message.reply_text(success_text, parse_mode="Markdown")

    logger.info(f"Premium granted to {user_id} for {days} days via manual payment")

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

    is_premium = r.exists(f"user:{user_id}:premium")
    user_gender = r.get(f"user:{user_id}:gender") or ""
    user_interests = r.smembers(f"user:{user_id}:interests")

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

    # Try to find match
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
    """Mengakhiri obrolan, dengan pesan berbeda untuk /stop dan /next."""
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

async def report(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    lang = get_user_language(user_id)
    update_user_activity(user_id)

    if is_banned(user_id):
        text = "❌ Your account is blocked." if lang == "en" else "❌ Akunmu diblokir."
        await update.message.reply_text(text)
        return

    partner_id = get_partner(user_id)
    if not partner_id:
        text = "ℹ️ You are not currently in a chat." if lang == "en" else "ℹ️ Kamu tidak sedang dalam obrolan."
        await update.message.reply_text(text)
        return

    # Tambahkan laporan
    report_count = add_report(partner_id, user_id)

    logger.info(f"LAPORAN: User {user_id} melaporkan {partner_id} (total: {report_count})")

    # Auto-ban jika >= AUTO_BAN_REPORTS
    if report_count >= AUTO_BAN_REPORTS:
        ban_user(partner_id, "Auto-ban: Multiple reports")

        # Beri tahu admin
        for admin_id in ADMIN_IDS:
            try:
                admin_lang = get_user_language(admin_id)
                if admin_lang == "en":
                    admin_text = (
                        "🚨 **Auto-ban alert**\n"
                        f"User `{partner_id}` has been automatically banned.\n"
                        f"Reason: {report_count} reports within 24 hours."
                    )
                else:
                    admin_text = (
                        "🚨 **Auto-Ban Alert**\n"
                        f"Pengguna `{partner_id}` telah di-ban otomatis.\n"
                        f"Alasan: {report_count} laporan dalam 24 jam."
                    )
                await context.bot.send_message(admin_id, admin_text, parse_mode="Markdown")
            except Exception:
                pass

        if lang == "en":
            text_user = (
                "✅ Thank you for your report.\n"
                "That user has been automatically blocked due to multiple reports."
            )
        else:
            text_user = (
                "✅ Terima kasih atas laporanmu.\n"
                "Pengguna tersebut telah diblokir otomatis karena banyak laporan."
            )
        await update.message.reply_text(text_user)
    else:
        text = (
            "✅ Thank you for your report. The admins will review it."
            if lang == "en"
            else "✅ Terima kasih atas laporanmu. Admin akan meninjau."
        )
        await update.message.reply_text(text)

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
    
    # Admin commands
    application.add_handler(CommandHandler("grant_premium", grant_premium))
    application.add_handler(CommandHandler("giftpremium", gift_premium))
    application.add_handler(CommandHandler("broadcast", broadcast))
    application.add_handler(CommandHandler("adminstats", admin_stats))
    application.add_handler(CommandHandler("list_banned", list_banned))
    application.add_handler(CommandHandler("unban", unban))
    
    # Callback handlers
    application.add_handler(CallbackQueryHandler(payment_manual_callback, pattern="^payment_manual$"))
    application.add_handler(CallbackQueryHandler(payment_duration_callback, pattern="^pay_"))
    application.add_handler(CallbackQueryHandler(language_callback, pattern="^lang_"))
    
    # Message handler
    application.add_handler(MessageHandler(
        filters.TEXT | filters.PHOTO | filters.VOICE | filters.Sticker.ALL | filters.Document.ALL,
        handle_message
    ))
    
    logger.info("✅ ShadowChat Bot siap dengan semua fitur premium!")
    application.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()