const fs = require("fs");
const path = require("path");
require("dotenv").config();

// Lokasi file database JSON. Jika DB_PATH tidak diset,
// default ke file "shadowchat.json" di direktori yang sama dengan script.
const dbPath =
  process.env.DB_PATH || path.join(__dirname, "shadowchat.json");

// State di memori:
// {
//   pairs: { [userId: string]: string }, // user -> partner
//   queue: string[]                      // antrean userId
// }
let state = {
  pairs: {},
  queue: [],
};

function loadState() {
  try {
    if (!fs.existsSync(dbPath)) {
      return;
    }
    const raw = fs.readFileSync(dbPath, "utf8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object") {
      if (data.pairs && typeof data.pairs === "object") {
        state.pairs = data.pairs;
      }
      if (Array.isArray(data.queue)) {
        state.queue = data.queue.map((x) => String(x));
      }
    }
  } catch (err) {
    console.error("Gagal membaca file DB, gunakan state kosong:", err.message);
    state = { pairs: {}, queue: [] };
  }
}

function saveState() {
  try {
    const tmpPath = dbPath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(state));
    fs.renameSync(tmpPath, dbPath);
  } catch (err) {
    console.error("Gagal menyimpan file DB:", err.message);
  }
}

/**
 * Inisialisasi "DB" berbasis file JSON.
 * Akan membuat file baru jika belum ada.
 */
async function initDb() {
  loadState();
  console.log("JSON DB inisialisasi di", dbPath);
}

async function getPartner(userId) {
  const uid = String(userId);
  const partner = state.pairs[uid];
  if (!partner) return null;
  return Number(partner);
}

async function setPair(userA, userB) {
  const a = String(userA);
  const b = String(userB);

  state.pairs[a] = b;
  state.pairs[b] = a;

  // Pastikan mereka keluar dari antrean
  state.queue = state.queue.filter((id) => id !== a && id !== b);

  saveState();
}

async function clearPair(userId) {
  const uid = String(userId);
  const partnerId = state.pairs[uid];
  if (!partnerId) return null;

  delete state.pairs[uid];
  delete state.pairs[String(partnerId)];

  saveState();
  return Number(partnerId);
}

async function removeFromQueue(userId) {
  const uid = String(userId);
  const before = state.queue.length;
  state.queue = state.queue.filter((id) => id !== uid);
  if (state.queue.length !== before) {
    saveState();
  }
}

/**
 * Mengambil satu user dari antrean (bukan diri sendiri).
 */
async function popFromQueueExcept(userId) {
  const uid = String(userId);
  const idx = state.queue.findIndex((id) => id !== uid);
  if (idx === -1) return null;

  const otherId = state.queue[idx];
  state.queue.splice(idx, 1);

  saveState();
  return Number(otherId);
}

async function pushToQueue(userId) {
  const uid = String(userId);
  if (!state.queue.includes(uid)) {
    state.queue.push(uid);
    saveState();
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