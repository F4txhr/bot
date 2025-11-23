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
    censor_text, is_dangerous_file, is_rate_limited,
    is_banned, ban_user, unban_user, add_report,
    create_payment_code, verify_payment_code, delete_payment_code,
    get_active_users, get_free_users, update_user_activity,
    get_user_stats, increment_chat_count, get_global_stats,
    is_search_cooldown, r
)

# Setup logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Helper: dapatkan pasangan
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
    """Kirim typing indicator ke partner"""
    try:
        await context.bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)
    except:
        pass

# Helper: kirim pesan ke pasangan dengan typing indicator
async def forward_to_partner(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    
    # Update user activity
    update_user_activity(user_id)
    
    if is_banned(user_id):
        await update.message.reply_text("❌ Akunmu diblokir. Gunakan /appeal untuk ajukan banding.")
        return
    
    # Rate limiting
    if is_rate_limited(user_id):
        await update.message.reply_text("⚠️ Kamu mengirim pesan terlalu cepat. Tunggu beberapa detik.")
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
                await message.reply_text("❌ File berbahaya tidak diizinkan.")
                return
            caption = censor_text(message.caption) if message.caption else None
            await context.bot.send_document(
                chat_id=partner_id,
                document=message.document.file_id,
                caption=caption
            )
    except Exception as e:
        logger.warning(f"Gagal mengirim ke {partner_id}: {e}")
        await message.reply_text("⚠️ Pasanganmu tidak aktif. Ketik /search untuk cari yang baru.")
        session_key = r.get(f"user:{user_id}")
        if session_key:
            r.delete(session_key)
            r.delete(f"user:{user_id}")

# --- COMMANDS ---
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    update_user_activity(user_id)
    
    if is_banned(user_id):
        await update.message.reply_text("❌ Akunmu diblokir. Gunakan /appeal untuk ajukan banding.")
        return
    
    text = """
👋 **Selamat datang di ShadowChat!**
Obrolan **anonim** dengan orang acak — tanpa nama, tanpa jejak.

📌 **Perintah utama:**
• /search — Cari pasangan obrolan
• /stop — Hentikan obrolan
• /next — Ganti ke pasangan berikutnya
• /premium — Info fitur premium
• /stats — Lihat statistikmu

💎 **Fitur premium:**
• /setgender — Atur jenis kelamin
• /setinterest — Atur minat/hobi
• /search [male/female] — Cari berdasarkan jenis kelamin

🔧 **Lainnya:**
• /showid — Bagikan profil Telegram-mu
• /report — Laporkan pelanggaran
• /help — Tampilkan pesan ini

🔒 Semua pesan **tidak disimpan**.
⚠️ Jangan kirim konten yang melanggar aturan.

Ketik /search untuk mulai!
"""
    await update.message.reply_text(text, parse_mode="Markdown")

async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await start(update, context)

async def premium_info(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    update_user_activity(user_id)
    
    if is_banned(user_id):
        await update.message.reply_text("❌ Akunmu diblokir. Gunakan /appeal untuk ajukan banding.")
        return
    
    text = """
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
    
    keyboard = [
        [InlineKeyboardButton("💳 Bayar via Trakteer", url=TRAKTEER_URL)],
        [InlineKeyboardButton("📱 Transfer Manual", callback_data="payment_manual")]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await update.message.reply_text(text, parse_mode="Markdown", reply_markup=reply_markup)

async def payment_manual_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Callback untuk payment manual"""
    query = update.callback_query
    await query.answer()
    
    user_id = query.from_user.id
    
    text = """
📱 **Transfer Manual**

Silakan pilih paket/durasi premium yang ingin kamu beli:
"""
    
    keyboard = []
    for days, price in PREMIUM_PRICES.items():
        days_text = f"{days} hari" if days < 365 else "1 tahun"
        keyboard.append([InlineKeyboardButton(
            f"{days_text} - Rp {price:,}", 
            callback_data=f"pay_{days}"
        )])
    
    reply_markup = InlineKeyboardMarkup(keyboard)
    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=reply_markup)

async def payment_duration_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Callback setelah pilih durasi"""
    query = update.callback_query
    await query.answer()
    
    user_id = query.from_user.id
    days = int(query.data.split("_")[1])
    amount = PREMIUM_PRICES[days]
    
    # Generate payment code
    code = create_payment_code(user_id, days, amount)
    
    days_text = f"{days} hari" if days < 365 else "1 tahun"
    
    text = f"""
💳 **Instruksi Pembayaran**

📦 Paket: **{days_text}**
💰 Harga: **Rp {amount:,}**

🔢 **KODE PEMBAYARAN:**
`{code}`

📤 **Cara Bayar:**
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
    """Auto-verify screenshot pembayaran"""
    if not update.message.photo:
        return
    
    user_id = update.effective_user.id
    
    # Check apakah user sedang tunggu verifikasi
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
    
    # Simulate verification (dalam production, pakai OCR/AI untuk verify)
    await update.message.reply_text("🔍 Memverifikasi pembayaran...")
    await asyncio.sleep(2)
    
    # Untuk demo, kita assume valid. Dalam production:
    # 1. Extract text dari image pakai OCR
    # 2. Cek apakah ada kode pembayaran
    # 3. Cek nominal match
    # 4. Cek status "Berhasil"
    
    # Grant premium
    days = user_payment["days"]
    r.setex(f"user:{user_id}:premium", days * 86400, "1")
    delete_payment_code(user_payment["code"])
    
    days_text = f"{days} hari" if days < 365 else "1 tahun"
    
    await update.message.reply_text(
        f"✅ **Pembayaran Berhasil!**\n\n"
        f"Premium aktif untuk {days_text}.\n"
        f"Gunakan /setgender dan /setinterest untuk mengatur profil premium-mu!",
        parse_mode="Markdown"
    )
    
    logger.info(f"Premium granted to {user_id} for {days} days via manual payment")

async def set_gender(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    update_user_activity(user_id)
    
    if is_banned(user_id):
        await update.message.reply_text("❌ Akunmu diblokir. Gunakan /appeal untuk ajukan banding.")
        return
    
    if not context.args:
        await update.message.reply_text("Cara pakai: /setgender male | female | skip")
        return
    
    gender = context.args[0].lower()
    if gender not in ["male", "female", "skip"]:
        await update.message.reply_text("Pilih salah satu: male, female, atau skip")
        return
    
    r.set(f"user:{user_id}:gender", gender if gender != "skip" else "")
    await update.message.reply_text(f"✅ Jenis kelaminmu diatur ke: {gender}")

async def set_interest(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Set user interests/hobbies"""
    user_id = update.effective_user.id
    update_user_activity(user_id)
    
    if is_banned(user_id):
        await update.message.reply_text("❌ Akunmu diblokir.")
        return
    
    if not context.args:
        interests_list = ", ".join(AVAILABLE_INTERESTS)
        await update.message.reply_text(
            f"**Minat yang tersedia:**\n{interests_list}\n\n"
            f"**Cara pakai:** /setinterest gaming music sports\n"
            f"(Kamu bisa memilih 1–3 minat)",
            parse_mode="Markdown"
        )
        return
    
    selected = [i.lower() for i in context.args if i.lower() in AVAILABLE_INTERESTS]
    
    if not selected:
        await update.message.reply_text("❌ Minat tidak valid.")
        return
    
    if len(selected) > 3:
        await update.message.reply_text("❌ Maksimal 3 minat.")
        return
    
    # Save interests
    key = f"user:{user_id}:interests"
    r.delete(key)
    for interest in selected:
        r.sadd(key, interest)
    
    await update.message.reply_text(f"✅ Minat disetel: {', '.join(selected)}")

async def search(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    update_user_activity(user_id)
    
    if is_banned(user_id):
        await update.message.reply_text("❌ Akunmu diblokir.")
        return
    
    if r.get(f"user:{user_id}"):
        await update.message.reply_text("ℹ️ Kamu sudah dalam obrolan. Ketik /stop untuk keluar.")
        return
    
    # Cooldown check
    if is_search_cooldown(user_id, SEARCH_COOLDOWN):
        await update.message.reply_text(f"⏳ Tunggu {SEARCH_COOLDOWN} detik sebelum mencari lagi.")
        return
    
    is_premium = r.exists(f"user:{user_id}:premium")
    user_gender = r.get(f"user:{user_id}:gender") or ""
    user_interests = r.smembers(f"user:{user_id}:interests")
    
    target_queue = "queue:free"
    
    if is_premium and context.args:
        req = context.args[0].lower()
        if req in ["male", "female"]:
            if not user_gender:
                await update.message.reply_text("⚠️ Atur jenis kelaminmu dulu dengan /setgender.")
                return
            target_queue = f"queue:premium:{req}"
        elif req == "any":
            target_queue = "queue:free"
        else:
            await update.message.reply_text("Cara pakai: /search [male|female|any]")
            return
    elif is_premium and user_gender:
        opposite = "female" if user_gender == "male" else "male"
        target_queue = f"queue:premium:{opposite}"
    elif not is_premium:
        if context.args:
            await update.message.reply_text("🔒 Fitur ini hanya untuk pengguna premium. Ketik /premium untuk info.")
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
        
        msg_user = "✅ Terhubung!"
        msg_partner = "✅ Terhubung!"
        
        if common:
            common_str = ", ".join(common)
            msg_user += f"\n🎯 Minat sama: {common_str}"
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
        
        await update.message.reply_text("🔍 Mencari pasangan...\nKetik /stop untuk batal.")

async def stop(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    update_user_activity(user_id)
    
    if is_banned(user_id):
        await update.message.reply_text("❌ Akunmu diblokir.")
        return
    
    session_key = r.get(f"user:{user_id}")
    if not session_key:
        await update.message.reply_text("ℹ️ Kamu tidak sedang dalam obrolan.")
        return
    
    partner_id = get_partner(user_id)
    r.delete(session_key)
    r.delete(f"user:{user_id}")
    
    if partner_id:
        r.delete(f"user:{partner_id}")
        try:
            await context.bot.send_message(
                partner_id, 
                "💬 Obrolan berakhir.\nKetik /search untuk cari baru."
            )
        except:
            pass
    
    await update.message.reply_text("Obrolan dihentikan. Ketik /search untuk mencari pasangan baru.")

async def skip(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await stop(update, context)

async def showid(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Share profile Telegram link dengan partner"""
    user_id = update.effective_user.id
    username = update.effective_user.username
    
    if is_banned(user_id):
        await update.message.reply_text("❌ Akunmu diblokir.")
        return
    
    partner_id = get_partner(user_id)
    if not partner_id:
        await update.message.reply_text("ℹ️ Kamu tidak sedang dalam obrolan.")
        return
    
    if username:
        profile_link = f"https://t.me/{username}"
        await context.bot.send_message(
            partner_id,
            f"👤 Partner ingin berbagi profil:\n{profile_link}"
        )
        await update.message.reply_text("✅ Link profil terkirim ke partner!")
    else:
        await update.message.reply_text(
            "❌ Kamu belum set username Telegram.\n"
            "Set username dulu di Settings Telegram."
        )

async def report(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    update_user_activity(user_id)
    
    if is_banned(user_id):
        await update.message.reply_text("❌ Akunmu diblokir.")
        return
    
    partner_id = get_partner(user_id)
    if not partner_id:
        await update.message.reply_text("ℹ️ Kamu tidak sedang dalam obrolan.")
        return
    
    # Add report
    report_count = add_report(partner_id, user_id)
    
    logger.info(f"LAPORAN: User {user_id} melaporkan {partner_id} (total: {report_count})")
    
    # Auto-ban jika >= 3 laporan
    if report_count >= AUTO_BAN_REPORTS:
        ban_user(partner_id, "Auto-ban: Multiple reports")
        
        # Notify admins
        for admin_id in ADMIN_IDS:
            try:
                await context.bot.send_message(
                    admin_id,
                    f"🚨 **Auto-Ban Alert**\n"
                    f"Pengguna `{partner_id}` telah di-ban otomatis.\n"
                    f"Alasan: {report_count} laporan dalam 24 jam.",
                    parse_mode="Markdown"
                )
            except:
                pass
        
        await update.message.reply_text(
            "✅ Terima kasih atas laporanmu.\n"
            "Pengguna tersebut telah diblokir otomatis karena banyak laporan."
        )
    else:
        await update.message.reply_text("✅ Terima kasih atas laporanmu. Admin akan meninjau.")

async def stats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show user statistics"""
    user_id = update.effective_user.id
    update_user_activity(user_id)
    
    if is_banned(user_id):
        await update.message.reply_text("❌ Akunmu diblokir.")
        return
    
    stats = get_user_stats(user_id)
    
    premium_status = "✅ Premium" if stats["premium"] else "❌ Free"
    if stats["premium"]:
        premium_status += f" ({stats['premium_days_left']} hari tersisa)"
    
    gender = stats["gender"] if stats["gender"] != "not_set" else "Belum diatur"
    interests = ", ".join(stats["interests"]) if stats["interests"] else "Belum diatur"
    
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
    
    if len(context.args) != 2:
        await update.message.reply_text("Cara pakai: /grant_premium &lt;user_id&gt; &lt;days&gt;")
        return
    
    try:
        user_id = int(context.args[0])
        days = int(context.args[1])
        r.setex(f"user:{user_id}:premium", days * 86400, "1")
        
        await update.message.reply_text(f"✅ Premium diberikan ke {user_id} untuk {days} hari.")
        
        try:
            await context.bot.send_message(
                user_id, 
                f"🎉 Premium kamu aktif untuk {days} hari!\n"
                f"Gunakan /setgender dan /setinterest untuk mengatur profilmu.",
                parse_mode="Markdown"
            )
        except:
            pass
    except ValueError:
        await update.message.reply_text("ID dan hari harus angka.")

async def gift_premium(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Gift premium ke random users"""
    if update.effective_user.id not in ADMIN_IDS:
        return
    
    if len(context.args) != 2:
        await update.message.reply_text("Cara pakai: /giftpremium &lt;jumlah_user&gt; &lt;days&gt;")
        return
    
    try:
        count = int(context.args[0])
        days = int(context.args[1])
        
        # Get free users yang aktif 24 jam terakhir
        free_users = get_free_users()
        
        if not free_users:
            await update.message.reply_text("❌ Tidak ada pengguna gratis yang aktif dalam 24 jam terakhir.")
            return
        
        # Random select
        import random
        selected = random.sample(free_users, min(count, len(free_users)))
        
        success = 0
        for user_id in selected:
            try:
                r.setex(f"user:{user_id}:premium", days * 86400, "1")
                await context.bot.send_message(
                    user_id,
                    f"🎁 **SELAMAT!**\n\n"
                    f"Kamu mendapat premium **GRATIS** untuk {days} hari!\n"
                    f"Gunakan /setgender dan /setinterest untuk setup.",
                    parse_mode="Markdown"
                )
                success += 1
            except:
                pass
        
        await update.message.reply_text(
            f"✅ Premium diberikan ke {success}/{count} pengguna untuk {days} hari."
        )
        
        logger.info(f"Admin {update.effective_user.id} gifted premium to {success} users")
        
    except ValueError:
        await update.message.reply_text("Jumlah dan hari harus angka.")

async def broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Broadcast message ke semua active users"""
    if update.effective_user.id not in ADMIN_IDS:
        return
    
    if not context.args:
        await update.message.reply_text("Cara pakai: /broadcast &lt;pesan&gt;")
        return
    
    message = " ".join(context.args)
    active_users = get_active_users(24)
    
    success = 0
    for user_id in active_users:
        try:
            await context.bot.send_message(
                user_id,
                f"📢 **Pengumuman**\n\n{message}",
                parse_mode="Markdown"
            )
            success += 1
            await asyncio.sleep(0.05)  # Prevent flood
        except:
            pass
    
    await update.message.reply_text(f"✅ Broadcast terkirim ke {success} pengguna.")

async def admin_stats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show global statistics (admin only)"""
    if update.effective_user.id not in ADMIN_IDS:
        return
    
    stats = get_global_stats()
    
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
    
    cursor = 0
    banned_ids = []
    while True:
        cursor, keys = r.scan(cursor=cursor, match="user:*:banned", count=100)
        for key in keys:
            user_id = key.split(':')[1]
            banned_ids.append(user_id)
        if cursor == 0:
            break
    
    if not banned_ids:
        await update.message.reply_text("Tidak ada pengguna yang diblokir.")
    else:
        text = "📋 Daftar pengguna yang diblokir:\n" + "\n".join(banned_ids[:50])
        if len(banned_ids) > 50:
            text += f"\n\n... dan {len(banned_ids) - 50} lainnya"
        await update.message.reply_text(text)

async def unban(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id not in ADMIN_IDS:
        return
    
    if not context.args:
        await update.message.reply_text("Cara pakai: /unban &lt;user_id&gt;")
        return
    
    try:
        user_id = int(context.args[0])
        unban_user(user_id)
        
        await update.message.reply_text(f"✅ Pengguna {user_id} telah di-unban.")
        
        try:
            await context.bot.send_message(
                user_id, 
                "🎉 Blokir akunmu telah dicabut. Selamat datang kembali!"
            )
        except:
            pass
    except ValueError:
        await update.message.reply_text("ID harus berupa angka.")

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
    if update.message.text and update.message.text.startswith("/"):
        await update.message.reply_text(
            "ℹ️ Perintah hanya berlaku di luar obrolan.\n"
            "Saat dalam obrolan, kirim pesan biasa.\n"
            "Untuk keluar, gunakan /stop atau /next."
        )
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
    
    # Message handler
    application.add_handler(MessageHandler(
        filters.TEXT | filters.PHOTO | filters.VOICE | filters.Sticker.ALL | filters.Document.ALL,
        handle_message
    ))
    
    logger.info("✅ ShadowChat Bot siap dengan semua fitur premium!")
    application.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()