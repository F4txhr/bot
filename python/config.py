import os
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Daftar admin (ganti dengan ID Telegram-mu)
ADMIN_IDS = {int(x) for x in os.getenv("ADMIN_IDS", "5361605327").split(",")}  # ← GANTI DENGAN ID TELEGRAM KAMU!

# Chat ID grup/log untuk laporan hasil OCR pembayaran (opsional).
# Jika tidak ingin mengirim ke grup, biarkan 0 atau kosong.
PAYMENT_LOG_CHAT_ID = int(os.getenv("PAYMENT_LOG_CHAT_ID", "0") or "0")
# Jika grup menggunakan topik (forum), isi ID topik khusus pembayaran di sini (opsional).
PAYMENT_LOG_TOPIC_ID = int(os.getenv("PAYMENT_LOG_TOPIC_ID", "0") or "0")

# Chat ID grup/log untuk laporan report pengguna (opsional).
# Jika tidak ingin mengirim ke grup, biarkan 0 atau kosong.
# Bisa sama dengan PAYMENT_LOG_CHAT_ID jika ingin satu grup dengan topik terpisah.
REPORT_LOG_CHAT_ID = int(os.getenv("REPORT_LOG_CHAT_ID", str(PAYMENT_LOG_CHAT_ID)) or "0")
# Jika grup menggunakan topik (forum), isi ID topik khusus report di sini (opsional).
REPORT_LOG_TOPIC_ID = int(os.getenv("REPORT_LOG_TOPIC_ID", "0") or "0")

# payment

TRAKTEER_API_KEY = os.getenv("TRAKTEER_API_KEY")
TRAKTEER_WEBHOOK_SECRET = os.getenv("TRAKTEER_WEBHOOK_SECRET")
TRAKTEER_URL = os.getenv("TRAKTEER_URL")

E_WALLET_NUMBER = "089647770084"
E_WALLET_NAME = "Achmad fatkurrois"

#premium pricing

PREMIUM_PRICES = {
    3 : 3000,
    7 : 7000,
    15 : 15000,
    30 : 30000,
    365 : 365000
}

# Filter kata kasar
# Hanya kata dengan level kekasaran "berat" yang masuk BAD_WORDS.
# Kata-kata gaul kasar-sedang seperti "anjir", "anjay", "bjir", "alay" dibiarkan.
BAD_WORDS = {
    "anjing", "bangsat", "kontol", "memek", "babi", "tolol",
    "goblok", "setan", "kampret", "ngentot", "coli", "seks"
}

# Kata-kata gaul yang dianggap kasar-sedang dan TIDAK perlu diblokir.
MILD_SLANG_WORDS = {
    "anjir", "anjay", "bjir", "alay"
}

# Ekstensi berbahaya
DANGEROUS_EXTENSIONS = {".exe", ".bat", ".sh", ".cmd", ".msi", ".jar"}

# Rate limit pesan
RATE_LIMIT_WINDOW = 5
RATE_LIMIT_MAX_MSGS = 3

# Sistem laporan & ban
AUTO_BAN_REPORTS = 3
REPORT_WINDOW = 86400

# Sistem trust (0–100)
TRUST_INITIAL = 50
TRUST_HIGH_THRESHOLD = 70       # >= 70 dianggap "high"
TRUST_NORMAL_THRESHOLD = 40     # 40–69 dianggap "normal"
TRUST_LOW_THRESHOLD = 20        # 20–39 dianggap "low", < 20 dianggap "hell"
TRUST_PENALTY_PER_REPORT = 10   # pengurangan skor trust per laporan

# Cooldown pencarian pasangan
SEARCH_COOLDOWN = 3

# Minat yang tersedia
AVAILABLE_INTERESTS = {
    "gaming", "movies", "music", "sports"
}