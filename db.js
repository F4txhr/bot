require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

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
  const { data, error } = await supabase
    .from("pairs")
    .select("partner_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Supabase getPartner error:", error.message);
    return null;
  }
  if (!data) return null;
  return Number(data.partner_id);
}

async function setPair(userA, userB) {
  const now = new Date().toISOString();
  const rows = [
    { user_id: userA, partner_id: userB, created_at: now },
    { user_id: userB, partner_id: userA, created_at: now },
  ];

  const { error } = await supabase
    .from("pairs")
    .upsert(rows, { onConflict: "user_id" });

  if (error) {
    console.error("Supabase setPair error:", error.message);
    return;
  }

  const { error: qErr } = await supabase
    .from("queue_free")
    .delete()
    .in("user_id", [userA, userB]);

  if (qErr) {
    console.error("Supabase setPair queue cleanup error:", qErr.message);
  }
}

async function clearPair(userId) {
  const partnerId = await getPartner(userId);
  if (!partnerId) return null;

  const { error } = await supabase
    .from("pairs")
    .delete()
    .in("user_id", [userId, partnerId]);

  if (error) {
    console.error("Supabase clearPair error:", error.message);
    return null;
  }
  return partnerId;
}

async function removeFromQueue(userId) {
  const { error } = await supabase
    .from("queue_free")
    .delete()
    .eq("user_id", userId);

  if (error) {
    console.error("Supabase removeFromQueue error:", error.message);
  }
}

/**
 * Mengambil satu user dari antrean (bukan diri sendiri).
 */
async function popFromQueueExcept(userId) {
  const { data, error } = await supabase
    .from("queue_free")
    .select("user_id")
    .neq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    console.error("Supabase popFromQueueExcept select error:", error.message);
    return null;
  }
  if (!data || !data.length) return null;

  const otherId = data[0].user_id;

  const { error: delErr } = await supabase
    .from("queue_free")
    .delete()
    .eq("user_id", otherId);

  if (delErr) {
    console.error(
      "Supabase popFromQueueExcept delete error:",
      delErr.message
    );
  }

  return Number(otherId);
}

async function pushToQueue(userId) {
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("queue_free")
    .upsert({ user_id: userId, created_at: now }, { onConflict: "user_id" });

  if (error) {
    console.error("Supabase pushToQueue error:", error.message);
  }
}

/** ========== REPORT & BAN ========== */

async function isBanned(userId) {
  const { data, error } = await supabase
    .from("banned_users")
    .select("user_id")
    .eq("user_id", userId)
    .limit(1);

  if (error) {
    console.error("Supabase isBanned error:", error.message);
    return false;
  }
  return !!(data && data.length);
}

async function banUser(userId, reason = "Multiple reports") {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("banned_users")
    .upsert(
      { user_id: userId, reason, created_at: now },
      { onConflict: "user_id" }
    );
  if (error) {
    console.error("Supabase banUser error:", error.message);
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
  const { data, error } = await supabase
    .from("user_settings")
    .select("lang")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Supabase getUserLang error:", error.message);
    return "id";
  }
  return (data && data.lang) || "id";
}

async function setUserLang(userId, lang) {
  const normalized = lang === "en" ? "en" : "id";
  const { error } = await supabase
    .from("user_settings")
    .upsert(
      { user_id: userId, lang: normalized },
      { onConflict: "user_id" }
    );
  if (error) {
    console.error("Supabase setUserLang error:", error.message);
  }
}

/** ========== PREMIUM ========== */

async function isPremium(userId) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("premium")
    .select("expires_at")
    .eq("user_id", userId)
    .gt("expires_at", now)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Supabase isPremium error:", error.message);
    return false;
  }
  return !!data;
}

async function extendPremium(userId, days) {
  const now = new Date();

  const { data, error } = await supabase
    .from("premium")
    .select("expires_at")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Supabase extendPremium select error:", error.message);
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

  const { error: upErr } = await supabase
    .from("premium")
    .upsert(
      { user_id: userId, expires_at: newExpiresIso },
      { onConflict: "user_id" }
    );

  if (upErr) {
    console.error("Supabase extendPremium upsert error:", upErr.message);
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

  const current = data && typeof data.total_chats === "number"
    ? data.total_chats
    : 0;

  const { error: upErr } = await supabase
    .from("user_stats")
    .upsert(
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
  const { data, error } = await supabase
    .from("user_stats")
    .select("total_chats,last_active")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("Supabase getUserStats error:", error.message);
    return { total_chats: 0, last_active: null };
  }

  if (!data) {
    return { total_chats: 0, last_active: null };
  }

  return {
    total_chats: data.total_chats || 0,
    last_active: data.last_active || null,
  };
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
};