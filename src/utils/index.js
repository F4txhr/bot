/**
 * Fungsi untuk membuat batch dari array
 */
function createBatch(array, batchSize = 50) {
  const batches = [];
  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Fungsi untuk delay (async sleep)
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fungsi untuk memvalidasi input
 */
function validateUserId(userId) {
  return typeof userId === 'number' && userId > 0;
}

function validateText(text, maxLength = 4000) {
  return typeof text === 'string' && text.length > 0 && text.length <= maxLength;
}

/**
 * Fungsi untuk memformat durasi dalam milidetik ke format yang lebih mudah dibaca
 */
function formatDuration(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Fungsi untuk membuat logger dengan level
 */
function createLogger(prefix = '') {
  return {
    debug: (message, meta = {}) => {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[DEBUG${prefix ? ` ${prefix}` : ''}]`, message, meta);
      }
    },
    info: (message, meta = {}) => {
      console.log(`[INFO${prefix ? ` ${prefix}` : ''}]`, message, meta);
    },
    warn: (message, meta = {}) => {
      console.warn(`[WARN${prefix ? ` ${prefix}` : ''}]`, message, meta);
    },
    error: (message, meta = {}) => {
      console.error(`[ERROR${prefix ? ` ${prefix}` : ''}]`, message, meta);
    }
  };
}

// Cache untuk sistem trust (menggantikan Redis)
const trustScores = new Map(); // userId -> trustScore
const userReports = new Map(); // userId -> {reporterId: timestamp}
const userRatings = new Map(); // userId -> {good: count, neutral: count, bad: count}
const userCooldowns = new Map(); // userId -> timestamp

// Konstanta sistem trust
const TRUST_MIN = 0;
const TRUST_MAX = 100;
const TRUST_INITIAL = 50;
const TRUST_HIGH_THRESHOLD = 70;
const TRUST_NORMAL_THRESHOLD = 40;
const TRUST_LOW_THRESHOLD = 10;
const TRUST_PENALTY_PER_REPORT = 5;
const REPORT_WINDOW = 24 * 60 * 60 * 1000; // 24 jam dalam milidetik
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 menit
const AUTO_BAN_REPORTS = 5;
const SEARCH_COOLDOWN = 3000; // 3 detik dalam milidetik

/**
 * Mendapatkan skor trust pengguna (0-100)
 */
function getTrustScore(userId) {
  if (!trustScores.has(userId)) {
    return TRUST_INITIAL;
  }
  let score = trustScores.get(userId);
  if (score < TRUST_MIN) score = TRUST_MIN;
  if (score > TRUST_MAX) score = TRUST_MAX;
  return score;
}

/**
 * Menetapkan skor trust pengguna
 */
function setTrustScore(userId, score) {
  if (score < TRUST_MIN) score = TRUST_MIN;
  if (score > TRUST_MAX) score = TRUST_MAX;
  trustScores.set(userId, score);
  return score;
}

/**
 * Memperbarui skor trust dengan delta
 */
function updateTrust(userId, delta) {
  const current = getTrustScore(userId);
  return setTrustScore(userId, current + delta);
}

/**
 * Mendapatkan level trust pengguna
 */
function getTrustLevel(userId) {
  const score = getTrustScore(userId);
  if (score >= TRUST_HIGH_THRESHOLD) return "high";
  if (score >= TRUST_NORMAL_THRESHOLD) return "normal";
  if (score >= TRUST_LOW_THRESHOLD) return "low";
  return "hell";
}

/**
 * Menambahkan laporan untuk pengguna
 */
function addReport(userId, reporterId) {
  const now = Date.now();
  
  // Bersihkan laporan lama (lebih dari 24 jam)
  const reports = userReports.get(userId) || {};
  const validReports = {};
  for (const [repId, timestamp] of Object.entries(reports)) {
    if (now - timestamp < REPORT_WINDOW) {
      validReports[repId] = timestamp;
    }
  }
  
  // Tambahkan laporan baru
  validReports[reporterId] = now;
  userReports.set(userId, validReports);
  
  // Kurangi trust score
  updateTrust(userId, -TRUST_PENALTY_PER_REPORT);
  
  return Object.keys(validReports).length;
}

/**
 * Menambahkan rating untuk pengguna
 */
function addRating(userId, rating) {
  if (!['good', 'neutral', 'bad'].includes(rating)) return;
  
  if (!userRatings.has(userId)) {
    userRatings.set(userId, { good: 0, neutral: 0, bad: 0 });
  }
  
  const ratings = userRatings.get(userId);
  ratings[rating] = (ratings[rating] || 0) + 1;
}

/**
 * Memeriksa apakah pengguna masih dalam cooldown pencarian
 */
function isSearchCooldown(userId, cooldownMs = SEARCH_COOLDOWN) {
  const lastSearch = userCooldowns.get(userId);
  const now = Date.now();
  
  if (lastSearch && (now - lastSearch) < cooldownMs) {
    return true;
  }
  
  // Set cooldown baru
  userCooldowns.set(userId, now);
  return false;
}

/**
 * Membersihkan cache secara berkala
 */
function cleanupCache() {
  const now = Date.now();
  
  // Bersihkan cooldown lama
  for (const [userId, timestamp] of userCooldowns.entries()) {
    if (now - timestamp > 5 * 60 * 1000) { // 5 menit
      userCooldowns.delete(userId);
    }
  }
  
  // Bersihkan cache lain jika perlu
  // (logika pembersihan cache lain bisa ditambahkan di sini)
}

// Cache untuk sistem diskon
const discountCodes = new Map(); // code -> {percent, max_uses, used, created_by, created_at, expire_at, min_amount, disabled}
const userDiscounts = new Map(); // userId -> code
const discountUsage = new Map(); // code:userId -> count
const MAX_DISCOUNT_PER_USER = 3;

/**
 * Normalisasi kode diskon (hanya huruf dan angka, kapital)
 */
function normalizeDiscountCode(code) {
  if (!code) return "";
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Membuat kode diskon baru
 */
function createDiscountCode(rawCode, percent, maxUses, validHours, createdBy, minAmount = 0) {
  const code = normalizeDiscountCode(rawCode);
  if (!code) {
    throw new Error("Invalid discount code");
  }

  if (percent < 1) percent = 1;
  if (percent > 100) percent = 100;
  if (minAmount < 0) minAmount = 0;

  const now = Date.now();
  const expireAt = validHours > 0 ? now + (validHours * 60 * 60 * 1000) : 0;

  const discountInfo = {
    code,
    percent,
    maxUses,
    used: 0,
    createdBy,
    createdAt: now,
    expireAt,
    minAmount,
    disabled: false
  };

  discountCodes.set(code, discountInfo);
  
  // Set timeout untuk menghapus kode kadaluarsa jika ada batas waktu
  if (validHours > 0) {
    setTimeout(() => {
      if (discountCodes.has(code)) {
        discountCodes.delete(code);
      }
    }, validHours * 60 * 60 * 1000);
  }

  return discountInfo;
}

/**
 * Mendapatkan info kode diskon
 */
function getDiscountInfo(rawCode) {
  const code = normalizeDiscountCode(rawCode);
  if (!code) return null;

  const info = discountCodes.get(code);
  if (!info || info.disabled) return null;

  const now = Date.now();
  if (info.expireAt > 0 && now > info.expireAt) {
    discountCodes.delete(code); // Hapus kode yang kadaluarsa
    return null;
  }

  if (info.maxUses > 0 && info.used >= info.maxUses) {
    return null; // Sudah mencapai batas pemakaian
  }

  return { ...info };
}

/**
 * Mengaitkan kode diskon ke pengguna
 */
function assignDiscountToUser(userId, rawCode) {
  const info = getDiscountInfo(rawCode);
  if (!info) return null;

  const code = info.code;
  
  // Cek berapa kali user ini sudah pakai kode ini
  const usageKey = `${code}:${userId}`;
  const usedByUser = discountUsage.get(usageKey) || 0;
  
  if (usedByUser >= MAX_DISCOUNT_PER_USER) {
    return null; // Sudah mencapai batas pemakaian per user
  }

  // Simpan kode diskon ke user
  userDiscounts.set(userId, code);
  return info;
}

/**
 * Mendapatkan kode diskon aktif untuk pengguna
 */
function getUserDiscount(userId) {
  return userDiscounts.get(userId) || null;
}

/**
 * Menghapus kode diskon dari pengguna
 */
function clearUserDiscount(userId) {
  userDiscounts.delete(userId);
}

/**
 * Menandai bahwa kode diskon telah digunakan
 */
function markDiscountUsed(rawCode, userId = null) {
  const code = normalizeDiscountCode(rawCode);
  if (!code) return;

  const info = discountCodes.get(code);
  if (!info) return;

  // Tambahkan penggunaan global
  if (info.maxUses > 0) {
    info.used = (info.used || 0) + 1;
  }

  // Tambahkan penggunaan per user
  if (userId !== null) {
    const usageKey = `${code}:${userId}`;
    const currentCount = discountUsage.get(usageKey) || 0;
    discountUsage.set(usageKey, currentCount + 1);
  }
}

/**
 * Menonaktifkan kode diskon
 */
function clearDiscountCode(rawCode) {
  const code = normalizeDiscountCode(rawCode);
  if (!code) return false;

  const info = discountCodes.get(code);
  if (!info) return false;

  info.disabled = true;
  return true;
}

// Jalankan cleanup setiap 1 menit
setInterval(cleanupCache, 60000);

module.exports = {
  createBatch,
  delay,
  validateUserId,
  validateText,
  formatDuration,
  createLogger,
  // Trust system
  getTrustScore,
  setTrustScore,
  updateTrust,
  getTrustLevel,
  addReport,
  addRating,
  isSearchCooldown,
  // Discount system
  createDiscountCode,
  getDiscountInfo,
  assignDiscountToUser,
  getUserDiscount,
  clearUserDiscount,
  markDiscountUsed,
  clearDiscountCode,
  normalizeDiscountCode,
  // Konstanta
  TRUST_MIN,
  TRUST_MAX,
  TRUST_INITIAL,
  TRUST_HIGH_THRESHOLD,
  TRUST_NORMAL_THRESHOLD,
  TRUST_LOW_THRESHOLD,
  TRUST_PENALTY_PER_REPORT,
  REPORT_WINDOW,
  AUTO_BAN_REPORTS,
  SEARCH_COOLDOWN,
  MAX_DISCOUNT_PER_USER
};