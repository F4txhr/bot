import os
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Daftar admin (ganti dengan ID Telegram-mu)
ADMIN_IDS = {int(x) for x in os.getenv("ADMIN_IDS", "5361605327").split(",")}  # ← GANTI DENGAN ID TELEGRAM KAMU!

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
BAD_WORDS = {
    "anjing", "bangsat", "kontol", "memek", "babi", "tolol",
    "goblok", "setan", "kampret", "ngentot", "coli", "seks"
}

# Ekstensi berbahaya
DANGEROUS_EXTENSIONS = {".exe", ".bat", ".sh", ".cmd", ".msi", ".jar"}

RATE_LIMIT_WINDOW = 5
RATE_LIMIT_MAX_MSGS = 3

AUTO_BAN_REPORTS = 3
REPORT_WINDOW = 86400

SEARCH_COOLDOWN = 3

AVAILABLE_INTERESTS = {
    "gaming","movies","music","sports"}