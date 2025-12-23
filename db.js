require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

// Caching untuk fungsi yang sering dipanggil
const cache = new Map();
const CACHE_TTL = 300000; // 5 menit dalam milidetik

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  
  if (Date.now() - item.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  
  return item.value;
}

function setCached(key, value) {
  cache.set(key, {
    value,
    timestamp: Date.now()
  });
}

function clearCache() {
  cache.clear();
}

// Bersihkan cache secara berkala
setInterval(() => {
  const now = Date.now();
  for (const [key, item] of cache.entries()) {
    if (now - item.timestamp > CACHE_TTL) {
      cache.delete(key);
    }
  }
}, 60000); // Bersihkan setiap menit

const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "SUPABASE_URL dan SUPABASE_ANON_KEY harus diset di environment / .env"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Inisialisasi: cek koneksi Supabase.
 *
 * Schema yang direkomendasikan di Supabase (jalankan sekali di SQL editor):
 *
 * -- pasangan chat
 * create table if not exists pairs (
 *   user_id bigint primary key,
 *   partner_id bigint not null,
 *   created_at timestamptz default now()
 * );
 *
 * -- antrean user
 * create table if not exists queue_free (
 *   user_id bigint primary key,
 *   created_at timestamptz default now()
 * );
 *
 * -- laporan
 * create table if not exists reports (
 *   id bigserial primary key,
 *   reported_id bigint not null,
 *   reporter_id bigint not null,
 *   created_at timestamptz default now()
 * );
 *
 * -- user yang diblokir
 * create table if not exists banned_users (
 *   user_id bigint primary key,
 *   reason text,
 *   created_at timestamptz default now()
 * );
 *
 * -- pengaturan user (bahasa, dst)
 * create table if not exists user_settings (
 *   user_id bigint primary key,
 *   lang text default 'id'
 * );
 *
 * -- premium
 * create table if not exists premium (
 *   user_id bigint primary key,
 *   expires_at timestamptz not null
 * );
 */
async function initDb() {
  try {
    const { error } = await supabase.from("pairs").select("user_id").limit(1);
    if (error && error.code !== "PGRST116") {
      console.warn(
        "Peringatan: query awal ke tabel 'pairs' bermasalah:",
        error.message
      );
    }
  } catch (err) {
    console.error("Gagal menghubungi Supabase:", err.message);
    process.exit(1);
  }
  console.log("Supabase client siap digunakan");
}

/** ========== MATCHING & QUEUE ========== */

async function getPartner(userId) {
  try {
    const { data, error } = await supabase
      .from("pairs")
      .select("partner_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Supabase getPartner error:", {
        message: error.message,
        code: error.code,
        userId: userId,
        details: error.details
      });
      return null;
    }
    
    if (!data) return null;
    return Number(data.partner_id);
  } catch (err) {
    console.error("Unexpected error in getPartner:", {
      message: err.message,
      stack: err.stack,
      userId: userId
    });
    return null;
  }
}

async function setPair(userA, userB) {
  try {
    const now = new Date().toISOString();
    const rows = [
      { user_id: userA, partner_id: userB, created_at: now },
      { user_id: userB, partner_id: userA, created_at: now },
    ];

    const { error } = await supabase
      .from("pairs")
      .upsert(rows, { onConflict: "user_id" });

    if (error) {
      console.error("Supabase setPair error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userA: userA,
        userB: userB
      });
      return;
    }

    const { error: qErr } = await supabase
      .from("queue_free")
      .delete()
      .in("user_id", [userA, userB]);
      
    if (qErr) {
      console.error("Supabase setPair queue cleanup error:", {
        message: qErr.message,
        code: qErr.code,
        userA: userA,
        userB: userB
      });
    }
  } catch (err) {
    console.error("Unexpected error in setPair:", {
      message: err.message,
      stack: err.stack,
      userA: userA,
      userB: userB
    });
  }
}

async function clearPair(userId) {
  try {
    const partnerId = await getPartner(userId);
    if (!partnerId) return null;

    const { error } = await supabase
      .from("pairs")
      .delete()
      .in("user_id", [userId, partnerId]);

    if (error) {
      console.error("Supabase clearPair error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId,
        partnerId: partnerId
      });
      return null;
    }
    return partnerId;
  } catch (err) {
    console.error("Unexpected error in clearPair:", {
      message: err.message,
      stack: err.stack,
      userId: userId
    });
    return null;
  }
}

/**
 * Menambahkan user ke antrean pencarian pasangan.
 */
async function pushToQueue(userId) {
  try {
    // Periksa apakah user sudah ada di queue
    const { data: existingQueue, error: selectError } = await supabase
      .from("queue_free")
      .select("user_id")
      .eq("user_id", userId);

    if (selectError) {
      console.error("Supabase pushToQueue select error:", {
        message: selectError.message,
        code: selectError.code,
        details: selectError.details,
        userId: userId
      });
      return false;
    }

    // Jika user sudah ada di queue, tidak perlu ditambahkan lagi
    if (existingQueue && existingQueue.length > 0) {
      return true; // Sudah ada di queue
    }

    // Tambahkan user ke queue
    const { error } = await supabase
      .from("queue_free")
      .insert([
        {
          user_id: userId
        }
      ]);

    if (error) {
      console.error("Supabase pushToQueue insert error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId
      });
      return false;
    }

    return true;
  } catch (err) {
    console.error("Unexpected error in pushToQueue:", {
      message: err.message,
      stack: err.stack,
      userId: userId
    });
    return false;
  }
}

async function removeFromQueue(userId) {
  try {
    const { error } = await supabase
      .from("queue_free")
      .delete()
      .eq("user_id", userId);

    if (error) {
      console.error("Supabase removeFromQueue error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId
      });
    }
  } catch (err) {
    console.error("Unexpected error in removeFromQueue:", {
      message: err.message,
      stack: err.stack,
      userId: userId
    });
  }
}

/**
 * Mengambil satu user dari antrean (bukan diri sendiri).
 */
async function popFromQueueExcept(userId, preferPremium = false) {
  // Ambil kandidat dari queue_free yang bukan user ini
  // Jika preferPremium = true, prioritaskan user premium terlebih dahulu.
  try {
    let otherId = null;

    if (preferPremium) {
      // Cari premium dulu
      const { data: premList, error: premErr } = await supabase
        .from("queue_free")
        .select("user_id")
        .neq("user_id", userId);

      if (premErr && premErr.code !== "PGRST116") {
        console.error(
          "Supabase popFromQueueExcept premium list error:",
          {
            message: premErr.message,
            code: premErr.code,
            userId: userId,
            preferPremium: preferPremium
          }
        );
      } else if (Array.isArray(premList) && premList.length > 0) {
        for (const row of premList) {
          const uid = row.user_id;
          if (!uid) continue;
          const isPrem = await isPremium(uid);
          if (isPrem) {
            otherId = uid;
            // Hapus user yang dipilih dari queue
            await supabase
              .from("queue_free")
              .delete()
              .eq("user_id", uid);
            return otherId;
          }
        }
      }
    }

    if (!otherId) {
      // fallback: ambil satu user apa adanya
      const { data, error } = await supabase
        .from("queue_free")
        .select("user_id")
        .neq("user_id", userId)
        .limit(1)
        .maybeSingle();

      if (error && error.code !== "PGRST116") {
        console.error("Supabase popFromQueueExcept error:", {
          message: error.message,
          code: error.code,
          details: error.details,
          userId: userId,
          preferPremium: preferPremium
        });
        return null;
      }
      if (!data) return null;
      otherId = data.user_id;
    }

    const { error: delErr } = await supabase
      .from("queue_free")
      .delete()
      .eq("user_id", otherId);

    if (delErr && delErr.code !== "PGRST116") {
      console.error("Supabase popFromQueueExcept delete error:", {
        message: delErr.message,
        code: delErr.code,
        otherId: otherId
      });
    }

    return otherId;
  } catch (e) {
    console.error("Supabase popFromQueueExcept failure:", {
      message: e.message,
      stack: e.stack,
      userId: userId,
      preferPremium: preferPremium
    });
    return null;
  }
}

/** ========== REPORT & BAN ========== */

async function isBanned(userId) {
  try {
    const { data, error } = await supabase
      .from("banned_users")
      .select("user_id")
      .eq("user_id", userId)
      .limit(1);

    if (error) {
      console.error("Supabase isBanned error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId
      });
      return false;
    }
    return !!(data && data.length);
  } catch (err) {
    console.error("Unexpected error in isBanned:", {
      message: err.message,
      stack: err.stack,
      userId: userId
    });
    return false;
  }
}

async function banUser(userId, reason = "") {
  try {
    const payload = {
      user_id: userId,
      reason: reason || null,
      created_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("banned_users").upsert(payload, {
      onConflict: "user_id",
    });

    if (error) {
      console.error("Supabase banUser error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId,
        reason: reason
      });
    }
  } catch (err) {
    console.error("Unexpected error in banUser:", {
      message: err.message,
      stack: err.stack,
      userId: userId,
      reason: reason
    });
  }
}

async function unbanUser(userId) {
  try {
    const { error } = await supabase
      .from("banned_users")
      .delete()
      .eq("user_id", userId);

    if (error && error.code !== "PGRST116") {
      console.error("Supabase unbanUser error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId
      });
    }
  } catch (err) {
    console.error("Unexpected error in unbanUser:", {
      message: err.message,
      stack: err.stack,
      userId: userId
    });
  }
}

/**
 * Menambahkan report dan mengembalikan total report dalam window jam terakhir.
 */
async function addReport(
  reportedId,
  reporterId,
  windowHours = 24
) {
  const now = new Date().toISOString();
  const { error: insertErr } = await supabase.from("reports").insert({
    reported_id: reportedId,
    reporter_id: reporterId,
    created_at: now,
  });

  if (insertErr) {
    console.error("Supabase addReport insert error:", insertErr.message);
    return 0;
  }

  const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();

  const { count, error: countErr } = await supabase
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("reported_id", reportedId)
    .gte("created_at", since);

  if (countErr) {
    console.error("Supabase addReport count error:", countErr.message);
    return 1;
  }

  return count || 0;
}

/** ========== USER SETTINGS (LANG) ========== */

async function getUserLang(userId) {
  // Cek cache terlebih dahulu
  const cacheKey = `user_lang_${userId}`;
  const cached = getCached(cacheKey);
  if (cached !== null) {
    return cached;
  }
  
  try {
    const { data, error } = await supabase
      .from("user_settings")
      .select("lang")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Supabase getUserLang error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId
      });
      // Tetap cache hasil error untuk mencegah flooding
      setCached(cacheKey, "id");
      return "id";
    }
    
    const lang = (data && data.lang) || "id";
    setCached(cacheKey, lang);
    return lang;
  } catch (err) {
    console.error("Unexpected error in getUserLang:", {
      message: err.message,
      stack: err.stack,
      userId: userId
    });
    // Tetap cache hasil error untuk mencegah flooding
    setCached(cacheKey, "id");
    return "id";
  }
}

async function setUserLang(userId, lang) {
  try {
    const normalized = lang === "en" ? "en" : "id";
    const { error } = await supabase
      .from("user_settings")
      .upsert(
        { user_id: userId, lang: normalized },
        { onConflict: "user_id" }
      );
    
    if (error) {
      console.error("Supabase setUserLang error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId,
        lang: lang
      });
    } else {
      // Bersihkan cache ketika bahasa diubah
      const cacheKey = `user_lang_${userId}`;
      cache.delete(cacheKey);
    }
  } catch (err) {
    console.error("Unexpected error in setUserLang:", {
      message: err.message,
      stack: err.stack,
      userId: userId,
      lang: lang
    });
  }
}

/** ========== PREMIUM ========== */

async function isPremium(userId) {
  // Cek cache terlebih dahulu
  const cacheKey = `user_premium_${userId}`;
  const cached = getCached(cacheKey);
  if (cached !== null) {
    return cached;
  }
  
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("premium")
      .select("expires_at")
      .eq("user_id", userId)
      .gt("expires_at", now)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Supabase isPremium error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId
      });
      // Tetap cache hasil error untuk mencegah flooding
      setCached(cacheKey, false);
      return false;
    }
    
    const result = !!data;
    setCached(cacheKey, result);
    return result;
  } catch (err) {
    console.error("Unexpected error in isPremium:", {
      message: err.message,
      stack: err.stack,
      userId: userId
    });
    // Tetap cache hasil error untuk mencegah flooding
    setCached(cacheKey, false);
    return false;
  }
}

async function extendPremium(userId, days) {
  try {
    // Validasi input
    if (!userId || !Number.isInteger(userId) || userId <= 0) {
      console.error("extendPremium: invalid userId", { userId });
      return;
    }
    
    if (!days || !Number.isFinite(days) || days <= 0) {
      console.error("extendPremium: invalid days", { days });
      return;
    }
    
    // Batasi jumlah hari yang bisa ditambahkan dalam satu kali transaksi
    if (days > 3650) { // Maksimal 10 tahun
      console.warn("extendPremium: suspicious days amount", { userId, days });
      return;
    }
    
    const now = new Date();

    const { data, error } = await supabase
      .from("premium")
      .select("expires_at")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Supabase extendPremium select error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId
      });
      return;
    }

    let baseDate = now;
    if (data && data.expires_at) {
      const existing = new Date(data.expires_at);
      if (!Number.isNaN(existing.getTime()) && existing > now) {
        baseDate = existing;
      }
    }

    const newExpires = new Date(baseDate.getTime() + days * 86400 * 1000);
    const newExpiresIso = newExpires.toISOString();

    // Logging untuk audit
    console.log("extendPremium: extending premium", {
      userId,
      days,
      oldExpiry: data?.expires_at,
      newExpiry: newExpiresIso,
      timestamp: new Date().toISOString()
    });

    const { error: upErr } = await supabase
      .from("premium")
      .upsert(
        { user_id: userId, expires_at: newExpiresIso },
        { onConflict: "user_id" }
      );

    if (upErr) {
      console.error("Supabase extendPremium upsert error:", {
        message: upErr.message,
        code: upErr.code,
        details: upErr.details,
        userId: userId,
        days: days,
        newExpires: newExpiresIso
      });
    } else {
      // Bersihkan cache ketika status premium berubah
      const cacheKey = `user_premium_${userId}`;
      cache.delete(cacheKey);
    }
  } catch (err) {
    console.error("Unexpected error in extendPremium:", {
      message: err.message,
      stack: err.stack,
      userId: userId,
      days: days
    });
  }
}

/** ========== USER STATS ========== */
/*
 * Schema yang direkomendasikan:
 *
 * create table if not exists user_stats (
 *   user_id bigint primary key,
 *   total_chats bigint default 0,
 *   last_active timestamptz default now()
 * );
 */

async function incrementChatCount(userId) {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("user_stats")
    .select("total_chats")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("Supabase incrementChatCount select error:", error.message);
    return;
  }

  const current =
    data && typeof data.total_chats === "number" ? data.total_chats : 0;

  const { error: upErr } = await supabase.from("user_stats").upsert(
    {
      user_id: userId,
      total_chats: current + 1,
      last_active: nowIso,
    },
    { onConflict: "user_id" }
  );

  if (upErr) {
    console.error("Supabase incrementChatCount upsert error:", upErr.message);
  }
}

async function getUserStats(userId) {
  if (!userId) return { total_chats: 0, last_active: null, premium_expires_at: null };

  const { data, error } = await supabase
    .from("user_stats")
    .select("total_chats,last_active")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("Supabase getUserStats error:", error.message);
    return { total_chats: 0, last_active: null, premium_expires_at: null };
  }

  const base = {
    total_chats: data && data.total_chats ? Number(data.total_chats) : 0,
    last_active: data && data.last_active ? data.last_active : null,
    premium_expires_at: null,
  };

  // ambil expires premium dari tabel premium
  const { data: prem, error: premErr } = await supabase
    .from("premium")
    .select("expires_at")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (!premErr && prem && prem.expires_at) {
    base.premium_expires_at = prem.expires_at;
  }

  return base;
}

/** ========== PAYMENT TOGGLES ========== */
/*
 * Schema yang direkomendasikan:
 *
 * create table if not exists payment_settings (
 *   key text primary key,
 *   enabled boolean not null default true
 * );
 *
 * Dengan key misalnya:
 * - 'manual'   -> pembayaran manual e-wallet (DANA/OVO/Gopay)
 * - 'trakteer' -> pembayaran via Trakteer
 */

async function setPaymentEnabled(key, enabled) {
  const normalizedKey = key === "trakteer" ? "trakteer" : "manual";
  const { error } = await supabase.from("payment_settings").upsert(
    {
      key: normalizedKey,
      enabled: !!enabled,
    },
    { onConflict: "key" }
  );
  if (error) {
    console.error("Supabase setPaymentEnabled error:", error.message);
  }
}

async function isPaymentEnabled(key) {
  const normalizedKey = key === "trakteer" ? "trakteer" : "manual";
  const { data, error } = await supabase
    .from("payment_settings")
    .select("enabled")
    .eq("key", normalizedKey)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("Supabase isPaymentEnabled error:", error.message);
    return true;
  }

  if (!data || typeof data.enabled !== "boolean") {
    return true;
  }
  return data.enabled;
}

/** ========== PAYMENT SESSIONS ========== */
/*
 * Schema yang direkomendasikan:
 *
 * create table if not exists payment_sessions (
 *   user_id bigint primary key,
 *   mode text not null,           -- e.g. 'manual'
 *   created_at timestamptz default now()
 * );
 */

async function setPaymentSession(userId, mode) {
  if (!mode) {
    const { error } = await supabase
      .from("payment_sessions")
      .delete()
      .eq("user_id", userId);
    if (error) {
      console.error("Supabase setPaymentSession delete error:", error.message);
    }
    return;
  }

  const { error } = await supabase.from("payment_sessions").upsert(
    {
      user_id: userId,
      mode,
      created_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) {
    console.error("Supabase setPaymentSession upsert error:", error.message);
  }
}

async function getPaymentSession(userId) {
  const { data, error } = await supabase
    .from("payment_sessions")
    .select("mode")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("Supabase getPaymentSession error:", error.message);
    return null;
  }
  if (!data) return null;
  return data.mode || null;
}

/** ========== PAYMENT CODES (KODE UNIK) ========== */
/*
 * Schema yang direkomendasikan:
 *
 * create table if not exists payment_codes (
 *   code text primary key,
 *   user_id bigint not null,
 *   method text not null,             -- 'manual' | 'trakteer' | 'any'
 *   used boolean not null default false,
 *   created_at timestamptz default now()
 * );
 */

async function savePaymentCode(code, userId, method = "any") {
  if (!code || !userId) return;
  const payload = {
    code,
    user_id: userId,
    method,
    used: false,
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("payment_codes").upsert(payload, {
    onConflict: "code",
  });
  if (error) {
    console.error("Supabase savePaymentCode error:", error.message);
  }
}

/**
 * Mengambil kode pembayaran terakhir yang belum digunakan (used = false)
 * untuk user tertentu. Jika methodFilter diisi, hanya ambil kode dengan
 * method tersebut atau 'any'.
 */
async function getPendingPaymentCode(userId, methodFilter = null) {
  if (!userId) return null;

  let query = supabase
    .from("payment_codes")
    .select("code, used, method, created_at")
    .eq("user_id", userId)
    .eq("used", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await query;

  if (error && error.code !== "PGRST116") {
    console.error("Supabase getPendingPaymentCode error:", error.message);
    return null;
  }
  if (!data) return null;

  if (
    methodFilter &&
    data.method !== "any" &&
    data.method !== methodFilter
  ) {
    return null;
  }

  return data.code || null;
}

async function findUserByPaymentCode(code, method = null) {
  if (!code) return null;

  const { data, error } = await supabase
    .from("payment_codes")
    .select("user_id, used, method")
    .eq("code", code)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("Supabase findUserByPaymentCode error:", error.message);
    return null;
  }
  if (!data || data.used) return null;
  if (method && data.method !== "any" && data.method !== method) return null;

  return Number(data.user_id);
}

async function markPaymentCodeUsed(code) {
  if (!code) return;
  const { error } = await supabase
    .from("payment_codes")
    .update({ used: true })
    .eq("code", code);
  if (error) {
    console.error("Supabase markPaymentCodeUsed error:", error.message);
  }
}

async function markPaymentCodeUsed(code) {
  if (!code) return;
  const { error } = await supabase
    .from("payment_codes")
    .update({ used: true })
    .eq("code", code);
  if (error) {
    console.error("Supabase markPaymentCodeUsed error:", error.message);
  }
}

/** ========== PAYMENTS LOG (MANUAL/TRAKTEER) ========== */
/*
 * Schema yang direkomendasikan:
 *
 * create table if not exists payments (
 *   id bigserial primary key,
 *   user_id bigint not null,
 *   method text not null,         -- 'manual' | 'trakteer'
 *   amount bigint not null,
 *   days int not null,
 *   status text default 'pending',-- 'pending' | 'approved' | 'rejected'
 *   wallet text,
 *   ocr_text text,
 *   code text,
 *   tx_datetime timestamptz,
 *   created_at timestamptz default now()
 * );
 */

async function logPayment({
  userId,
  method,
  amount,
  days,
  status = "pending",
  wallet = "",
  ocrText = "",
  code = "",
  txDatetime = null,
}) {
  const payload = {
    user_id: userId,
    method,
    amount,
    days,
    status,
    wallet,
    ocr_text: ocrText,
    code: code || null,
    tx_datetime: txDatetime,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("payments").insert(payload);

  if (error) {
    console.error("Supabase logPayment error:", error.message);
  }
}

/**
 * Mengambil riwayat pembayaran user dari tabel payments.
 * Hanya mengembalikan beberapa field yang relevan.
 */
async function getPaymentHistory(userId, limit = 10) {
  if (!userId) return [];

  const { data, error } = await supabase
    .from("payments")
    .select(
      "method,amount,days,status,wallet,code,tx_datetime,created_at"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error && error.code !== "PGRST116") {
    console.error("Supabase getPaymentHistory error:", error.message);
    return [];
  }

  return Array.isArray(data) ? data : [];
}

/** ========== DISCOUNT CODES ========== */
/**
 * Tabel yang direkomendasikan:
 *
 * create table if not exists discount_codes (
 *   code text primary key,
 *   percent int not null,
 *   max_uses int not null default 0,
 *   used int not null default 0,
 *   min_amount bigint not null default 0,
 *   expire_at timestamptz,
 *   created_at timestamptz default now(),
 *   created_by bigint
 * );
 *
 * create table if not exists user_discounts (
 *   user_id bigint primary key,
 *   code text not null,
 *   created_at timestamptz default now()
 * );
 */

function normalizeDiscountCode(raw) {
  if (!raw) return "";
  return String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function createDiscountCode({
  rawCode,
  percent,
  maxUses,
  validHours,
  minAmount,
  createdBy,
}) {
  const code = normalizeDiscountCode(rawCode);
  if (!code) {
    throw new Error("Invalid discount code");
  }

  let p = Number(percent);
  if (!Number.isFinite(p)) p = 0;
  if (p < 1) p = 1;
  if (p > 100) p = 100;

  let max = Number(maxUses);
  if (!Number.isFinite(max) || max < 0) max = 0;

  let minAmt = Number(minAmount);
  if (!Number.isFinite(minAmt) || minAmt < 0) minAmt = 0;

  const now = new Date();
  let expireAt = null;
  const hours = Number(validHours);
  if (Number.isFinite(hours) && hours > 0) {
    expireAt = new Date(now.getTime() + hours * 3600 * 1000).toISOString();
  }

  const payload = {
    code,
    percent: p,
    max_uses: max,
    used: 0,
    min_amount: minAmt,
    expire_at: expireAt,
    created_at: now.toISOString(),
    created_by: createdBy || null,
  };

  const { error } = await supabase.from("discount_codes").upsert(payload, {
    onConflict: "code",
  });

  if (error) {
    console.error("Supabase createDiscountCode error:", error.message);
    throw new Error(error.message);
  }

  return payload;
}

/**
 * Mengambil info diskon jika masih berlaku.
 */
async function getDiscountInfo(rawCode) {
  const code = normalizeDiscountCode(rawCode);
  if (!code) return null;

  const { data, error } = await supabase
    .from("discount_codes")
    .select(
      "code,percent,max_uses,used,min_amount,expire_at,created_at,created_by,disabled"
    )
    .eq("code", code)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("Supabase getDiscountInfo error:", error.message);
    return null;
  }
  if (!data) return null;

  const now = new Date();
  const disabled = data.disabled ? true : false;
  if (disabled) return null;

  if (data.expire_at) {
    const exp = new Date(data.expire_at);
    if (Number.isFinite(exp.getTime()) && exp < now) {
      return null;
    }
  }

  const max = Number(data.max_uses || 0);
  const used = Number(data.used || 0);
  if (max > 0 && used >= max) {
    return null;
  }

  return {
    code: data.code,
    percent: Number(data.percent || 0),
    max_uses: max,
    used,
    min_amount: Number(data.min_amount || 0),
    expire_at: data.expire_at,
    created_at: data.created_at,
    created_by: data.created_by,
  };
}

/**
 * Mengaitkan diskon ke user jika kode masih berlaku.
 */
async function assignDiscountToUser(userId, rawCode) {
  const info = await getDiscountInfo(rawCode);
  if (!info) return null;

  const payload = {
    user_id: userId,
    code: info.code,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("user_discounts")
    .upsert(payload, { onConflict: "user_id" });

  if (error) {
    console.error("Supabase assignDiscountToUser error:", error.message);
    return null;
  }

  return info;
}

/**
 * Mengambil kode diskon aktif untuk user (jika ada dan masih valid).
 */
async function getUserDiscount(userId) {
  const { data, error } = await supabase
    .from("user_discounts")
    .select("code")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("Supabase getUserDiscount error:", error.message);
    return null;
  }
  if (!data || !data.code) return null;

  const info = await getDiscountInfo(data.code);
  if (!info) {
    // kode sudah tidak valid, bersihkan
    await clearUserDiscount(userId);
    return null;
  }

  return info.code;
}

async function clearUserDiscount(userId) {
  const { error } = await supabase
    .from("user_discounts")
    .delete()
    .eq("user_id", userId);
  if (error && error.code !== "PGRST116") {
    console.error("Supabase clearUserDiscount error:", error.message);
  }
}

/**
 * Menandai diskon telah terpakai (naikkan counter used).
 */
async function markDiscountUsed(rawCode, userId = null) {
  const code = normalizeDiscountCode(rawCode);
  if (!code) return;

  // naikan counter used dengan update sederhana
  const { data, error } = await supabase
    .from("discount_codes")
    .select("used")
    .eq("code", code)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("Supabase markDiscountUsed select error:", error.message);
    return;
  }
  if (!data) return;

  const current = Number(data.used || 0) || 0;

  const { error: upErr } = await supabase
    .from("discount_codes")
    .update({ used: current + 1 })
    .eq("code", code);

  if (upErr && upErr.code !== "PGRST116") {
    console.error("Supabase markDiscountUsed update error:", upErr.message);
  }
}

/**
 * Men-disable atau mengaktifkan ulang kode diskon.
 */
async function disableDiscountCode(rawCode, disabled = true) {
  const code = normalizeDiscountCode(rawCode);
  if (!code) return false;

  const { error } = await supabase
    .from("discount_codes")
    .update({ disabled })
    .eq("code", code);

  if (error && error.code !== "PGRST116") {
    console.error("Supabase disableDiscountCode error:", error.message);
    return false;
  }

  return true;
}

/**
 * Mengambil daftar user_id yang pernah tercatat (untuk broadcast).
 * Saat ini diambil dari tabel user_stats.
 */
async function getAllUserIdsForBroadcast() {
  try {
    // Gunakan pagination untuk menangani jumlah pengguna yang besar
    const ids = new Set();
    let lastId = 0;
    const batchSize = 1000;
    
    while (true) {
      const { data, error } = await supabase
        .from("user_stats")
        .select("user_id")
        .gt("user_id", lastId)
        .limit(batchSize)
        .order("user_id", { ascending: true });

      if (error && error.code !== "PGRST116") {
        console.error("Supabase getAllUserIdsForBroadcast error:", {
          message: error.message,
          code: error.code,
          details: error.details
        });
        break;
      }

      if (!Array.isArray(data) || data.length === 0) {
        break;
      }

      for (const row of data) {
        const id = Number(row.user_id);
        if (Number.isFinite(id) && id > 0) {
          ids.add(id);
        }
        lastId = id;
      }

      // Jika jumlah data kurang dari batch size, berarti sudah habis
      if (data.length < batchSize) {
        break;
      }
    }
    
    return Array.from(ids);
  } catch (err) {
    console.error("Unexpected error in getAllUserIdsForBroadcast:", {
      message: err.message,
      stack: err.stack
    });
    return [];
  }
}

/**
 * Mencatat pesan yang direport (text/media) untuk review admin.
 *
 * Tabel yang direkomendasikan:
 * create table if not exists reported_messages (
 *   id bigint generated by default as identity primary key,
 *   reporter_id bigint not null,
 *   partner_id bigint,
 *   message_type text not null,
 *   text text,
 *   text_hash text,
 *   ocr_text text,
 *   ocr_hash text,
 *   media_file_id text,
 *   media_unique_id text,
 *   created_at timestamptz default now()
 * );
 */
async function logReportedMessage({
  reporterId,
  partnerId,
  messageType,
  text = "",
  textHash = "",
  ocrText = "",
  ocrHash = "",
  mediaFileId = "",
  mediaUniqueId = "",
}) {
  const payload = {
    reporter_id: reporterId,
    partner_id: partnerId || null,
    message_type: messageType,
    text: text || null,
    text_hash: textHash || null,
    ocr_text: ocrText || null,
    ocr_hash: ocrHash || null,
    media_file_id: mediaFileId || null,
    media_unique_id: mediaUniqueId || null,
    created_at: new Date().toISOString(),
  };

  // minta balik id supaya bisa dipakai di callback data (hindari callback terlalu panjang)
  const { data, error } = await supabase
    .from("reported_messages")
    .insert(payload)
    .select("id")
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("Supabase logReportedMessage error:", error.message);
    return null;
  }

  return data ? data.id : null;
}

/**
 * Menghitung berapa banyak report lain dengan ocr_hash yang sama.
 */
async function countSimilarReports(ocrHash) {
  if (!ocrHash) return 0;
  const { count, error } = await supabase
    .from("reported_messages")
    .select("id", { count: "exact", head: true })
    .eq("ocr_hash", ocrHash);

  if (error && error.code !== "PGRST116") {
    console.error("Supabase countSimilarReports error:", error.message);
    return 0;
  }
  return typeof count === "number" ? count : 0;
}

/**
 * Tabel banned_media (konten terlarang):
 *
 * create table if not exists banned_media (
 *   id bigint generated by default as identity primary key,
 *   report_id bigint,
 *   media_type text,       -- 'text' | 'photo' | 'sticker' | 'video' | 'document' | 'voice'
 *   media_unique_id text,
 *   ocr_hash text,
 *   text_hash text,
 *   created_at timestamptz default now()
 * );
 */
async function banMedia({
  reportId = null,
  mediaType = "",
  mediaUniqueId = "",
  ocrHash = "",
  textHash = "",
}) {
  if (!mediaUniqueId && !ocrHash && !textHash) return;

  const payload = {
    report_id: reportId || null,
    media_type: mediaType || null,
    media_unique_id: mediaUniqueId || null,
    ocr_hash: ocrHash || null,
    text_hash: textHash || null,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("banned_media").insert(payload);
  if (error && error.code !== "PGRST116") {
    console.error("Supabase banMedia error:", error.message);
  }
}

async function isMediaBanned({ mediaUniqueId = "", ocrHash = "", textHash = "" }) {
  // cek sederhana: jika salah satu field match, anggap banned
  const orClauses = [];
  if (mediaUniqueId) orClauses.push(`media_unique_id.eq.${mediaUniqueId}`);
  if (ocrHash) orClauses.push(`ocr_hash.eq.${ocrHash}`);
  if (textHash) orClauses.push(`text_hash.eq.${textHash}`);
  if (!orClauses.length) return false;

  const { count, error } = await supabase
    .from("banned_media")
    .select("id", { count: "exact", head: true })
    .or(orClauses.join(","));

  if (error && error.code !== "PGRST116") {
    console.error("Supabase isMediaBanned error:", error.message);
    return false;
  }
  return typeof count === "number" && count > 0;
}

/** ========== PAYMENT CODES HELPERS ========== */

async function findUserByPaymentCode(code, methodFilter = null) {
  try {
    if (!code) {
      console.warn("findUserByPaymentCode: no code provided");
      return null;
    }
    
    // Validasi format kode
    if (!/^PAY-[A-Z0-9]{4,12}$/.test(code)) {
      console.warn("findUserByPaymentCode: invalid code format", { code });
      return null;
    }
    
    let query = supabase
      .from("payment_codes")
      .select("user_id,used,method")
      .eq("code", code)
      .limit(1)
      .maybeSingle();

    const { data, error } = await query;

    if (error && error.code !== "PGRST116") {
      console.error("Supabase findUserByPaymentCode error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        queryCode: code
      });
      return null;
    }
    
    if (!data) {
      console.log("findUserByPaymentCode: code not found", { code });
      return null;
    }
    
    if (data.used) {
      console.log("findUserByPaymentCode: code already used", { code });
      return null;
    }
    
    if (methodFilter && data.method !== methodFilter && data.method !== "any") {
      console.log("findUserByPaymentCode: method mismatch", { 
        code, 
        expectedMethod: methodFilter, 
        actualMethod: data.method 
      });
      return null;
    }
    
    const userId = Number(data.user_id);
    if (!userId || !Number.isInteger(userId) || userId <= 0) {
      console.error("findUserByPaymentCode: invalid userId in database", { 
        code, 
        userId: data.user_id 
      });
      return null;
    }
    
    return userId;
  } catch (err) {
    console.error("Unexpected error in findUserByPaymentCode:", {
      message: err.message,
      stack: err.stack,
      code: code,
      methodFilter: methodFilter
    });
    return null;
  }
}

async function markPaymentCodeUsed(code) {
  if (!code) return;
  const { error } = await supabase
    .from("payment_codes")
    .update({ used: true })
    .eq("code", code);
  if (error) {
    console.error("Supabase markPaymentCodeUsed error:", error.message);
  }
}

/** ========== USER TRUST ========== */
/*
 * Schema yang direkomendasikan:
 *
 * create table if not exists user_trust (
 *   user_id bigint primary key,
 *   score int not null default 100,
 *   total_reports_valid int not null default 0,
 *   updated_at timestamptz default now()
 * );
 */

async function getUserTrust(userId) {
  if (!userId) {
    return { score: 100, total_reports_valid: 0 };
  }

  const { data, error } = await supabase
    .from("user_trust")
    .select("score,total_reports_valid,updated_at")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("Supabase getUserTrust error:", error.message);
    return { score: 100, total_reports_valid: 0 };
  }

  if (!data) {
    return { score: 100, total_reports_valid: 0 };
  }

  return {
    score: typeof data.score === "number" ? data.score : 100,
    total_reports_valid:
      typeof data.total_reports_valid === "number"
        ? data.total_reports_valid
        : 0,
    updated_at: data.updated_at || null,
  };
}

async function adjustUserTrust(userId, delta) {
  if (!userId || !Number.isFinite(Number(delta))) return null;

  const nowIso = new Date().toISOString();

  const current = await getUserTrust(userId);
  let newScore = current.score + Number(delta);
  if (newScore > 100) newScore = 100;
  if (newScore < 0) newScore = 0;

  const { error } = await supabase.from("user_trust").upsert(
    {
      user_id: userId,
      score: newScore,
      total_reports_valid:
        current.total_reports_valid + (delta < 0 ? 1 : 0),
      updated_at: nowIso,
    },
    { onConflict: "user_id" }
  );

  if (error && error.code !== "PGRST116") {
    console.error("Supabase adjustUserTrust error:", error.message);
    return current;
  }

  return { score: newScore, total_reports_valid: current.total_reports_valid };
}

/** ========== USER INTERESTS ========== */
/*
 * Schema yang direkomendasikan:
 *
 * create table if not exists user_interests (
 *   user_id bigint not null,
 *   interest text not null,
 *   created_at timestamptz default now(),
 *   primary key (user_id, interest)
 * );
 */

async function getUserInterests(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from("user_interests")
    .select("interest")
    .eq("user_id", userId);

  if (error && error.code !== "PGRST116") {
    console.error("Supabase getUserInterests error:", error.message);
    return [];
  }

  if (!Array.isArray(data)) return [];
  return data.map((row) => row.interest).filter(Boolean);
}

async function setUserInterests(userId, interests) {
  if (!userId) return;
  const unique = Array.from(new Set((interests || []).filter(Boolean)));

  // hapus semua interest lama, lalu insert yang baru
  const del = await supabase
    .from("user_interests")
    .delete()
    .eq("user_id", userId);
  if (del.error && del.error.code !== "PGRST116") {
    console.error("Supabase setUserInterests delete error:", del.error.message);
  }

  if (!unique.length) return;

  const rows = unique.map((interest) => ({
    user_id: userId,
    interest,
    created_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("user_interests").insert(rows);
  if (error && error.code !== "PGRST116") {
    console.error("Supabase setUserInterests insert error:", error.message);
  }
}

/** ========== CHAT FEEDBACK ========== */
/*
 * Schema yang direkomendasikan:
 *
 * create table if not exists chat_feedback (
 *   id bigserial primary key,
 *   user_id bigint not null,
 *   partner_id bigint not null,
 *   type text not null,      -- 'like' | 'dislike' | 'report'
 *   reason text,
 *   created_at timestamptz default now()
 * );
 */

async function saveChatFeedback({ userId, partnerId, type, reason = null }) {
  if (!userId || !partnerId || !type) return;

  const payload = {
    user_id: userId,
    partner_id: partnerId,
    type,
    reason: reason || null,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("chat_feedback").insert(payload);
  if (error && error.code !== "PGRST116") {
    console.error("Supabase saveChatFeedback error:", error.message);
  }
}

/** ========== USER GENDER PROFILE ========== */
/*
 * Schema yang direkomendasikan:
 *
 * create table if not exists user_profile (
 *   user_id bigint primary key,
 *   gender text,         -- 'male' | 'female' | 'other'
 *   target_gender text,  -- 'male' | 'female' | 'other' | 'any'
 *   updated_at timestamptz default now()
 * );
 */

async function getUserProfile(userId) {
  if (!userId) {
    return { gender: null, target_gender: null };
  }
  const { data, error } = await supabase
    .from("user_profile")
    .select("gender,target_gender")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("Supabase getUserProfile error:", error.message);
    return { gender: null, target_gender: null };
  }

  if (!data) {
    return { gender: null, target_gender: null };
  }

  return {
    gender: data.gender || null,
    target_gender: data.target_gender || null,
  };
}

async function setMyGender(userId, gender) {
  if (!userId) return;
  const allowed = ["male", "female", "other"];
  const norm = (gender || "").toLowerCase();
  if (!allowed.includes(norm)) return;
  const nowIso = new Date().toISOString();

  const { error } = await supabase.from("user_profile").upsert(
    {
      user_id: userId,
      gender: norm,
      updated_at: nowIso,
    },
    { onConflict: "user_id" }
  );

  if (error && error.code !== "PGRST116") {
    console.error("Supabase setMyGender error:", error.message);
  }
}

async function setTargetGender(userId, targetGender) {
  if (!userId) return;
  const allowed = ["male", "female", "other", "any"];
  const norm = (targetGender || "").toLowerCase();
  if (!allowed.includes(norm)) return;
  const nowIso = new Date().toISOString();

  const { error } = await supabase.from("user_profile").upsert(
    {
      user_id: userId,
      target_gender: norm === "any" ? null : norm,
      updated_at: nowIso,
    },
    { onConflict: "user_id" }
  );

  if (error && error.code !== "PGRST116") {
    console.error("Supabase setTargetGender error:", error.message);
  }
}

async function clearTargetGender(userId) {
  if (!userId) return;
  const { error } = await supabase
    .from("user_profile")
    .update({ target_gender: null })
    .eq("user_id", userId);

  if (error && error.code !== "PGRST116") {
    console.error("Supabase clearTargetGender error:", error.message);
  }
}

module.exports = {
  supabase,
  initDb,
  // matching
  getPartner,
  setPair,
  clearPair,
  removeFromQueue,
  popFromQueueExcept,
  pushToQueue,
  // report & ban
  isBanned,
  banUser,
  unbanUser,
  addReport,
  // user settings
  getUserLang,
  setUserLang,
  // premium
  isPremium,
  extendPremium,
  // stats
  incrementChatCount,
  getUserStats,
  // payment toggles
  setPaymentEnabled,
  isPaymentEnabled,
  // payment sessions
  setPaymentSession,
  getPaymentSession,
  // payments log
  logPayment,
  getPaymentHistory,
  // payment codes & discounts
  savePaymentCode,
  getPendingPaymentCode,
  findUserByPaymentCode,
  markPaymentCodeUsed,
  // discounts
  createDiscountCode,
  getDiscountInfo,
  assignDiscountToUser,
  getUserDiscount,
  clearUserDiscount,
  markDiscountUsed,
  disableDiscountCode,
  getAllUserIdsForBroadcast,
  logReportedMessage,
  countSimilarReports,
  banMedia,
  isMediaBanned,
  // trust
  getUserTrust,
  adjustUserTrust,
  // interests
  getUserInterests,
  setUserInterests,
  // feedback
  saveChatFeedback,
  // profile
  getUserProfile,
  setMyGender,
  setTargetGender,
  clearTargetGender,
};