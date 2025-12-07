const mysql = require("mysql2/promise");
require("dotenv").config();

const {
  DB_HOST,
  DB_PORT,
  DB_USER,
  DB_PASSWORD,
  DB_NAME,
} = process.env;

if (!DB_HOST || !DB_USER || !DB_NAME) {
  console.error(
    "DB_HOST, DB_USER, dan DB_NAME harus diset di environment / .env untuk koneksi database."
  );
  process.exit(1);
}

const pool = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT ? Number(DB_PORT) : 3306,
  user: DB_USER,
  password: DB_PASSWORD || "",
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

/**
 * Inisialisasi schema minimal:
 * - pairs: menyimpan pasangan user (1 baris per user, simetris)
 * - queue_free: antrean user yang menunggu pasangan
 */
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pairs (
      user_id BIGINT PRIMARY KEY,
      partner_id BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS queue_free (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function getPartner(userId) {
  const [rows] = await pool.query(
    "SELECT partner_id FROM pairs WHERE user_id = ? LIMIT 1",
    [userId]
  );
  if (!rows.length) return null;
  return Number(rows[0].partner_id);
}

async function setPair(userA, userB) {
  const now = new Date();
  // REPLACE agar overwrite pasangan lama jika ada
  await pool.query(
    `
    REPLACE INTO pairs (user_id, partner_id, created_at)
    VALUES (?, ?, ?), (?, ?, ?)
  `,
    [userA, userB, now, userB, userA, now]
  );
}

async function clearPair(userId) {
  const partnerId = await getPartner(userId);
  if (!partnerId) return null;
  await pool.query("DELETE FROM pairs WHERE user_id IN (?, ?)", [
    userId,
    partnerId,
  ]);
  return partnerId;
}

async function removeFromQueue(userId) {
  await pool.query("DELETE FROM queue_free WHERE user_id = ?", [userId]);
}

/**
 * Mengambil satu user dari antrean (bukan diri sendiri) secara aman.
 */
async function popFromQueueExcept(userId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `
      SELECT id, user_id
      FROM queue_free
      WHERE user_id <> ?
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE
    `,
      [userId]
    );

    if (!rows.length) {
      await conn.commit();
      conn.release();
      return null;
    }

    const row = rows[0];
    await conn.query("DELETE FROM queue_free WHERE id = ?", [row.id]);

    await conn.commit();
    conn.release();
    return Number(row.user_id);
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {}
    conn.release();
    throw err;
  }
}

async function pushToQueue(userId) {
  // INSERT IGNORE untuk menghindari duplikasi user di antrean
  await pool.query(
    `
    INSERT IGNORE INTO queue_free (user_id)
    VALUES (?)
  `,
    [userId]
  );
}

module.exports = {
  pool,
  initDb,
  getPartner,
  setPair,
  clearPair,
  removeFromQueue,
  popFromQueueExcept,
  pushToQueue,
};