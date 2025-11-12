import re
import unicodedata
import time
import random
import string
from typing import Optional, List
import redis
from config import (
    REDIS_URL, BAD_WORDS, DANGEROUS_EXTENSIONS, 
    RATE_LIMIT_WINDOW, RATE_LIMIT_MAX_MSGS,
    AUTO_BAN_REPORTS, REPORT_WINDOW
)

# Redis client dengan support localhost & production
r = redis.from_url(REDIS_URL, decode_responses=True)

def normalize_text(text: str) -> str:
    """Normalize text untuk deteksi kata kasar yang di-obfuscate"""
    text = unicodedata.normalize('NFD', text)
    text = text.encode('ascii', 'ignore').decode('utf-8')
    replacements = {'1': 'i', '3': 'e', '4': 'a', '0': 'o', '7': 't', '5': 's'}
    for k, v in replacements.items():
        text = text.replace(k, v)
    return text

def censor_text(text: str) -> str:
    """Sensor kata-kata kasar dalam text"""
    if not text:
        return text
    words = text.split()
    censored = []
    for word in words:
        clean = re.sub(r'[^a-zA-Z]', '', normalize_text(word).lower())
        if clean in BAD_WORDS:
            censored.append("*" * len(word))
        else:
            censored.append(word)
    return " ".join(censored)

def is_dangerous_file(filename: str) -> bool:
    """Check apakah file berbahaya"""
    if not filename or "." not in filename:
        return False
    
    # Perbaikan: Split menggunakan '.' untuk mendapatkan ekstensi
    parts = filename.split(".") 
    
    for part in parts[1:]:
        # Perbaikan: f-string yang benar (tanpa spasi di antara f dan ")
        # Hanya membandingkan ekstensi (.ext)
        if f".{part.lower()}" in DANGEROUS_EXTENSIONS:
            return True
    return False

def is_rate_limited(user_id: int) -> bool:
    """Check apakah user sedang rate limited"""
    key = f"rate:{user_id}"
    now = int(time.time())
    
    # Remove old entries
    r.zremrangebyscore(key, 0, now - RATE_LIMIT_WINDOW)
    
    # Count current messages
    count = r.zcard(key)
    
    if count >= RATE_LIMIT_MAX_MSGS:
        return True
    
    # Add current timestamp
    r.zadd(key, {now: now})
    r.expire(key, RATE_LIMIT_WINDOW)
    return False

def is_search_cooldown(user_id: int, cooldown: int = 3) -> bool:
    """Check apakah user masih dalam cooldown /search"""
    key = f"cooldown:search:{user_id}"
    if r.exists(key):
        return True
    r.setex(key, cooldown, "1")
    return False

def generate_payment_code() -> str:
    """Generate kode pembayaran unik"""
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))

def create_payment_code(user_id: int, days: int, amount: int) -> str:
    """Create dan simpan kode pembayaran untuk user"""
    code = f"PAY-{generate_payment_code()}"
    key = f"payment:{code}"
    
    r.hset(key, mapping={
        "user_id": user_id,
        "days": days,
        "amount": amount,
        "created_at": int(time.time())
    })
    r.expire(key, 3600)  # Expire dalam 1 jam
    
    return code

def verify_payment_code(code: str) -> Optional[dict]:
    """Verify dan retrieve payment code data"""
    key = f"payment:{code}"
    if not r.exists(key):
        return None
    
    data = r.hgetall(key)
    if data:
        return {
            "user_id": int(data["user_id"]),
            "days": int(data["days"]),
            "amount": int(data["amount"]),
            "created_at": int(data["created_at"])
        }
    return None

def delete_payment_code(code: str):
    """Delete payment code setelah diverifikasi"""
    key = f"payment:{code}"
    r.delete(key)

def add_report(user_id: int, reporter_id: int) -> int:
    """Add report untuk user, return jumlah report dalam 24 jam"""
    key = f"reports:{user_id}"
    now = int(time.time())
    
    # Remove old reports (lebih dari 24 jam)
    r.zremrangebyscore(key, 0, now - REPORT_WINDOW)
    
    # Add new report
    r.zadd(key, {reporter_id: now})
    r.expire(key, REPORT_WINDOW)
    
    # Count total reports
    return r.zcard(key)

def ban_user(user_id: int, reason: str = "Multiple reports"):
    """Ban user"""
    r.set(f"user:{user_id}:banned", reason)

def is_banned(user_id: int) -> bool:
    """Check apakah user dibanned"""
    return r.exists(f"user:{user_id}:banned")

def unban_user(user_id: int):
    """Unban user"""
    r.delete(f"user:{user_id}:banned")
    r.delete(f"reports:{user_id}")

def get_active_users(hours: int = 24) -> List[int]:
    """Get list user ID yang aktif dalam X jam terakhir"""
    key = "active_users"
    now = int(time.time())
    cutoff = now - (hours * 3600)
    
    # Get users aktif
    user_ids = r.zrangebyscore(key, cutoff, now)
    return [int(uid) for uid in user_ids]

def update_user_activity(user_id: int):
    """Update last activity user"""
    key = "active_users"
    now = int(time.time())
    r.zadd(key, {user_id: now})

def get_free_users() -> List[int]:
    """Get list user yang tidak punya premium"""
    active_users = get_active_users(24)
    free_users = []
    
    for user_id in active_users:
        if not r.exists(f"user:{user_id}:premium"):
            free_users.append(user_id)
    
    return free_users

def get_user_stats(user_id: int) -> dict:
    """Get statistics untuk user"""
    stats = {
         "total_chats": int(r.get(f"stats:{user_id}:total_chats") or 0),
         "premium": r.exists(f"user:{user_id}:premium"),
         "gender": r.get(f"user:{user_id}:gender") or "not_set",
         "interests": r.smembers(f"user:{user_id}:interests") or set()
    }
    
    if stats["premium"]:
        ttl = r.ttl(f"user:{user_id}:premium")
        stats["premium_days_left"] = ttl // 86400 if ttl > 0 else 0
    
    return stats

def increment_chat_count(user_id: int):
    """Increment total chat count untuk user"""
    key = f"stats:{user_id}:total_chats"
    r.incr(key)

def get_global_stats() -> dict:
    """Get global statistics (untuk admin)"""
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
        "total_banned": total_banned
    }
