const path = require("path");
const Database = require("better-sqlite3");
require("dotenv").config();

// Lokasi file database. Jika DB_PATH tidak diset,
// default ke file "shadowchat.db" di direktori yang sama dengan script.
const dbPath =
  process.env.DB_PATH || path.join(__dirname, "shadowchat.db");

// Akan otomatis membuat file jika belum ada.
const db = new Database(dbPath);

/**
 * Inisialisasi schema minimal:
 * - pairs: menyimpan pasangan user (1 baris per user, simetris)
 * - queue_free: antrean user yang menunggu pasangan
 */
async function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pairs (
      user_id INTEGER PRIMARY KEY,
      partner_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS queue_free (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  console.log("SQLite DB inisialisasi di", dbPath);
}

async function getPartner(userId) {
  const row = db
    .prepare("SELECT partner_id FROM pairs WHERE user_id = ? LIMIT 1")
    .get(userId);
  if (!row) return null;
  return Number(row.partner_id);
}

async function setPair(userA, userB) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO pairs (user_id, partner_id, created_at)
    VALUES (@user_id, @partner_id, @created_at)
    ON CONFLICT(user_id) DO UPDATE SET
      partner_id = excluded.partner_id,
      created_at = excluded.created_at
  `);

  const tx = db.transaction((a, b) => {
    stmt.run({ user_id: a, partner_id: b, created_at: now });
    stmt.run({ user_id: b, partner_id: a, created_at: now });
  });

  tx(userA, userB);
}

async function clearPair(userId) {
  const partnerId = await getPartner(userId);
  if (!partnerId) return null;
  db.prepare("DELETE FROM pairs WHERE user_id IN (?, ?)").run(
    userId,
    partnerId
  );
  return partnerId;
}

async function removeFromQueue(userId) {
  db.prepare("DELETE FROM queue_free WHERE user_id = ?").run(userId);
}

/**
 * Mengambil satu user dari antrean (bukan diri sendiri) secara atomik.
 */
async function popFromQueueExcept(userId) {
  const tx = db.transaction((uid) => {
    const row = db
      .prepare(
        `
        SELECT id, user_id
        FROM queue_free
        WHERE user_id <> ?
        ORDER BY created_at ASC
        LIMIT 1
      `
      )
      .get(uid);

    if (!row) return null;

    db.prepare("DELETE FROM queue_free WHERE id = ?").run(row.id);
    return Number(row.user_id);
  });

  return tx(userId);
}

async function pushToQueue(userId) {
  db.prepare(
    `
    INSERT OR IGNORE INTO queue_free (user_id)
    VALUES (?)
  `
  ).run(userId);
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