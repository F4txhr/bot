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
 * Inisialisasi schema minimal:
 * - pairs: menyimpan pasangan user (1 baris per user, simetris)
 * - queue_free: antrean user yang menunggu pasangan
 *
 * Catatan: Supabase (Postgres) biasanya tidak membuat tabel otomatis dari kode.
 * Untuk production sebaiknya tabel dibuat lewat dashboard Supabase dengan schema:
 *
 * CREATE TABLE pairs (
 *   user_id bigint primary key,
 *   partner_id bigint not null,
 *   created_at timestamptz default now()
 * );
 *
 * CREATE TABLE queue_free (
 *   user_id bigint primary key,
 *   created_at timestamptz default now()
 * );
 *
 * Namun di sini kita hanya cek keberadaan dengan query sederhana.
 */
async function initDb() {
  try {
    // Cek koneksi dengan query ringan.
    const { error } = await supabase.from("pairs").select("user_id").limit(1);
    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows found; kalau error lain berarti masalah lain (tabel belum ada / permission)
      console.warn("Peringatan: query awal ke tabel 'pairs' bermasalah:", error.message);
    }
  } catch (err) {
    console.error("Gagal menghubungi Supabase:", err.message);
    process.exit(1);
  }
  console.log("Supabase client siap digunakan");
}

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

  // Pastikan keduanya keluar dari antrean
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
 * Catatan: Supabase/Postgres tidak punya locking sederhana via client JS,
 * tapi untuk load ringan, pendekatan ini sudah cukup:
 * - ambil 1 user lain paling awal
 * - hapus dia dari antrean
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
    console.error("Supabase popFromQueueExcept delete error:", delErr.message);
  }

  return Number(otherId);
}

async function pushToQueue(userId) {
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("queue_free")
    .upsert(
      { user_id: userId, created_at: now },
      { onConflict: "user_id" }
    );

  if (error) {
    console.error("Supabase pushToQueue error:", error.message);
  }
}

module.exports = {
  initDb,
  getPartner,
  setPair,
  clearPair,
  removeFromQueue,
  popFromQueueExcept,
  pushToQueue,
};