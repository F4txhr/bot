const { Bot, InlineKeyboard } = require("grammy");
const Tesseract = require("tesseract.js");
const crypto = require("crypto");
require("dotenv").config();

const {
  supabase,
  initDb,
  getPartner,
  setPair,
  clearPair,
  removeFromQueue,
  popFromQueueExcept,
  pushToQueue,
  isBanned,
  banUser,
  unbanUser,
  addReport,
  getUserLang,
  setUserLang,
  isPremium,
  extendPremium,
  incrementChatCount,
  getUserStats,
  setPaymentEnabled,
  isPaymentEnabled,
  setPaymentSession,
  getPaymentSession,
  logPayment,
  getPaymentHistory,
  savePaymentCode,
  getPendingPaymentCode,
  findUserByPaymentCode,
  markPaymentCodeUsed,
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
  getUserTrust,
  adjustUserTrust,
  getUserProfile,
  setMyGender,
  setTargetGender,
  clearTargetGender,
} = require("./db");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean)
  .map((x) => Number(x))
  .filter((x) => !Number.isNaN(x));
const TRAKTEER_URL = process.env.TRAKTEER_URL || "";
const TRAKTEER_WEBHOOK_SECRET =
  process.env.TRAKTEER_WEBHOOK_SECRET || "";
const E_WALLET_NUMBER = (process.env.E_WALLET_NUMBER || "089647770084").trim();
const E_WALLET_NAME = (process.env.E_WALLET_NAME || "Achmad fatkurrois").trim();
const PAYMENT_LOG_CHAT_ID = Number(process.env.PAYMENT_LOG_CHAT_ID || "0");
const PAYMENT_LOG_TOPIC_ID = Number(process.env.PAYMENT_LOG_TOPIC_ID || "0");
const REPORT_LOG_CHAT_ID = Number(
  process.env.REPORT_LOG_CHAT_ID || PAYMENT_LOG_CHAT_ID || "0"
);
const REPORT_LOG_TOPIC_ID = Number(process.env.REPORT_LOG_TOPIC_ID || "0");
// Port HTTP untuk webhook Trakteer (gunakan port dari panel, mis: 4244)
const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT || "4244");

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN belum diset di environment / .env");
  process.exit(1);
}

const AUTO_BAN_REPORTS = 3;

const bot = new Bot(BOT_TOKEN);

// cooldown sederhana untuk /search
const SEARCH_COOLDOWN_MS = 3000;
const lastSearchAt = new Map();

// rate limit pesan: maksimal MESSAGE_RATE_LIMIT_MAX pesan per window
const MESSAGE_RATE_WINDOW_MS = 8000;
const MESSAGE_RATE_LIMIT_MAX = 10;
const messageRateBuckets = new Map(); // userId -> { count, resetAt }

// daftar ekstensi file berbahaya untuk dokumen
const DANGEROUS_EXTENSIONS = [
  ".exe",
  ".bat",
  ".cmd",
  ".sh",
  ".js",
  ".msi",
  ".scr",
  ".pif",
  ".com",
];

// daftar kata kasar berat untuk sensor teks
const BAD_WORDS = new Set([
  "anjing",
  "anjg",
  "babi",
  "bangsat",
  "kontol",
  "memek",
  "fuck",
  "bitch",
  "dick",
]);

function normalizeTextForBadWords(text) {
  if (!text) return "";
  // hilangkan aksen, ubah ke ASCII sederhana
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  // ganti beberapa leetspeak
  const replacements = {
    "1": "i",
    "3": "e",
    "4": "a",
    "0": "o",
    "5": "s",
    "7": "t",
  };
  let result = normalized;
  for (const [k, v] of Object.entries(replacements)) {
    result = result.replace(new RegExp(k, "g"), v);
  }
  return result;
}

function censorText(text) {
  if (!text) return text;
  const normalized = normalizeTextForBadWords(text);
  const words = text.split(/\s+/);
  const normWords = normalized.split(/\s+/);
  const censored = [];

  for (let i = 0; i < words.length; i++) {
    const raw = words[i];
    const clean = (normWords[i] || "")
      .toLowerCase()
      .replace(/[^a-z]/g, "");
    if (BAD_WORDS.has(clean)) {
      censored.push("*".repeat(raw.length));
    } else {
      censored.push(raw);
    }
  }
  return censored.join(" ");
}

function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

// === Helper OCR & parsing pembayaran manual ===

// Generator kode unik pembayaran, format: PAY-XXXXXXXX
function generatePaymentCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let raw = "";
  for (let i = 0; i < 8; i++) {
    raw += chars[Math.floor(Math.random() * chars.length)];
  }
  return `PAY-${raw}`;
}

function extractAmountCandidates(text) {
  const candidates = new Set();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const upper = line.toUpperCase();
    const matches = upper.match(/RP\s*([0-9][0-9\.\,]*)/g);
    if (!matches) continue;
    for (const m of matches) {
      const numPart = m.replace(/[^0-9]/g, "");
      if (!numPart) continue;
      const val = Number(numPart);
      if (!Number.isNaN(val) && val > 0) {
        candidates.add(val);
      }
    }
  }
  return Array.from(candidates).sort((a, b) => a - b);
}

function findPaymentCodes(ocrText) {
  const upper = ocrText.toUpperCase();
  const matches = upper.match(/PAY-[A-Z0-9]{4,12}/g);
  if (!matches) return [];
  const unique = Array.from(new Set(matches));
  return unique.sort();
}

function parseTransactionDatetime(ocrText) {
  const upper = ocrText.toUpperCase();
  const monthMap = {
    JAN: 1,
    JANUARI: 1,
    FEB: 2,
    FEBRUARI: 2,
    MAR: 3,
    MARET: 3,
    APR: 4,
    APRIL: 4,
    MEI: 5,
    JUN: 6,
    JUNI: 6,
    JUL: 7,
    JULI: 7,
    AGU: 8,
    AGUSTUS: 8,
    SEP: 9,
    SEPT: 9,
    SEPTEMBER: 9,
    OKT: 10,
    OKTOBER: 10,
    NOV: 11,
    NOVEMBER: 11,
    DES: 12,
    DESEMBER: 12,
  };

  const dateRegex =
    /(\\d{1,2})\\s+(JAN|JANUARI|FEB|FEBRUARI|MAR|MARET|APR|APRIL|MEI|JUN|JUNI|JUL|JULI|AGU|AGUSTUS|SEP|SEPT|SEPTEMBER|OKT|OKTOBER|NOV|NOVEMBER|DES|DESEMBER)\\s+(\\d{4})/;
  const dateMatch = upper.match(dateRegex);
  const timeMatch = upper.match(/(\\d{1,2}):(\\d{2})/);

  if (!dateMatch) return null;

  const dayStr = dateMatch[1];
  const monStr = dateMatch[2];
  const yearStr = dateMatch[3];

  try {
    const day = Number(dayStr);
    const year = Number(yearStr);
    const month = monthMap[monStr];
    if (!month) return null;

    let hour = 12;
    let minute = 0;
    if (timeMatch) {
      hour = Number(timeMatch[1]);
      minute = Number(timeMatch[2]);
    }

    return new Date(Date.UTC(year, month - 1, day, hour, minute));
  } catch (e) {
    return null;
  }
}

// Deteksi jenis wallet dari teks OCR (DANA / GOPAY / OVO)
function detectWallet(ocrText) {
  const upper = ocrText.toUpperCase();
  if (upper.includes("DANA")) return "DANA";
  if (
    upper.includes("GOPAY") ||
    upper.includes("GO-PAY") ||
    upper.includes("GOJEK")
  ) {
    return "GOPAY";
  }
  if (upper.includes("OVO")) return "OVO";
  return "UNKNOWN";
}

// Parse penerima GoPay (nama + 4 digit terakhir akun)
function parseGopayRecipient(ocrText) {
  const lines = ocrText.split(/\r?\n/);
  let name = null;
  let last4 = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const upper = line.toUpperCase();

    // Nama penerima: baris "Ditransfer ke ..."
    if (!name && upper.startsWith("DITRANSFER KE")) {
      name = line.replace(/^[Dd]itransfer ke\s*/i, "").trim();
    }

    // GoPay ****1234
    if (!last4) {
      const m = upper.match(/GOPAY\s+\*{2,}\s?(\d{4})/);
      if (m) {
        last4 = m[1];
      }
    }

    if (name && last4) break;
  }

  return { name, last4 };
}

function containsWalletInfo(ocrText) {
  const upper = ocrText.toUpperCase();
  const nameUpper = E_WALLET_NAME.toUpperCase();
  return upper.includes(E_WALLET_NUMBER) && upper.includes(nameUpper);
}

async function ocrPhotoFromTelegram(ctx, photo) {
  try {
    const file = await ctx.api.getFile(photo.file_id);
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    const result = await Tesseract.recognize(buffer, "ind+eng");
    return typeof result.data.text === "string" ? result.data.text : "";
  } catch (err) {
    console.error("OCR error:", err.message);
    return "";
  }
}

function computePremiumDaysFromAmount(amount) {
  if (!amount || amount < 1000) return 0;
  return Math.floor(amount / 1000);
}

async function startSearch(ctx) {
  const userId = ctx.from.id;

  if (await isBanned(userId)) {
    const lang = await getUserLang(userId);
    const msg =
      lang === "en"
        ? "Your account is blocked."
        : "Akunmu diblokir.";
    await ctx.reply(msg);
    return;
  }

  const lang = await getUserLang(userId);

  const partnerIdExisting = await getPartner(userId);
  if (partnerIdExisting) {
    await ctx.reply("Kamu sudah dalam obrolan. Gunakan /stop untuk keluar.");
    return;
  }

  await removeFromQueue(userId);

  // cek preferensi gender jika user premium
  let targetGender = null;
  const premium = await isPremium(userId);
  const profile = await getUserProfile(userId);
  if (!premium && profile.target_gender) {
    // premium sudah habis, reset preferensi
    await clearTargetGender(userId);
  } else if (premium) {
    targetGender = profile.target_gender || null;
  }

  let otherId = null;

  if (premium && targetGender) {
    // coba cari kandidat yang gender-nya cocok
    try {
      // ambil beberapa kandidat dari queue_free
      const { data: queueData, error } = await supabase
        .from("queue_free")
        .select("user_id")
        .neq("user_id", userId)
        .limit(20);

      if (!error && Array.isArray(queueData) && queueData.length > 0) {
        for (const row of queueData) {
          const candidateId = Number(row.user_id);
          if (!candidateId || candidateId === userId) continue;
          const candProfile = await getUserProfile(candidateId);
          if (!candProfile.gender) continue;
          if (
            targetGender === candProfile.gender ||
            targetGender === "other"
          ) {
            // hapus kandidat ini dari queue dan gunakan sebagai partner
            await removeFromQueue(candidateId);
            otherId = candidateId;
            break;
          }
        }
      }
    } catch (e) {
      console.error("Gagal mencari partner berdasar gender:", e.message);
    }
  }

  // fallback ke matching biasa jika tidak ditemukan
  if (!otherId) {
    otherId = await popFromQueueExcept(userId);
  }

  if (otherId && otherId !== userId) {
    await setPair(userId, otherId);

    await ctx.reply(
      lang === "en"
        ? "Partner found. Mulai ngobrol sekarang."
        : "Ditemukan pasangan. Mulai ngobrol sekarang."
    );
    await bot.api.sendMessage(
      otherId,
      lang === "en"
        ? "Partner found. Mulai ngobrol sekarang."
        : "Ditemukan pasangan. Mulai ngobrol sekarang."
    );
  } else {
    await pushToQueue(userId);
    const msg =
      lang === "en"
        ? "You are in the queue, waiting for a partner..."
        : "Kamu masuk antrian, menunggu pasangan...";
    await ctx.reply(msg);
  }
}

async function stopChat(ctx) {
  const userId = ctx.from.id;

  await removeFromQueue(userId);

  const partnerId = await clearPair(userId);
  if (!partnerId) {
    await ctx.reply("ℹ️ Kamu tidak sedang dalam obrolan.");
    return;
  }

  await ctx.reply("⛔ Kamu telah keluar dari obrolan.");
  try {
    await bot.api.sendMessage(
      partnerId,
      "⛔ Pasanganmu keluar dari obrolan."
    );
  } catch (err) {
    console.error("Gagal kirim pesan ke partner:", err.message);
  }
}

async function handleReport(ctx) {
  const userId = ctx.from.id;
  const lang = await getUserLang(userId);

  const replied = ctx.message.reply_to_message;
  if (!replied) {
    const msg =
      lang === "en"
        ? "ℹ️ To report a message, reply to that message with /report.\nThis will send the content to admin for review."
        : "ℹ️ Untuk melaporkan pesan, balas pesan yang ingin kamu laporkan dengan /report.\nIsi pesan akan dikirim ke admin untuk ditinjau.";
    await ctx.reply(msg);
    return;
  }

  const partnerId = await getPartner(userId);

  // Analisis jenis pesan yang direport
  const m = replied;
  let messageType = "unknown";
  let text = "";
  let ocrText = "";
  let ocrHash = "";
  let mediaFileId = "";
  let mediaUniqueId = "";
  let textHash = "";

  if (m.text) {
    messageType = "text";
    text = m.text;
    if (text.trim().length > 0) {
      textHash = crypto
        .createHash("sha256")
        .update(text.trim().toLowerCase())
        .digest("hex");
    }
  } else if (m.photo && m.photo.length > 0) {
    messageType = "photo";
    const photo = m.photo[m.photo.length - 1];
    mediaFileId = photo.file_id;
    mediaUniqueId = photo.file_unique_id;
    ocrText = await ocrPhotoFromTelegram(ctx, photo);
  } else if (m.sticker) {
    messageType = "sticker";
    mediaFileId = m.sticker.file_id;
    mediaUniqueId = m.sticker.file_unique_id;
    if (m.sticker.thumb) {
      ocrText = await ocrPhotoFromTelegram(ctx, m.sticker.thumb);
    }
  } else if (m.video) {
    messageType = "video";
    mediaFileId = m.video.file_id;
    mediaUniqueId = m.video.file_unique_id;
    if (m.video.thumb) {
      ocrText = await ocrPhotoFromTelegram(ctx, m.video.thumb);
    }
  } else if (m.document) {
    messageType = "document";
    mediaFileId = m.document.file_id;
    mediaUniqueId = m.document.file_unique_id;
    if (m.document.thumb) {
      ocrText = await ocrPhotoFromTelegram(ctx, m.document.thumb);
    }
  } else if (m.voice) {
    messageType = "voice";
    mediaFileId = m.voice.file_id;
    mediaUniqueId = m.voice.file_unique_id;
  }

  if (ocrText && ocrText.trim().length > 0) {
    ocrHash = crypto
      .createHash("sha256")
      .update(ocrText.trim().toLowerCase())
      .digest("hex");
  }

  const reportId = await logReportedMessage({
    reporterId: userId,
    partnerId,
    messageType,
    text,
    textHash,
    ocrText,
    ocrHash,
    mediaFileId,
    mediaUniqueId,
  });

  let similarCount = 0;
  if (ocrHash) {
    similarCount = await countSimilarReports(ocrHash);
    if (similarCount > 0) {
      // current report sudah termasuk, kurangi 1 untuk "other" reports
      similarCount = Math.max(similarCount - 1, 0);
  }
  }

  const msgUser =
    lang === "en"
      ? "✅ Your report has been sent to the admin. They will review the content and take action if needed."
      : "✅ Laporanmu sudah dikirim ke admin. Admin akan meninjau isi pesan dan mengambil tindakan jika perlu.";

  await ctx.reply(msgUser);

  // Susun teks untuk admin (ID & EN) tanpa Markdown rumit, supaya aman
  const baseLinesEn = [
    "🛑 Message Report",
    "",
    `Reporter: ${userId}`,
    `Reported user: ${partnerId || "-"}`,
    `Type: ${messageType}`,
    similarCount > 0
      ? `Similar reports with same OCR hash (excluding this): ${similarCount}`
      : "",
    partnerId
      ? "Note: banning this media will also increment the user's valid report count (auto-ban at 15)."
      : "",
    "",
  ].filter(Boolean);

  const baseLinesId = [
    "🛑 Laporan Pesan",
    "",
    `Pelapor: ${userId}`,
    `Terlapor: ${partnerId || "-"}`,
    `Tipe: ${messageType}`,
    similarCount > 0
      ? `Jumlah laporan lain dengan OCR hash sama (di luar ini): ${similarCount}`
      : "",
    partnerId
      ? "Catatan: ban media akan menambah jumlah laporan valid user (auto-ban di 15 laporan)."
      : "",
    "",
  ].filter(Boolean);

  if (text) {
    baseLinesEn.push("Text:", text.slice(0, 1900));
    baseLinesId.push("Teks:", text.slice(0, 1900));
  }

  if (ocrText) {
    baseLinesEn.push("", "OCR text (if any):", ocrText.slice(0, 1900));
    baseLinesId.push("", "Teks OCR (jika ada):", ocrText.slice(0, 1900));
  }

  const textAdminEn = baseLinesEn.join("\n");
  const textAdminId = baseLinesId.join("\n");

  // Gunakan reportId saja di callback untuk menghindari data callback terlalu panjang
  const actionKeyboard =
    reportId != null
      ? new InlineKeyboard().text("🚫 Ban media", `admin_banmedia:${reportId}`)
      : undefined;

  // Kirim ke grup admin (REPORT_LOG_CHAT_ID)
  if (REPORT_LOG_CHAT_ID) {
    try {
      const sent = await bot.api.sendMessage(
        REPORT_LOG_CHAT_ID,
        lang === "en" ? textAdminEn : textAdminId,
        {
          reply_markup: actionKeyboard,
          message_thread_id:
            REPORT_LOG_TOPIC_ID && REPORT_LOG_TOPIC_ID > 0
              ? REPORT_LOG_TOPIC_ID
              : undefined,
        }
      );

      // forward/copy pesan asli ke grup admin supaya bisa dilihat
      try {
        await bot.api.copyMessage(
          REPORT_LOG_CHAT_ID,
          ctx.chat.id,
          replied.message_id,
          {
            reply_to_message_id: sent.message_id,
            message_thread_id:
              REPORT_LOG_TOPIC_ID && REPORT_LOG_TOPIC_ID > 0
                ? REPORT_LOG_TOPIC_ID
                : undefined,
          }
        );
      } catch (e) {
        console.error("Gagal copy pesan report ke grup admin:", e.message);
      }
    } catch (err) {
      console.error("Gagal kirim log report:", err.message);
    }
  }

  // DM ke setiap admin
  for (const adminId of ADMIN_IDS) {
    try {
      const aLang = await getUserLang(adminId);
      const t = aLang === "en" ? textAdminEn : textAdminId;
      await bot.api.sendMessage(adminId, t);
    } catch (e) {
      // abaikan error kirim ke admin tertentu
    }
  }
}

async function handleLang(ctx) {
  const userId = ctx.from.id;
  const args = ctx.match ? ctx.match.trim().split(/\s+/) : [];

  const currentLang = await getUserLang(userId);

  if (args.length > 0) {
    const arg = args[0].toLowerCase();
    if (["id", "indo", "indonesia"].includes(arg)) {
      await setUserLang(userId, "id");
      await ctx.reply("✅ Bahasa telah diubah ke Bahasa Indonesia.");
      return;
    }
    if (["en", "eng", "english"].includes(arg)) {
      await setUserLang(userId, "en");
      await ctx.reply("✅ Language has been set to English.");
      return;
    }

    const msg =
      currentLang === "en"
        ? "Usage: /lang id | en"
        : "Cara pakai: /lang id | en";
    await ctx.reply(msg);
    return;
  }

  const text =
    currentLang === "en"
      ? "Choose language:"
      : "Pilih bahasa:";
  const kb = new InlineKeyboard()
    .text("Bahasa Indonesia", "lang:id")
    .text("English", "lang:en");

  await ctx.reply(text, { reply_markup: kb });
}

async function handleShowId(ctx) {
  const userId = ctx.from.id;
  const partnerId = await getPartner(userId);
  const lang = await getUserLang(userId);

  if (!partnerId) {
    const msg =
      lang === "en"
        ? "ℹ️ You are not in a chat right now. Use /search first."
        : "ℹ️ Kamu tidak sedang dalam obrolan. Gunakan /search terlebih dahulu.";
    await ctx.reply(msg);
    return;
  }

  const text =
    lang === "en"
      ? `🔗 Your profile link has been sent to your partner.`
      : `🔗 Link profilmu telah dikirim ke pasanganmu.`;
  await ctx.reply(text);

  const partnerText =
    lang === "en"
      ? `🔗 Your chat partner has shared their profile:\nhttps://t.me/${ctx.from.username || `+user?id=${userId}`}`
      : `🔗 Pasanganmu membagikan profilnya:\nhttps://t.me/${ctx.from.username || `+user?id=${userId}`}`;

  try {
    await bot.api.sendMessage(partnerId, partnerText);
  } catch (err) {
    console.error("Gagal kirim showid ke partner:", err.message);
  }
}

async function handlePremium(ctx) {
  const userId = ctx.from.id;
  const lang = await getUserLang(userId);
  const premium = await isPremium(userId);

  const manualEnabled = await isPaymentEnabled("manual");
  const trakteerEnabled = await isPaymentEnabled("trakteer");

  const methods = [];
  if (manualEnabled) methods.push("manual");
  if (trakteerEnabled) methods.push("trakteer");

  if (methods.length === 0) {
    const lines =
      lang === "en"
        ? [
            "💎 *Premium*",
            "",
            premium
              ? "• Status: You are currently a premium user."
              : "• Status: You are currently not premium.",
            "• Payment methods are currently unavailable.",
          ]
        : [
            "💎 *Premium*",
            "",
            premium
              ? "• Status: Kamu saat ini adalah pengguna premium."
              : "• Status: Kamu saat ini belum premium.",
            "• Saat ini tidak ada metode pembayaran yang tersedia.",
          ];
    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
    return;
  }

  // Cek apakah user sudah punya kode unik yang belum dipakai (misal transaksi sebelumnya belum selesai)
  let code = await getPendingPaymentCode(userId, "trakteer");
  const reusedExisting = !!code;

  if (!code) {
    code = generatePaymentCode();
    // Simpan mapping kode -> user untuk manual & trakteer (dipakai webhook nanti)
    try {
      await savePaymentCode(code, userId, "any");
    } catch (err) {
      console.error("Gagal savePaymentCode:", err.message);
    }
  }

  let text;
  if (lang === "en") {
    const reminder = reusedExisting
      ? [
          "⚠️ It looks like you have a previous transaction that has not been completed yet.",
          "Please use the same unique code below to finish your payment:",
          "",
          `\`${code}\``,
          "",
        ]
      : [
          "Use the *unique code* below in your payment note/message:",
          "",
          `\`${code}\``,
          "",
        ];

    text = [
      "💎 *Premium*",
      "",
      premium
        ? "• Status: You are currently a premium user."
        : "• Status: You are currently not premium.",
      "",
      "• Each Rp 1.000 = 1 day of premium.",
      "  Example:",
      "  - Rp 3.000 → 3 days",
      "  - Rp 10.000 → 10 days",
      "",
      ...reminder,
      "Then choose one of the payment methods below:",
    ].join("\n");
  } else {
    const reminder = reusedExisting
      ? [
          "⚠️ Sepertinya kamu masih punya transaksi sebelumnya yang belum diselesaikan.",
          "Silakan gunakan *kode unik* yang sama di bawah ini untuk menyelesaikan pembayaran:",
          "",
          `\`${code}\``,
          "",
        ]
      : [
          "Gunakan *kode unik* di bawah ini pada catatan/pesan pembayaran:",
          "",
          `\`${code}\``,
          "",
        ];

    text = [
      "💎 *Premium*",
      "",
      premium
        ? "• Status: Kamu saat ini adalah pengguna premium."
        : "• Status: Kamu saat ini belum premium.",
      "",
      "• Setiap Rp 1.000 = 1 hari premium.",
      "  Contoh:",
      "  - Rp 3.000 → 3 hari",
      "  - Rp 10.000 → 10 hari",
      "",
      ...reminder,
      "Lalu pilih salah satu metode pembayaran di bawah:",
    ].join("\n");
  }

  const keyboard = new InlineKeyboard();
  if (manualEnabled) {
    keyboard.text(
      lang === "en" ? "📱 Manual transfer" : "📱 Transfer manual",
      `pay_manual:${code}`
    );
  }
  if (trakteerEnabled) {
    if (manualEnabled) keyboard.row();
    keyboard.text(
      lang === "en" ? "💳 Trakteer" : "💳 Trakteer",
      `pay_trakteer:${code}`
    );
  }

  await ctx.reply(text, {
    reply_markup: keyboard,
  });
}

async function main() {
  await initDb();
  console.log("✅ Koneksi database siap digunakan");

  bot.command("start", async (ctx) => {
    const name = ctx.from.first_name || "kamu";
    const lang = await getUserLang(ctx.from.id);

    const textId = [
      `👋 Hai, ${name}!`,
      "",
      "*ShadowChat*",
      "────────────",
      "",
      "Perintah utama:",
      "• /search — cari pasangan ngobrol anonim",
      "• /stop — hentikan obrolan yang sedang berjalan",
      "• /next — ganti ke pasangan berikutnya",
      "• /report — laporkan pasangan yang melanggar",
      "• /lang — ganti bahasa (id/en)",
      "• /showid — kirim link profilmu ke pasangan",
      "• /premium — cek status premium & cara bayar",
      "• /stats — lihat statistik chat",
      "• /payhistory — riwayat pembayaranmu",
      "• /discount — cek / klaim kode diskon",
      "",
      "Kirim /search untuk mulai, atau /help untuk bantuan lengkap.",
    ].join("\n");

    const textEn = [
      `👋 Hey, ${name}!`,
      "",
      "*ShadowChat*",
      "────────────",
      "",
      "Main commands:",
      "• /search — find a random chat partner",
      "• /stop — end current chat",
      "• /next — find the next partner",
      "• /report — report your current partner",
      "• /lang — change language (id/en)",
      "• /showid — share your profile link with partner",
      "• /premium — check premium status & payment options",
      "• /stats — view your chat stats",
      "• /payhistory — your payment history",
      "• /discount — check / claim discount code",
      "",
      "Type /search to start, or /help for full help.",
    ].join("\n");

    await ctx.reply(lang === "en" ? textEn : textId, {
      parse_mode: "Markdown",
    });
  });

  bot.command("help", async (ctx) => {
    const userId = ctx.from.id;
    const lang = await getUserLang(userId);
    const admin = isAdmin(userId);

    if (lang === "en") {
      const lines = [
        "❓ *ShadowChat Help*",
        "",
        "*User commands:*",
        "/start - show welcome message",
        "/help - show this help",
        "/search - find a random chat partner",
        "/stop - end the current chat",
        "/next - end current chat and search for another partner",
        "/report - report your current partner",
        "/lang - change language (id/en)",
        "/showid - share your profile link with partner",
        "/premium - check premium status & payment methods",
        "/stats - view your chat statistics",
        "/payhistory - view your payment history",
        "/discount - check or claim a discount code",
        "/pending - show pending Trakteer transaction (if any)",
        "",
      ];

      if (admin) {
        lines.push(
          "*Admin commands:*",
          "/payment on|off [manual|trakteer] - enable/disable payment methods",
          "/grantpremium <user_id> <days> - manually extend premium",
          "/discount_add CODE PERCENT [MAX_USES] [HOURS] [MIN_AMOUNT] - create discount code",
          "/discount_disable CODE [on|off] - enable/disable discount code",
          "/payhistory <user_id> [limit] - view another user's payment history",
          "/user <user_id> - show user status",
          "/ban <user_id> [reason] - ban user",
          "/unban <user_id> - unban user",
          "/adminstats - show global statistics",
          "/list_banned - list banned users",
          "/broadcast <message> - send broadcast to active users",
          "/giftpremium <count> <days> - randomly gift premium to active free users",
          "/discountstats - show discount codes summary",
          "/discountusers <code> - list users who used a discount code"
        );
      }

      await ctx.reply(lines.join("\n"));
    } else {
      const lines = [
        "❓ *Bantuan ShadowChat*",
        "",
        "*Perintah untuk user:*",
        "/start - tampilkan pesan sambutan",
        "/help - tampilkan bantuan ini",
        "/search - cari pasangan ngobrol anonim",
        "/stop - hentikan obrolan yang sedang berjalan",
        "/next - hentikan obrolan dan cari pasangan baru",
        "/report - laporkan pasangan yang melanggar",
        "/lang - ganti bahasa (id/en)",
        "/showid - kirim link profilmu ke pasangan",
        "/premium - cek status premium & metode pembayaran",
        "/stats - lihat statistik chat kamu",
        "/payhistory - lihat riwayat pembayaranmu",
        "/discount - cek atau klaim kode diskon",
        "/pending - lihat transaksi Trakteer yang masih tertunda (jika ada)",
        "",
      ];

      if (admin) {
        lines.push(
          "*Perintah admin:*",
          "/payment on|off [manual|trakteer] - hidup/matikan metode pembayaran",
          "/grantpremium <user_id> <hari> - tambah masa premium user secara manual",
          "/discount_add KODE PERSEN [MAX_USES] [JAM] [MIN_NOMINAL] - buat kode diskon",
          "/discount_disable KODE [on|off] - aktif/nonaktifkan kode diskon",
          "/payhistory <user_id> [limit] - lihat riwayat pembayaran user lain",
          "/user <user_id> - lihat status user",
          "/ban <user_id> [alasan] - blokir user",
          "/unban <user_id> - buka blokir user",
          "/adminstats - statistik global",
          "/list_banned - daftar user yang diblokir",
          "/broadcast <pesan> - kirim pengumuman ke user aktif",
          "/giftpremium <jumlah> <hari> - bagi-bagi premium ke user gratis yang aktif",
          "/discountstats - ringkasan kode diskon",
          "/discountusers <kode> - daftar user yang memakai kode diskon"
        );
      }

      await ctx.reply(lines.join("\n"));
    }
  });

  bot.command("search", async (ctx) => {
    const userId = ctx.from.id;
    const now = Date.now();
    const last = lastSearchAt.get(userId) || 0;
    if (now - last < SEARCH_COOLDOWN_MS) {
      const lang = await getUserLang(userId);
      const msg =
        lang === "en"
          ? "⏳ Please wait a moment before using /search again."
          : "⏳ Tunggu sebentar sebelum menggunakan /search lagi.";
      await ctx.reply(msg);
      return;
    }
    lastSearchAt.set(userId, now);

    await startSearch(ctx);
    // Setiap kali mulai chat baru (saat nanti dipasangkan), kita akan
    // increment di dalam setPair. Di versi sederhana ini, kita bisa
    // increment saat user memulai pencarian.
    await incrementChatCount(userId);
  });

  bot.command("stop", async (ctx) => {
    await stopChat(ctx);
  });

  bot.command("next", async (ctx) => {
    await stopChat(ctx);
    await startSearch(ctx);
  });

  bot.command("report", async (ctx) => {
    await handleReport(ctx);
  });

  // Admin: ban / unban user
  bot.command("ban", async (ctx) => {
    const adminId = ctx.from.id;
    if (!isAdmin(adminId)) return;
    const lang = await getUserLang(adminId);
    const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean);
    if (args.length < 1) {
      const msg =
        lang === "en"
          ? "Usage: /ban <user_id> [reason]"
          : "Cara pakai: /ban <user_id> [alasan]";
      await ctx.reply(msg);
      return;
    }
    const targetId = Number(args[0]);
    if (!targetId || Number.isNaN(targetId)) {
      const msg =
        lang === "en"
          ? "User ID must be a valid number."
          : "User ID harus berupa angka yang valid.";
      await ctx.reply(msg);
      return;
    }
    const reason = args.slice(1).join(" ") || "Banned by admin";
    await banUser(targetId, reason);
    await clearPair(targetId);
    const msgAdmin =
      lang === "en"
        ? `✅ User ${targetId} has been banned.\nReason: ${reason}`
        : `✅ User ${targetId} telah diblokir.\nAlasan: ${reason}`;
    await ctx.reply(msgAdmin);
    try {
      const userLang = await getUserLang(targetId);
      const msgUser =
        userLang === "en"
          ? "❌ Your account has been blocked by admin."
          : "❌ Akunmu telah diblokir oleh admin.";
      await bot.api.sendMessage(targetId, msgUser);
    } catch (_) {}
  });

  bot.command("unban", async (ctx) => {
    const adminId = ctx.from.id;
    if (!isAdmin(adminId)) return;
    const lang = await getUserLang(adminId);
    const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean);
    if (args.length < 1) {
      const msg =
        lang === "en"
          ? "Usage: /unban <user_id>"
          : "Cara pakai: /unban <user_id>";
      await ctx.reply(msg);
      return;
    }
    const targetId = Number(args[0]);
    if (!targetId || Number.isNaN(targetId)) {
      const msg =
        lang === "en"
          ? "User ID must be a valid number."
          : "User ID harus berupa angka yang valid.";
      await ctx.reply(msg);
      return;
    }
    await unbanUser(targetId);
    const msgAdmin =
      lang === "en"
        ? `✅ User ${targetId} has been unbanned.`
        : `✅ User ${targetId} telah dibuka blokirnya.`;
    await ctx.reply(msgAdmin);
    try {
      const userLang = await getUserLang(targetId);
      const msgUser =
        userLang === "en"
          ? "✅ Your account has been unblocked by admin."
          : "✅ Akunmu telah dibuka blokirnya oleh admin.";
      await bot.api.sendMessage(targetId, msgUser);
    } catch (_) {}
  });

  bot.command("lang", async (ctx) => {
    await handleLang(ctx);
  });

  bot.command("showid", async (ctx) => {
    await handleShowId(ctx);
  });

  bot.command("premium", async (ctx) => {
    await handlePremium(ctx);
  });

  // Set gender profil user (mygender)
  bot.command("mygender", async (ctx) => {
    const userId = ctx.from.id;
    const lang = await getUserLang(userId);
    const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean);

    if (args.length > 0) {
      // tetap dukung argumen teks
      const g = args[0].toLowerCase();
      if (!["male", "female", "other"].includes(g)) {
        const msg =
          lang === "en"
            ? "Gender must be one of: male, female, other."
            : "Gender harus salah satu dari: male, female, other.";
        await ctx.reply(msg);
        return;
      }

      await setMyGender(userId, g);

      const msg =
        lang === "en"
          ? `✅ Your gender has been set to *${g}*.`
          : `✅ Gender kamu diset ke *${g}*.`;
      await ctx.reply(msg, { parse_mode: "Markdown" });
      return;
    }

    const text =
      lang === "en"
        ? "Choose your gender:"
        : "Pilih gender kamu:";
    const kb = new InlineKeyboard()
      .text("♂ male", "mg:male")
      .text("♀ female", "mg:female")
      .row()
      .text("⚪ other", "mg:other");

    await ctx.reply(text, { reply_markup: kb });
  });

  // Set preferensi gender pasangan (target) - khusus premium
  bot.command("setgender", async (ctx) => {
    const userId = ctx.from.id;
    const lang = await getUserLang(userId);
    const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean);

    const isPrem = await isPremium(userId);
    if (!isPrem) {
      const msg =
        lang === "en"
          ? "🔒 Only premium users can set partner gender preference. Use /premium to see how to upgrade."
          : "🔒 Hanya pengguna premium yang bisa mengatur preferensi gender pasangan. Gunakan /premium untuk info upgrade.";
      await ctx.reply(msg);
      // reset jika ada preferensi lama
      await clearTargetGender(userId);
      return;
    }

    if (args.length > 0) {
      let target = args[0].toLowerCase();
      if (target === "any" || target === "all") target = "any";
      if (!["male", "female", "other", "any"].includes(target)) {
        const msg =
          lang === "en"
            ? "Target gender must be one of: male, female, other, any."
            : "Gender target harus salah satu dari: male, female, other, any.";
        await ctx.reply(msg);
        return;
      }

      if (target === "any") {
        await clearTargetGender(userId);
        const msg =
          lang === "en"
            ? "✅ Your partner preference has been reset to *random (any)*."
            : "✅ Preferensi pasanganmu direset ke *acak (any)*.";
        await ctx.reply(msg, { parse_mode: "Markdown" });
        return;
      }

      await setTargetGender(userId, target);

      const msg =
        lang === "en"
          ? `✅ Your partner preference has been set to *${target}*.\nIt will stay active while you are premium.`
          : `✅ Preferensi pasanganmu diset ke *${target}*.\nPreferensi ini akan aktif selama kamu masih premium.`;
      await ctx.reply(msg, { parse_mode: "Markdown" });
      return;
    }

    const text =
      lang === "en"
        ? "Choose the gender of the partner you want to find (premium only):"
        : "Pilih gender pasangan yang ingin kamu cari (khusus premium):";
    const kb = new InlineKeyboard()
      .text("♂ male", "tg:male")
      .text("♀ female", "tg:female")
      .row()
      .text("⚪ other", "tg:other")
      .text("🎲 any", "tg:any");

    await ctx.reply(text, { reply_markup: kb });
  });

  // Klaim & cek diskon
  bot.command("discount", async (ctx) => {
    const userId = ctx.from.id;
    const lang = await getUserLang(userId);
    const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean);

    if (args.length === 0) {
      const code = await getUserDiscount(userId);
      if (!code) {
        const text =
          lang === "en"
            ? "You don't have any active discount code.\nAsk admin or use /discount CODE to claim one."
            : "Kamu tidak punya kode diskon aktif.\nTanya admin atau gunakan /discount KODE untuk klaim.";
        await ctx.reply(text);
        return;
      }
      const info = await getDiscountInfo(code);
      if (!info) {
        await clearUserDiscount(userId);
        const text =
          lang === "en"
            ? "Your discount code is no longer valid."
            : "Kode diskonmu sudah tidak berlaku.";
        await ctx.reply(text);
        return;
      }

      const minLine =
        info.min_amount && info.min_amount > 0
          ? lang === "en"
            ? `• Minimum amount: Rp ${info.min_amount.toLocaleString("id-ID")}`
            : `• Minimal nominal: Rp ${info.min_amount.toLocaleString("id-ID")}`
          : "";

      let expLine;
      if (info.expire_at) {
        const exp = new Date(info.expire_at);
        const now = new Date();
        const diffMs = exp.getTime() - now.getTime();
        const diffDays =
          diffMs > 0 ? Math.ceil(diffMs / (24 * 3600 * 1000)) : 0;
        const base =
          lang === "en"
            ? `• Expires at: ${exp.toLocaleString("en-US")}`
            : `• Berlaku sampai: ${exp.toLocaleString("id-ID")}`;
        const remain =
          diffDays > 0
            ? lang === "en"
              ? ` (about ${diffDays} day(s) left)`
              : ` (sekitar ${diffDays} hari lagi)`
            : "";
        expLine = base + remain;
      } else {
        expLine =
          lang === "en"
            ? "• Expires at: (no expiry set)"
            : "• Berlaku sampai: (tanpa batas waktu)";
      }

      const text =
        lang === "en"
          ? [
              "Your active discount code:",
              "",
              `• Code: \`${info.code}\``,
              `• Percent: ${info.percent}%`,
              minLine,
              expLine,
            ]
              .filter(Boolean)
              .join("\n")
          : [
              "Kode diskon aktif kamu:",
              "",
              `• Kode: \`${info.code}\``,
              `• Diskon: ${info.percent}%`,
              minLine,
              expLine,
            ]
              .filter(Boolean)
              .join("\n");

      await ctx.reply(text, { parse_mode: "Markdown" });
      return;
    }

    const rawCode = args[0];
    const info = await assignDiscountToUser(userId, rawCode);
    if (!info) {
      const text =
        lang === "en"
          ? "Discount code is invalid, expired, or quota has been used."
          : "Kode diskon tidak valid, kadaluarsa, atau kuotanya sudah habis.";
      await ctx.reply(text);
      return;
    }

    const minLine =
      info.min_amount && info.min_amount > 0
        ? lang === "en"
          ? `• Minimum amount: Rp ${info.min_amount.toLocaleString("id-ID")}`
          : `• Minimal nominal: Rp ${info.min_amount.toLocaleString("id-ID")}`
        : "";

    const expLine = info.expire_at
      ? lang === "en"
        ? `• Expires at: ${new Date(info.expire_at).toLocaleString("en-US")}`
        : `• Berlaku sampai: ${new Date(info.expire_at).toLocaleString(
            "id-ID"
          )}`
      : lang === "en"
      ? "• Expires at: (no expiry set)"
      : "• Berlaku sampai: (tanpa batas waktu)";

    const text =
      lang === "en"
        ? [
            "Discount code applied successfully.",
            "",
            `• Code: \`${info.code}\``,
            `• Percent: ${info.percent}%`,
            minLine,
            expLine,
          ]
            .filter(Boolean)
            .join("\n")
        : [
            "Kode diskon berhasil dipasang.",
            "",
            `• Kode: \`${info.code}\``,
            `• Diskon: ${info.percent}%`,
            minLine,
            expLine,
          ]
            .filter(Boolean)
            .join("\n");

    await ctx.reply(text, { parse_mode: "Markdown" });
  });

  // Admin: discount stats summary
  bot.command("discountstats", async (ctx) => {
    const adminId = ctx.from.id;
    if (!isAdmin(adminId)) return;
    const lang = await getUserLang(adminId);

    try {
      const { data, error } = await supabase
        .from("discount_codes")
        .select(
          "code,percent,max_uses,used,min_amount,expire_at,disabled"
        );
      if (error) throw error;

      if (!data || data.length === 0) {
        const msg =
          lang === "en"
            ? "No discount codes found."
            : "Tidak ada kode diskon.";
        await ctx.reply(msg);
        return;
      }

      const lines = [];
      for (const row of data) {
        const maxUses = Number(row.max_uses || 0);
        const used = Number(row.used || 0);
        const minAmt = Number(row.min_amount || 0);
        const disabled = row.disabled ? true : false;
        let expPart = "";
        if (row.expire_at) {
          const exp = new Date(row.expire_at);
          expPart =
            lang === "en"
              ? `expires: ${exp.toLocaleString("en-US")}`
              : `berlaku sampai: ${exp.toLocaleString("id-ID")}`;
        } else {
          expPart =
            lang === "en"
              ? "expires: (no expiry)"
              : "berlaku sampai: (tanpa batas)";
        }

        if (lang === "en") {
          lines.push(
            "",
            `Code: ${row.code}`,
            `- Percent: ${row.percent}%`,
            `- Uses: ${used}/${maxUses > 0 ? maxUses : "unlimited"}`,
            `- Min amount: Rp ${minAmt.toLocaleString("id-ID")}`,
            `- Status: ${disabled ? "disabled" : "active"}`,
            `- ${expPart}`
          );
        } else {
          lines.push(
            "",
            `Kode: ${row.code}`,
            `- Diskon: ${row.percent}%`,
            `- Pemakaian: ${used}/${maxUses > 0 ? maxUses : "tanpa batas"}`,
            `- Minimal nominal: Rp ${minAmt.toLocaleString("id-ID")}`,
            `- Status: ${disabled ? "dinonaktifkan" : "aktif"}`,
            `- ${expPart}`
          );
        }
      }

      await ctx.reply(lines.join("\n").trim());
    } catch (err) {
      const msg =
        lang === "en"
          ? "Cannot load discount stats right now."
          : "Statistik diskon tidak dapat dimuat saat ini.";
      await ctx.reply(msg);
    }
  });

  // Admin: list users who used a discount code
  bot.command("discountusers", async (ctx) => {
    const adminId = ctx.from.id;
    if (!isAdmin(adminId)) return;
    const lang = await getUserLang(adminId);
    const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean);

    if (args.length < 1) {
      const msg =
        lang === "en"
          ? "Usage: /discountusers <code>"
          : "Cara pakai: /discountusers <kode>";
      await ctx.reply(msg);
      return;
    }

    const rawCode = args[0];
    const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, "");

    try {
      const { data, error } = await supabase
        .from("user_discounts")
        .select("user_id,code")
        .eq("code", code);
      if (error) throw error;

      if (!data || data.length === 0) {
        const msg =
          lang === "en"
            ? `No users found for code ${code}.`
            : `Tidak ada user yang memakai kode ${code}.`;
        await ctx.reply(msg);
        return;
      }

      const lines = [];
      if (lang === "en") {
        lines.push(`Users who used discount code ${code}:`);
      } else {
        lines.push(`Pengguna yang memakai kode diskon ${code}:`);
      }

      for (const row of data) {
        lines.push(`- ${row.user_id}`);
      }

      await ctx.reply(lines.join("\n"));
    } catch (err) {
      const msg =
        lang === "en"
          ? "Cannot load discount users right now."
          : "Daftar pengguna kode diskon tidak dapat dimuat saat ini.";
      await ctx.reply(msg);
    }
  });

  // Inline: show banned details per category (with simple paging)
  bot.callbackQuery(
    /^banlist:(user|text|photo|sticker|video)(?::(\d+))?$/,
    async (ctx) => {
      const adminId = ctx.from.id;
      if (!isAdmin(adminId)) {
        await ctx.answerCallbackQuery({
          text: "Khusus admin.",
          show_alert: true,
        });
        return;
      }
      const lang = await getUserLang(adminId);
      const kind = ctx.match[1];
      const page = ctx.match[2] ? Number(ctx.match[2]) || 1 : 1;
      const PAGE_SIZE = 10;

      try {
        if (kind === "user") {
          const { data, error } = await supabase
            .from("banned_users")
            .select("user_id,reason,created_at")
            .order("created_at", { ascending: false })
            .limit(50);
          if (error) throw error;

          if (!data || data.length === 0) {
            const msg =
              lang === "en"
                ? "There are no banned users."
                : "Tidak ada pengguna yang diblokir.";
            await ctx.answerCallbackQuery({ text: msg, show_alert: false });
            return;
          }

          const lines = [];
          if (lang === "en") {
            lines.push("Banned users (latest up to 50):");
          } else {
            lines.push("User diblokir (maksimal 50 terbaru):");
          }
          for (const row of data) {
            const reason = row.reason || "";
            lines.push(
              `- ${row.user_id}${reason ? ` (${reason})` : ""}`
            );
          }
          await ctx.answerCallbackQuery({
            text: "Daftar user diblokir.",
            show_alert: false,
          });
          await ctx.reply(lines.join("\n"));
          return;
        }

        // media categories with paging
        const offset = (page - 1) * PAGE_SIZE;
        const baseQuery = supabase
          .from("banned_media")
          .select("id,report_id,media_type,created_at", {
            count: "exact",
          })
          .eq("media_type", kind === "photo" ? "photo" : kind)
          .order("created_at", { ascending: false });

        const { data, count, error } = await baseQuery
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw error;

        if (!data || data.length === 0) {
          const msg =
            lang === "en"
              ? "No banned content in this category."
              : "Belum ada konten yang diblokir di kategori ini.";
          await ctx.answerCallbackQuery({ text: msg, show_alert: false });
          return;
        }

        const total = typeof count === "number" ? count : data.length;
        const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

        const ids = data.map((row) => row.report_id).filter(Boolean);
        let reports = [];
        if (ids.length > 0) {
          const { data: repData, error: repErr } = await supabase
          .from("reported_messages")
          .select("id,message_type,text,ocr_text,media_file_id,created_at")
          .in("id", ids);
        if (!repErr && Array.isArray(repData)) {
          reports = repData;
        }
      }

      const titleByKind =
        kind === "text"
          ? lang === "en"
            ? "Banned text:"
            : "Teks yang diblokir:"
          : kind === "photo"
          ? lang === "en"
            ? "Banned images:"
            : "Gambar yang diblokir:"
          : kind === "sticker"
          ? lang === "en"
            ? "Banned stickers:"
            : "Stiker yang diblokir:"
          : lang === "en"
          ? "Banned videos:"
          : "Video yang diblokir:";

      // header + paging info
      const headerLines = [
        titleByKind,
        lang === "en"
          ? `Page ${page}/${totalPages}`
          : `Halaman ${page}/${totalPages}`,
        "",
        lang === "en"
          ? "Unban with /unbanmedia <id>."
          : "Unban dengan /unbanmedia <id>.",
      ];

      const kb = new InlineKeyboard();
      if (page > 1) {
        kb.text(
          lang === "en" ? "Prev" : "Sebelumnya",
          `banlist:${kind}:${page - 1}`
        );
      }
      if (page < totalPages) {
        if (page > 1) kb.text(" ", "noop");
        kb.text(
          lang === "en" ? "Next" : "Berikutnya",
          `banlist:${kind}:${page + 1}`
        );
      }

      await ctx.answerCallbackQuery({
        text:
          lang === "en"
            ? "Banned content list sent."
            : "Daftar konten yang diblokir dikirim.",
        show_alert: false,
      });

      // kirim header sekali
      await ctx.reply(headerLines.join("\n"), {
        reply_markup: kb.inline_keyboard.length ? kb : undefined,
      });

      // untuk setiap item: satu bubble teks + bubble media
      for (const bm of data) {
        const rep = reports.find((r) => r.id === bm.report_id);
        const created = bm.created_at
          ? new Date(bm.created_at).toLocaleString(
              lang === "en" ? "en-US" : "id-ID"
            )
          : "";

        const infoText =
          lang === "en"
            ? `id ${bm.id} [${created}]`
            : `id ${bm.id} [${created}]`;

        // kirim bubble teks info
        await ctx.reply(infoText);

        if (rep && rep.media_file_id) {
          const captionParts = [];
          if (rep.text) {
            captionParts.push(
              rep.text.length > 200 ? rep.text.slice(0, 197) + "..." : rep.text
            );
          } else if (rep.ocr_text) {
            const trimmed =
              rep.ocr_text.length > 200
                ? rep.ocr_text.slice(0, 197) + "..."
                : rep.ocr_text;
            captionParts.push(trimmed);
          }
          const caption = captionParts.join("\n");

          try {
            if (rep.message_type === "photo") {
              await bot.api.sendPhoto(ctx.chat.id, rep.media_file_id, {
                caption,
              });
            } else if (rep.message_type === "sticker") {
              await bot.api.sendSticker(ctx.chat.id, rep.media_file_id);
            } else if (rep.message_type === "video") {
              await bot.api.sendVideo(ctx.chat.id, rep.media_file_id, {
                caption,
              });
            } else if (rep.message_type === "document") {
              await bot.api.sendDocument(ctx.chat.id, rep.media_file_id, {
                caption,
              });
            } else if (rep.message_type === "voice") {
              await bot.api.sendVoice(ctx.chat.id, rep.media_file_id, {
                caption,
              });
            } else {
              // fallback: kirim teks saja
              if (caption) {
                await ctx.reply(caption);
              }
            }
          } catch (e) {
            // jika gagal kirim media, kirim caption saja
            if (caption) {
              await ctx.reply(caption);
            }
          }
        } else {
          // tidak ada media_file_id, kirim snippet teks/OCR
          if (rep) {
            const src = rep.text || rep.ocr_text || "";
            if (src) {
              const snippet =
                src.length > 200 ? src.slice(0, 197) + "..." : src;
              await ctx.reply(snippet);
            }
          }
        }
      }
    } catch (err) {
      const msg =
        lang === "en"
          ? "Cannot load banned details right now."
          : "Detail banned tidak dapat dimuat saat ini.";
      await ctx.answerCallbackQuery({ text: msg, show_alert: true });
    }
  });
      }
    }
  );

  // Callback pembayaran manual/Trakteer
  bot.callbackQuery(/^pay_manual:(.+)$/, async (ctx) => {
    const userId = ctx.from.id;
    const lang = await getUserLang(userId);
    const manualEnabled = await isPaymentEnabled("manual");
    if (!manualEnabled) {
      const msg =
        lang === "en"
          ? "⚠️ Manual payment is currently disabled."
          : "⚠️ Pembayaran manual saat ini dimatikan.";
      await ctx.answerCallbackQuery({ text: msg, show_alert: true });
      return;
    }

    const code = ctx.match[1];

    await setPaymentSession(userId, "manual");

    const textEn =
      "📱 *Manual payment (DANA/OVO/GoPay)*\n\n" +
      `Please transfer to *${E_WALLET_NAME}* (${E_WALLET_NUMBER}).\n` +
      "Use the following *unique code* in your payment note/message:\n\n" +
      `\`${code}\`\n\n` +
      "If you have an active *discount code*, it will be applied automatically if the amount and conditions match.\n\n" +
      "Then send your transfer *screenshot* in this chat. The bot will try to verify it automatically.\n" +
      "While you are in this payment session, your messages will not be forwarded to any chat partner.\n\n" +
      "If automatic checking fails, you can still use /paymanual to request a manual review.";
    const textId =
      "📱 *Pembayaran manual (DANA/OVO/GoPay)*\n\n" +
      `Silakan transfer ke *${E_WALLET_NAME}* (${E_WALLET_NUMBER}).\n` +
      "Gunakan *kode unik* berikut di catatan/pesan pembayaran kamu:\n\n" +
      `\`${code}\`\n\n` +
      "Jika kamu memiliki *kode diskon* aktif, diskon akan diterapkan otomatis jika nominal & syaratnya sesuai.\n\n" +
      "Setelah itu kirim *screenshot bukti transfer* di chat ini. Bot akan mencoba memverifikasi secara otomatis.\n" +
      "Selama kamu berada dalam sesi pembayaran ini, pesanmu tidak akan diteruskan ke pasangan chat.\n\n" +
      "Jika pengecekan otomatis gagal, kamu tetap bisa gunakan /paymanual untuk meminta review manual dari admin.";

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(lang === "en" ? textEn : textId, {
      parse_mode: "Markdown",
    });
  });

  bot.callbackQuery(/^pay_trakteer:(.+)$/, async (ctx) => {
    const userId = ctx.from.id;
    const lang = await getUserLang(userId);
    const trakteerEnabled = await isPaymentEnabled("trakteer");
    if (!trakteerEnabled) {
      const msg =
        lang === "en"
          ? "⚠️ Trakteer payment is currently disabled."
          : "⚠️ Pembayaran via Trakteer saat ini dimatikan.";
      await ctx.answerCallbackQuery({ text: msg, show_alert: true });
      return;
    }

    const code = ctx.match[1];

    const textEn =
      "💳 *Payment via Trakteer*\n\n" +
      "Tap the button below to open the Trakteer page.\n" +
      "In the support message, please include only this *unique code*:\n\n" +
      `\`${code}\`\n\n` +
      "Each Rp 1.000 = 1 day of premium. Example: Rp 10.000 → 10 days.\n\n" +
      "After Trakteer sends the notification, the bot/admin will extend your premium based on the amount.";
    const textId =
      "💳 *Pembayaran via Trakteer*\n\n" +
      "Tap tombol di bawah untuk membuka halaman Trakteer.\n" +
      "Di pesan dukungan, tulis *hanya kode unik* berikut ini:\n\n" +
      `\`${code}\`\n\n` +
      "Setiap Rp 1.000 = 1 hari premium. Contoh: Rp 10.000 → 10 hari.\n\n" +
      "Setelah Trakteer mengirim notifikasi, bot/admin akan menambah premium kamu berdasarkan nominal.";

    const keyboard = new InlineKeyboard();
    if (TRAKTEER_URL) {
      keyboard.url(
        lang === "en" ? "🔗 Open Trakteer page" : "🔗 Buka halaman Trakteer",
        TRAKTEER_URL
      );
    }

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(lang === "en" ? textEn : textId, {
      parse_mode: "Markdown",
      reply_markup: TRAKTEER_URL ? keyboard : undefined,
    });
  });

  bot.callbackQuery(/^pay_manual_admin:(\d+):(\d+):(\d+)$/, async (ctx) => {
    // Dipicu oleh USER yang ingin mengirim bukti ke admin
    const userId = Number(ctx.match[1]);
    const messageId = Number(ctx.match[2]);
    const days = Number(ctx.match[3]) || 0;
    const langUser = await getUserLang(userId);

    // Ubah pesan user agar tidak bisa spam
    try {
      const msg = ctx.callbackQuery.message;
      if (msg) {
        const text =
          langUser === "en"
            ? "📤 Your proof has been sent to the admin. Please wait for review."
            : "📤 Bukti pembayaranmu sudah dikirim ke admin. Mohon tunggu hasil review.";
        await bot.api.editMessageText(msg.chat.id, msg.message_id, text);
      }
    } catch (err) {
      console.error("Gagal edit pesan user setelah kirim ke admin:", err.message);
    }

    await ctx.answerCallbackQuery();

    // Kirim screenshot ke semua admin, beri tombol approve/reject
    for (const aid of ADMIN_IDS) {
      const langAdmin = await getUserLang(aid);
      const keyboard = new InlineKeyboard()
        .text(
          langAdmin === "en"
            ? `✅ Approve ${days || "?"} day(s)`
            : `✅ Setujui ${days || "?"} hari`,
          `pay_admin_approve:${userId}:${days || 0}`
        )
        .text(
          langAdmin === "en" ? "❌ Reject" : "❌ Tolak",
          `pay_admin_reject:${userId}`
        );

      try {
        await bot.api.copyMessage(aid, userId, messageId, {
          caption:
            langAdmin === "en"
              ? `Manual payment review for user ${userId}.`
              : `Review pembayaran manual untuk user ${userId}.`,
          reply_markup: keyboard,
        });
      } catch (err) {
        console.error("Gagal copyMessage ke admin:", err.message);
      }
    }
  });

  bot.callbackQuery(/^pay_admin_approve:(\d+):(\d+)$/, async (ctx) => {
    const adminId = ctx.from.id;
    if (!isAdmin(adminId)) {
      await ctx.answerCallbackQuery({
        text: "Only admins can approve.",
        show_alert: true,
      });
      return;
    }
    const userId = Number(ctx.match[1]);
    const days = Number(ctx.match[2]) || 0;
    const lang = await getUserLang(adminId);

    const message = ctx.callbackQuery.message;
    const originalCaption = (message && message.caption) || "";
    if (
      originalCaption.includes("✅ Approved") ||
      originalCaption.includes("❌ Rejected")
    ) {
      await ctx.answerCallbackQuery({
        text:
          lang === "en"
            ? "This payment has already been processed."
            : "Pembayaran ini sudah diproses.",
        show_alert: false,
      });
      return;
    }

    if (days <= 0) {
      await ctx.answerCallbackQuery({
        text:
          lang === "en"
            ? "Days is 0; please grant manually using /grantpremium."
            : "Jumlah hari 0; gunakan /grantpremium secara manual.",
        show_alert: true,
      });
      return;
    }

    await extendPremium(userId, days);
    await ctx.answerCallbackQuery({
      text:
        lang === "en"
          ? `Approved. Premium extended by ${days} day(s).`
          : `Disetujui. Premium ditambah ${days} hari.`,
      show_alert: true,
    });

    const approvedNote =
      lang === "en"
        ? `\n\n✅ Approved by admin ${adminId} for ${days} day(s).`
        : `\n\n✅ Disetujui oleh admin ${adminId} selama ${days} hari.`;

    try {
      const msg = ctx.callbackQuery.message;
      if (msg) {
        await bot.api.editMessageCaption(
          msg.chat.id,
          msg.message_id,
          {
            caption: originalCaption + approvedNote,
            reply_markup: undefined,
          }
        );
      }
    } catch (err) {
      console.error("Gagal edit caption approve:", err.message);
    }

    try {
      const userLang = await getUserLang(userId);
      const msgUser =
        userLang === "en"
          ? `🎉 Your manual payment has been approved by admin. Premium extended by ${days} day(s).`
          : `🎉 Pembayaran manual kamu disetujui admin. Premium ditambah ${days} hari.`;
      await bot.api.sendMessage(userId, msgUser);
    } catch (err) {
      console.error("Gagal kirim notifikasi ke user:", err.message);
    }
  });

  bot.callbackQuery(/^pay_admin_reject:(\d+)$/, async (ctx) => {
    const adminId = ctx.from.id;
    const lang = await getUserLang(adminId);

    if (!isAdmin(adminId)) {
      await ctx.answerCallbackQuery({
        text: lang === "en" ? "Admin only." : "Khusus admin.",
        show_alert: true,
      });
      return;
    }

    const userId = Number(ctx.match[1]);
    const message = ctx.callbackQuery.message;
    const originalCaption = (message && message.caption) || "";
    if (
      originalCaption.includes("✅ Approved") ||
      originalCaption.includes("❌ Rejected")
    ) {
      await ctx.answerCallbackQuery({
        text:
          lang === "en"
            ? "This payment has already been processed."
            : "Pembayaran ini sudah diproses.",
        show_alert: false,
      });
      return;
    }

    await ctx.answerCallbackQuery({
      text: lang === "en" ? "Marked as rejected." : "Ditandai sebagai ditolak.",
      show_alert: false,
    });

    const rejectedNote =
      lang === "en"
        ? `\n\n❌ Rejected by admin ${adminId}.`
        : `\n\n❌ Ditolak oleh admin ${adminId}.`;

    try {
      const msg = ctx.callbackQuery.message;
      if (msg) {
        await bot.api.editMessageCaption(msg.chat.id, msg.message_id, {
          caption: originalCaption + rejectedNote,
          reply_markup: undefined,
        });
      }
    } catch (err) {
      console.error("Gagal edit caption reject:", err.message);
    }

    try {
      const userLang = await getUserLang(userId);
      const msgUser =
        userLang === "en"
          ? "❌ Your manual payment has been reviewed and rejected by admin."
          : "❌ Pembayaran manual kamu telah ditinjau dan ditolak oleh admin.";
      await bot.api.sendMessage(userId, msgUser);
    } catch (err) {
      console.error("Gagal kirim notifikasi reject ke user:", err.message);
    }
  });

  // Inline gender profile selection
  bot.callbackQuery(/^mg:(male|female|other)$/, async (ctx) => {
    const userId = ctx.from.id;
    const lang = await getUserLang(userId);
    const g = ctx.match[1];

    await setMyGender(userId, g);

    const msg =
      lang === "en"
        ? `✅ Your gender has been set to *${g}*.`
        : `✅ Gender kamu diset ke *${g}*.`;

    try {
      await ctx.editMessageText(msg, { parse_mode: "Markdown" });
    } catch (_) {
      await ctx.answerCallbackQuery({
        text:
          lang === "en"
            ? "Gender updated."
            : "Gender diperbarui.",
        show_alert: false,
      });
    }
  });

  // Inline partner gender preference selection
  bot.callbackQuery(/^tg:(male|female|other|any)$/, async (ctx) => {
    const userId = ctx.from.id;
    const lang = await getUserLang(userId);

    const isPrem = await isPremium(userId);
    if (!isPrem) {
      await clearTargetGender(userId);
      await ctx.answerCallbackQuery({
        text:
          lang === "en"
            ? "Only premium users can set partner gender preference."
            : "Hanya pengguna premium yang bisa mengatur preferensi gender pasangan.",
        show_alert: true,
      });
      return;
    }

    let target = ctx.match[1];

    if (target === "any") {
      await clearTargetGender(userId);
      const msg =
        lang === "en"
          ? "✅ Your partner preference has been reset to *random (any)*."
          : "✅ Preferensi pasanganmu direset ke *acak (any)*.";
      try {
        await ctx.editMessageText(msg, { parse_mode: "Markdown" });
      } catch (_) {
        await ctx.answerCallbackQuery({
          text:
            lang === "en"
              ? "Preference reset to random."
              : "Preferensi direset ke acak.",
          show_alert: false,
        });
      }
      return;
    }

    await setTargetGender(userId, target);

    const msg =
      lang === "en"
        ? `✅ Your partner preference has been set to *${target}*.\nIt will stay active while you are premium.`
        : `✅ Preferensi pasanganmu diset ke *${target}*.\nPreferensi ini akan aktif selama kamu masih premium.`;

    try {
      await ctx.editMessageText(msg, { parse_mode: "Markdown" });
    } catch (_) {
      await ctx.answerCallbackQuery({
        text:
          lang === "en"
            ? "Preference updated."
            : "Preferensi diperbarui.",
        show_alert: false,
      });
    }
  });

  // Inline language selection
  bot.callbackQuery(/^lang:(id|en)$/, async (ctx) => {
    const userId = ctx.from.id;
    const choice = ctx.match[1];
    await setUserLang(userId, choice);

    const text =
      choice === "en"
        ? "✅ Language has been set to English."
        : "✅ Bahasa telah diubah ke Bahasa Indonesia.";

    try {
      await ctx.editMessageText(text);
    } catch (_) {
      await ctx.answerCallbackQuery({
        text,
        show_alert: false,
      });
    }
  });

  // Admin actions from report log group/DM: ban media (bukan user)
  bot.callbackQuery(/^admin_banmedia:(\d+)$/, async (ctx) => {
    const adminId = ctx.from.id;
    const lang = await getUserLang(adminId);

    if (!isAdmin(adminId)) {
      await ctx.answerCallbackQuery({
        text: lang === "en" ? "Admin only." : "Khusus admin.",
        show_alert: true,
      });
      return;
    }

    const reportId = Number(ctx.match[1]);
    if (!reportId) {
      await ctx.answerCallbackQuery({
        text: lang === "en" ? "Invalid report id." : "ID laporan tidak valid.",
        show_alert: false,
      });
      return;
    }

    // Ambil detail report dari Supabase
    const { data, error } = await supabase
      .from("reported_messages")
      .select("partner_id, media_unique_id, ocr_hash, text_hash, message_type")
      .eq("id", reportId)
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      await ctx.answerCallbackQuery({
        text:
          lang === "en"
            ? "Failed to load report detail."
            : "Gagal mengambil detail laporan.",
        show_alert: false,
      });
      return;
    }

    const reportedUserId = data.partner_id || 0;
    await banMedia({
      reportId,
      mediaType: data.message_type || "",
      mediaUniqueId: data.media_unique_id || "",
      ocrHash: data.ocr_hash || "",
      textHash: data.text_hash || "",
    });

    // turunkan trust user terlapor jika diketahui
    if (reportedUserId) {
      const trust = await adjustUserTrust(reportedUserId, -10);

      // jika laporan valid terkumpul >= 15 kali, auto-ban user
      if (trust && trust.total_reports_valid >= 15) {
        await banUser(
          reportedUserId,
          "Auto-ban: too many valid content reports"
        );

        // Beritahu user
        try {
          const uLang = await getUserLang(reportedUserId);
          await bot.api.sendMessage(
            reportedUserId,
            uLang === "en"
              ? "❌ Your account has been blocked automatically because there are too many valid reports on your content."
              : "❌ Akunmu otomatis diblokir karena terlalu banyak laporan valid terhadap kontenmu."
          );
        } catch (_) {}

        // Beritahu grup admin jika ada
        const autoBanLinesId = [
          "🛑 *Auto-ban pengguna*",
          "",
          `• User: ${reportedUserId}`,
          `• Total laporan valid: ${trust.total_reports_valid} / 15`,
          "• Alasan: terlalu banyak laporan valid terhadap konten.",
        ];
        const autoBanLinesEn = [
          "🛑 *User auto-banned*",
          "",
          `• User: ${reportedUserId}`,
          `• Total valid reports: ${trust.total_reports_valid} / 15`,
          "• Reason: too many valid reports on content.",
        ];
        const autoBanTextId = autoBanLinesId.join("\n");
        const autoBanTextEn = autoBanLinesEn.join("\n");

        if (REPORT_LOG_CHAT_ID) {
          try {
            await bot.api.sendMessage(
              REPORT_LOG_CHAT_ID,
              autoBanTextId,
              {
                parse_mode: "Markdown",
                message_thread_id:
                  REPORT_LOG_TOPIC_ID && REPORT_LOG_TOPIC_ID > 0
                    ? REPORT_LOG_TOPIC_ID
                    : undefined,
              }
            );
          } catch (_) {}
        }

        // DM ke setiap admin
        for (const admin of ADMIN_IDS) {
          try {
            const aLang = await getUserLang(admin);
            const t = aLang === "en" ? autoBanTextEn : autoBanTextId;
            await bot.api.sendMessage(admin, t, { parse_mode: "Markdown" });
          } catch (_) {}
        }
      }
    }

    await ctx.answerCallbackQuery({
      text:
        lang === "en"
          ? "Media has been banned. Similar content will be blocked."
          : "Media telah diblokir. Konten serupa akan diblokir.",
      show_alert: false,
    });

    const msg = ctx.callbackQuery.message;
    if (msg) {
      try {
        await bot.api.editMessageReplyMarkup(msg.chat.id, msg.message_id, {
          reply_markup: { inline_keyboard: [] },
        });
      } catch (_) {}
      try {
        await bot.api.sendMessage(
          msg.chat.id,
          lang === "en"
            ? `✅ Media banned (reported user ${reportedUserId}).`
            : `✅ Media diblokir (user terlapor ${reportedUserId}).`,
          {
            reply_to_message_id: msg.message_id,
            message_thread_id:
              REPORT_LOG_TOPIC_ID && REPORT_LOG_TOPIC_ID > 0
                ? REPORT_LOG_TOPIC_ID
                : undefined,
          }
        );
      } catch (_) {}
    }
  });

  bot.command("stats", async (ctx) => {
    const userId = ctx.from.id;
    const lang = await getUserLang(userId);
    const premium = await isPremium(userId);
    const stats = await getUserStats(userId);

    const linesId = [
      "📊 *Statistik kamu*",
      "",
      `• Total obrolan (search): ${stats.total_chats || 0}`,
      premium ? "• Status: Premium ✅" : "• Status: Gratis",
      stats.premium_expires_at
        ? `• Premium sampai: ${new Date(
            stats.premium_expires_at
          ).toLocaleString("id-ID")}`
        : "• Premium sampai: -",
      stats.last_active
        ? `• Terakhir aktif: ${new Date(stats.last_active).toLocaleString(
            "id-ID"
          )}`
        : "• Terakhir aktif: -",
    ];

    const linesEn = [
      "📊 *Your stats*",
      "",
      `• Total chats (search): ${stats.total_chats || 0}`,
      premium ? "• Status: Premium ✅" : "• Status: Free",
      stats.premium_expires_at
        ? `• Premium until: ${new Date(
            stats.premium_expires_at
          ).toLocaleString("en-US")}`
        : "• Premium until: -",
      stats.last_active
        ? `• Last active: ${new Date(stats.last_active).toLocaleString(
            "en-US"
          )}`
        : "• Last active: -",
    ];

    await ctx.reply(lang === "en" ? linesEn.join("\n") : linesId.join("\n"), {
      parse_mode: "Markdown",
    });
  });

  // Riwayat pembayaran user
  bot.command("payhistory", async (ctx) => {
    const userId = ctx.from.id;
    const lang = await getUserLang(userId);

    // Admin boleh melihat history user lain: /payhistory <user_id> [limit]
    const args = (ctx.match || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    let targetUserId = userId;
    let limit = 5;

    if (args.length >= 1 && isAdmin(userId)) {
      const idArg = Number(args[0]);
      if (!Number.isNaN(idArg) && idArg > 0) {
        targetUserId = idArg;
      }
      if (args.length >= 2) {
        const limArg = Number(args[1]);
        if (!Number.isNaN(limArg) && limArg > 0 && limArg <= 20) {
          limit = limArg;
        }
      }
    }

    const history = await getPaymentHistory(targetUserId, limit);

    if (!history.length) {
      const text =
        lang === "en"
          ? targetUserId === userId
            ? "ℹ️ You don't have any recorded payments yet."
            : `ℹ️ User ${targetUserId} doesn't have any recorded payments.`
          : targetUserId === userId
          ? "ℹ️ Kamu belum punya riwayat pembayaran."
          : `ℹ️ User ${targetUserId} belum punya riwayat pembayaran.`;
      await ctx.reply(text);
      return;
    }

    const lines = [];
    if (lang === "en") {
      lines.push(
        targetUserId === userId
          ? "💳 Your recent payment history:"
          : `💳 Recent payment history for user ${targetUserId}:`
      );
    } else {
      lines.push(
        targetUserId === userId
          ? "💳 Riwayat pembayaran terakhirmu:"
          : `💳 Riwayat pembayaran terakhir untuk user ${targetUserId}:`
      );
    }

    for (const item of history) {
      const created = item.created_at
        ? new Date(item.created_at).toLocaleString(
            lang === "en" ? "en-US" : "id-ID"
          )
        : "-";
      const statusLine =
        lang === "en"
          ? `• Status: ${item.status || "?"}`
          : `• Status: ${item.status || "?"}`;
      const methodLine =
        lang === "en"
          ? `• Method: ${item.method || "-"}`
          : `• Metode: ${item.method || "-"}`;
      const amountLine =
        lang === "en"
          ? `• Amount: Rp ${
              item.amount ? item.amount.toLocaleString("id-ID") : 0
            }`
          : `• Nominal: Rp ${
              item.amount ? item.amount.toLocaleString("id-ID") : 0
            }`;
      const daysLine =
        lang === "en"
          ? `• Days: ${item.days || 0}`
          : `• Hari: ${item.days || 0}`;
      const codeLine =
        item.code && item.code.length
          ? lang === "en"
            ? `• Code: ${item.code}`
            : `• Kode: ${item.code}`
          : "";
      const dateLine =
        lang === "en"
          ? `• Date: ${created}`
          : `• Tanggal: ${created}`;

      lines.push(
        [
          "",
          dateLine,
          methodLine,
          amountLine,
          daysLine,
          statusLine,
          codeLine,
        ]
          .filter(Boolean)
          .join("\n")
      );
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });

  bot.command("payment", async (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) {
      return;
    }

    const lang = await getUserLang(userId);
    const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean);

    if (args.length === 0) {
      const manualEnabled = await isPaymentEnabled("manual");
      const trakteerEnabled = await isPaymentEnabled("trakteer");

      const textId = [
        "⚙️ Status pembayaran:",
        `• Manual (DANA/OVO/Gopay): ${manualEnabled ? "ON ✅" : "OFF ❌"}`,
        `• Trakteer: ${trakteerEnabled ? "ON ✅" : "OFF ❌"}`,
        "",
        "Contoh:",
        "/payment on manual",
        "/payment off trakteer",
        "/payment on  (hidupkan semua)",
        "/payment off (matikan semua)",
      ].join("\n");

      const textEn = [
        "⚙️ Payment status:",
        `• Manual (e-wallet): ${manualEnabled ? "ON ✅" : "OFF ❌"}`,
        `• Trakteer: ${trakteerEnabled ? "ON ✅" : "OFF ❌"}`,
        "",
        "Examples:",
        "/payment on manual",
        "/payment off trakteer",
        "/payment on  (enable both)",
        "/payment off (disable both)",
      ].join("\n");

      await ctx.reply(lang === "en" ? textEn : textId);
      return;
    }

    const action = args[0].toLowerCase();
    const target = (args[1] || "").toLowerCase();

    if (!["on", "off"].includes(action)) {
      const msg =
        lang === "en"
          ? "Usage: /payment on|off [manual|trakteer]"
          : "Cara pakai: /payment on|off [manual|trakteer]";
      await ctx.reply(msg);
      return;
    }

    const enabled = action === "on";

    if (!target || target === "all") {
      await setPaymentEnabled("manual", enabled);
      await setPaymentEnabled("trakteer", enabled);
    } else if (target === "manual") {
      await setPaymentEnabled("manual", enabled);
    } else if (target === "trakteer") {
      await setPaymentEnabled("trakteer", enabled);
    } else {
      const msg =
        lang === "en"
          ? "Unknown target. Use: manual | trakteer | all"
          : "Target tidak dikenal. Gunakan: manual | trakteer | all";
      await ctx.reply(msg);
      return;
    }

    const manualEnabled = await isPaymentEnabled("manual");
    const trakteerEnabled = await isPaymentEnabled("trakteer");

    const textId = [
      "✅ Pengaturan pembayaran diperbarui:",
      `• Manual (DANA/OVO/Gopay): ${manualEnabled ? "ON ✅" : "OFF ❌"}`,
      `• Trakteer: ${trakteerEnabled ? "ON ✅" : "OFF ❌"}`,
    ].join("\n");

    const textEn = [
      "✅ Payment settings updated:",
      `• Manual (e-wallet): ${manualEnabled ? "ON ✅" : "OFF ❌"}`,
      `• Trakteer: ${trakteerEnabled ? "ON ✅" : "OFF ❌"}`,
    ].join("\n");

    await ctx.reply(lang === "en" ? textEn : textId);
  });

  // Admin: create discount code
  bot.command("discount_add", async (ctx) => {
    const adminId = ctx.from.id;
    if (!isAdmin(adminId)) {
      return;
    }
    const lang = await getUserLang(adminId);
    const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean);
    // /discount_add CODE PERCENT [MAX_USES] [HOURS] [MIN_AMOUNT]
    if (args.length < 2) {
      const msg =
        lang === "en"
          ? "Usage: /discount_add CODE PERCENT [MAX_USES] [HOURS] [MIN_AMOUNT]\nExample: /discount_add DISC20 20 100 168 10000"
          : "Cara pakai: /discount_add KODE PERSEN [MAX_USES] [JAM] [MIN_NOMINAL]\nContoh: /discount_add DISC20 20 100 168 10000";
      await ctx.reply(msg);
      return;
    }

    const rawCode = args[0];
    const percent = Number(args[1]);
    const maxUses = args.length >= 3 ? Number(args[2]) : 0;
    const hours = args.length >= 4 ? Number(args[3]) : 0;
    const minAmount = args.length >= 5 ? Number(args[4]) : 0;

    try {
      const info = await createDiscountCode({
        rawCode,
        percent,
        maxUses,
        validHours: hours,
        minAmount,
        createdBy: adminId,
      });

      const minLine =
        info.min_amount && info.min_amount > 0
          ? lang === "en"
            ? `• Minimum amount: Rp ${info.min_amount.toLocaleString("id-ID")}`
            : `• Minimal nominal: Rp ${info.min_amount.toLocaleString("id-ID")}`
          : "";

      const maxLine =
        info.max_uses && info.max_uses > 0
          ? lang === "en"
            ? `• Max uses: ${info.max_uses}`
            : `• Maks pemakaian: ${info.max_uses}`
          : lang === "en"
          ? "• Max uses: unlimited"
          : "• Maks pemakaian: tanpa batas";

      const expLine = info.expire_at
        ? lang === "en"
          ? `• Expires at: ${new Date(info.expire_at).toLocaleString("en-US")}`
          : `• Berlaku sampai: ${new Date(info.expire_at).toLocaleString(
              "id-ID"
            )}`
        : lang === "en"
        ? "• Expires at: (no expiry set)"
        : "• Berlaku sampai: (tanpa batas waktu)";

      const text =
        lang === "en"
          ? [
              "✅ Discount code created:",
              "",
              `• Code: \`${info.code}\``,
              `• Percent: ${info.percent}%`,
              maxLine,
              minLine,
              expLine,
            ]
              .filter(Boolean)
              .join("\n")
          : [
              "✅ Kode diskon dibuat:",
              "",
              `• Kode: \`${info.code}\``,
              `• Diskon: ${info.percent}%`,
              maxLine,
              minLine,
              expLine,
            ]
              .filter(Boolean)
              .join("\n");

      await ctx.reply(text, { parse_mode: "Markdown" });

      // Broadcast ke semua user yang pernah tercatat
      const userIds = await getAllUserIdsForBroadcast();
      const broadcastTextId = [
        "💸 *Kode Diskon Baru!*",
        "",
        `Kode: \`${info.code}\``,
        `Diskon: ${info.percent}%`,
        minLine || "",
        expLine || "",
        "",
        "Gunakan /discount dan masukkan kode di atas untuk klaim.",
      ]
        .filter(Boolean)
        .join("\n");

      const broadcastTextEn = [
        "💸 *New Discount Code!*",
        "",
        `Code: \`${info.code}\``,
        `Discount: ${info.percent}%`,
        minLine
          ? `• Minimum amount: Rp ${info.min_amount.toLocaleString("id-ID")}`
          : "",
        expLine || "",
        "",
        "Use /discount and enter the code above to claim.",
      ]
        .filter(Boolean)
        .join("\n");

      for (const uid of userIds) {
        try {
          const uLang = await getUserLang(uid);
          const t = uLang === "en" ? broadcastTextEn : broadcastTextId;
          await bot.api.sendMessage(uid, t, { parse_mode: "Markdown" });
        } catch (e) {
          // abaikan error kirim ke user tertentu
        }
      }
    } catch (err) {
      const msg =
        lang === "en"
          ? `❌ Failed to create discount code: ${err.message}`
          : `❌ Gagal membuat kode diskon: ${err.message}`;
      await ctx.reply(msg);
    }
  });

  // Admin: disable/enable discount code
  bot.command("discount_disable", async (ctx) => {
    const adminId = ctx.from.id;
    if (!isAdmin(adminId)) {
      return;
    }
    const lang = await getUserLang(adminId);
    const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean);
    // /discount_disable CODE [on|off]
    if (args.length < 1) {
      const msg =
        lang === "en"
          ? "Usage: /discount_disable CODE [on|off]\nExample: /discount_disable DISC20 off"
          : "Cara pakai: /discount_disable KODE [on|off]\nContoh: /discount_disable DISC20 off";
      await ctx.reply(msg);
      return;
    }

    const rawCode = args[0];
    const flag = (args[1] || "off").toLowerCase();
    const disabled = flag !== "on";

    const ok = await disableDiscountCode(rawCode, disabled);
    if (!ok) {
      const msg =
        lang === "en"
          ? "❌ Failed to update discount code (maybe not found)."
          : "❌ Gagal mengubah status kode diskon (mungkin tidak ditemukan).";
      await ctx.reply(msg);
      return;
    }

    const msg =
      lang === "en"
        ? `✅ Discount code ${rawCode} is now ${disabled ? "DISABLED" : "ENABLED"}.`
        : `✅ Kode diskon ${rawCode} sekarang ${disabled ? "DINONAKTIFKAN" : "DIAKTIFKAN"}.`;
    await ctx.reply(msg);
  });

  // Admin: grant premium manually
  bot.command("grantpremium", async (ctx) => {
    const adminId = ctx.from.id;
    if (!isAdmin(adminId)) {
      return;
    }

    const lang = await getUserLang(adminId);
    const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean);

    if (args.length < 2) {
      const msg =
        lang === "en"
          ? "Usage: /grantpremium <user_id> <days>"
          : "Cara pakai: /grantpremium <user_id> <hari>";
      await ctx.reply(msg);
      return;
    }

    const userId = Number(args[0]);
    const days = Number(args[1]);

    if (!userId || Number.isNaN(userId) || !days || Number.isNaN(days) || days <= 0) {
      const msg =
        lang === "en"
          ? "User ID and days must be valid numbers and days > 0."
          : "User ID dan jumlah hari harus berupa angka dan hari > 0.";
      await ctx.reply(msg);
      return;
    }

    await extendPremium(userId, days);

    const msgAdmin =
      lang === "en"
        ? `Premium for user ${userId} extended by ${days} day(s).`
        : `Premium untuk user ${userId} ditambah ${days} hari.`;
    await ctx.reply(msgAdmin);

    try {
      const userLang = await getUserLang(userId);
      const msgUser =
        userLang === "en"
          ? `Premium has been extended by ${days} day(s) by admin.`
          : `Premium kamu ditambah ${days} hari oleh admin.`;
      await bot.api.sendMessage(userId, msgUser);
    } catch (_) {}
  });

  // Admin: global stats
  bot.command("adminstats", async (ctx) => {
    const adminId = ctx.from.id;
    if (!isAdmin(adminId)) return;
    const lang = await getUserLang(adminId);

    try {
      // total users from user_stats
      const { data: statsRows, error: statsErr } = await supabase
        .from("user_stats")
        .select("user_id");
      const totalUsers =
        !statsErr && Array.isArray(statsRows) ? statsRows.length : 0;

      // active sessions = count pairs
      const { count: activeSessions, error: pairsErr } = await supabase
        .from("pairs")
        .select("user_id", { count: "exact", head: true });

      // queue waiting
      const { count: queueCount, error: queueErr } = await supabase
        .from("queue_free")
        .select("user_id", { count: "exact", head: true });

      // premium users
      const nowIso = new Date().toISOString();
      const { count: premiumCount, error: premErr } = await supabase
        .from("premium")
        .select("user_id", { count: "exact", head: true })
        .gt("expires_at", nowIso);

      // banned users
      const { count: bannedCount, error: banErr } = await supabase
        .from("banned_users")
        .select("user_id", { count: "exact", head: true });

      if (statsErr || pairsErr || queueErr || premErr || banErr) {
        throw new Error("database error");
      }

      if (lang === "en") {
        const lines = [
          "System summary:",
          "",
          `• Total users: ${totalUsers}`,
          `• Active sessions: ${activeSessions || 0}`,
          `• Waiting in queue: ${queueCount || 0}`,
          `• Premium users: ${premiumCount || 0}`,
          `• Banned users: ${bannedCount || 0}`,
        ];
        await ctx.reply(lines.join("\n"));
      } else {
        const lines = [
          "Ringkasan sistem:",
          "",
          `• Total pengguna: ${totalUsers}`,
          `• Sesi aktif: ${activeSessions || 0}`,
          `• Menunggu di antrian: ${queueCount || 0}`,
          `• Pengguna premium: ${premiumCount || 0}`,
          `• Pengguna diblokir: ${bannedCount || 0}`,
        ];
        await ctx.reply(lines.join("\n"));
      }
    } catch (err) {
      const msg =
        lang === "en"
          ? "Cannot load system stats right now."
          : "Statistik sistem tidak dapat dimuat saat ini.";
      await ctx.reply(msg);
    }
  });

  // Admin: list banned summary + inline filter
  bot.command("list_banned", async (ctx) => {
    const adminId = ctx.from.id;
    if (!isAdmin(adminId)) return;
    const lang = await getUserLang(adminId);

    try {
      const { count: userCount, error: userErr } = await supabase
        .from("banned_users")
        .select("user_id", { count: "exact", head: true });

      const { count: textCount, error: textErr } = await supabase
        .from("banned_media")
        .select("id", { count: "exact", head: true })
        .eq("media_type", "text");

      const { count: photoCount, error: photoErr } = await supabase
        .from("banned_media")
        .select("id", { count: "exact", head: true })
        .eq("media_type", "photo");

      const { count: stickerCount, error: stickerErr } = await supabase
        .from("banned_media")
        .select("id", { count: "exact", head: true })
        .eq("media_type", "sticker");

      const { count: videoCount, error: videoErr } = await supabase
        .from("banned_media")
        .select("id", { count: "exact", head: true })
        .eq("media_type", "video");

      if (userErr || textErr || photoErr || stickerErr || videoErr) {
        throw new Error("database error");
      }

      const lines =
        lang === "en"
          ? [
              "Banned summary:",
              "",
              `• Users banned: ${userCount || 0}`,
              `• Text banned: ${textCount || 0}`,
              `• Images banned: ${photoCount || 0}`,
              `• Stickers banned: ${stickerCount || 0}`,
              `• Videos banned: ${videoCount || 0}`,
            ]
          : [
              "Ringkasan banned:",
              "",
              `• User diblokir: ${userCount || 0}`,
              `• Teks diblokir: ${textCount || 0}`,
              `• Gambar diblokir: ${photoCount || 0}`,
              `• Stiker diblokir: ${stickerCount || 0}`,
              `• Video diblokir: ${videoCount || 0}`,
            ];

      const kb = new InlineKeyboard()
        .text("User", "banlist:user")
        .row()
        .text("Text", "banlist:text:1")
        .text("Image", "banlist:photo:1")
        .row()
        .text("Sticker", "banlist:sticker:1")
        .text("Video", "banlist:video:1");

      await ctx.reply(lines.join("\n"), { reply_markup: kb });
    } catch (err) {
      const msg =
        lang === "en"
          ? "Cannot load banned summary right now."
          : "Ringkasan banned tidak dapat dimuat saat ini.";
      await ctx.reply(msg);
    }
  });

  // Admin: broadcast to active users
  bot.command("broadcast", async (ctx) => {
    const adminId = ctx.from.id;
    if (!isAdmin(adminId)) return;
    const lang = await getUserLang(adminId);
    const text = (ctx.match || "").trim();

    if (!text) {
      const msg =
        lang === "en"
          ? "Usage: /broadcast <message>"
          : "Cara pakai: /broadcast <pesan>";
      await ctx.reply(msg);
      return;
    }

    const userIds = await getAllUserIdsForBroadcast();
    let sent = 0;
    for (const uid of userIds) {
      try {
        await bot.api.sendMessage(uid, text);
        sent += 1;
      } catch (_) {
        // abaikan error kirim ke user tertentu
      }
    }

    const msg =
      lang === "en"
        ? `Broadcast sent to ${sent} users.`
        : `Broadcast dikirim ke ${sent} pengguna.`;
    await ctx.reply(msg);
  });

  // Admin: gift premium to random active free users
  bot.command("giftpremium", async (ctx) => {
    const adminId = ctx.from.id;
    if (!isAdmin(adminId)) return;
    const lang = await getUserLang(adminId);
    const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean);

    if (args.length < 2) {
      const msg =
        lang === "en"
          ? "Usage: /giftpremium <count> <days>"
          : "Cara pakai: /giftpremium <jumlah> <hari>";
      await ctx.reply(msg);
      return;
    }

    const count = Number(args[0]);
    const days = Number(args[1]);
    if (
      !count ||
      Number.isNaN(count) ||
      count <= 0 ||
      !days ||
      Number.isNaN(days) ||
      days <= 0
    ) {
      const msg =
        lang === "en"
          ? "Count and days must be numbers > 0."
          : "Jumlah dan hari harus berupa angka > 0.";
      await ctx.reply(msg);
      return;
    }

    const userIds = await getAllUserIdsForBroadcast();
    const candidates = [];
    for (const uid of userIds) {
      const prem = await isPremium(uid);
      if (!prem) {
        candidates.push(uid);
      }
    }

    if (candidates.length === 0) {
      const msg =
        lang === "en"
          ? "No eligible free users to gift."
          : "Tidak ada pengguna gratis yang bisa diberi premium.";
      await ctx.reply(msg);
      return;
    }

    // acak daftar kandidat
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    const selected = candidates.slice(0, count);
    let gifted = 0;
    for (const uid of selected) {
      try {
        await extendPremium(uid, days);
        gifted += 1;
        try {
          const uLang = await getUserLang(uid);
          const msgUser =
            uLang === "en"
              ? `You have received ${days} day(s) of premium.`
              : `Kamu mendapat premium ${days} hari.`;
          await bot.api.sendMessage(uid, msgUser);
        } catch (_) {}
      } catch (_) {}
    }

    const msg =
      lang === "en"
        ? `Premium gifted to ${gifted} users for ${days} day(s).`
        : `Premium diberikan ke ${gifted} pengguna selama ${days} hari.`;
    await ctx.reply(msg);
  });

  // Admin: unban media by id
  bot.command("unbanmedia", async (ctx) => {
    const adminId = ctx.from.id;
    if (!isAdmin(adminId)) return;
    const lang = await getUserLang(adminId);
    const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean);

    if (args.length < 1) {
      const msg =
        lang === "en"
          ? "Usage: /unbanmedia <id>"
          : "Cara pakai: /unbanmedia <id>";
      await ctx.reply(msg);
      return;
    }

    const id = Number(args[0]);
    if (!id || Number.isNaN(id) || id <= 0) {
      const msg =
        lang === "en"
          ? "ID must be a valid number."
          : "ID harus berupa angka yang valid.";
      await ctx.reply(msg);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("banned_media")
        .select("id,media_type,created_at")
        .eq("id", id)
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        const msg =
          lang === "en"
            ? `No banned media found with id ${id}.`
            : `Tidak ada media yang diblokir dengan id ${id}.`;
        await ctx.reply(msg);
        return;
      }

      const del = await supabase
        .from("banned_media")
        .delete()
        .eq("id", id);

      if (del.error) throw del.error;

      const msg =
        lang === "en"
          ? `Media with id ${id} has been unbanned.`
          : `Media dengan id ${id} telah dibuka blokirnya.`;
      await ctx.reply(msg);
    } catch (err) {
      const msg =
        lang === "en"
          ? "Cannot unban media right now."
          : "Media tidak dapat di-unban saat ini.";
      await ctx.reply(msg);
    }
  });

  // Admin: cek status user
  bot.command("user", async (ctx) => {
    const adminId = ctx.from.id;
    if (!isAdmin(adminId)) return;
    const lang = await getUserLang(adminId);
    const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean);

    if (args.length < 1) {
      const msg =
        lang === "en"
          ? "Usage: /user <user_id>"
          : "Cara pakai: /user <user_id>";
      await ctx.reply(msg);
      return;
    }

    const targetId = Number(args[0]);
    if (!targetId || Number.isNaN(targetId)) {
      const msg =
        lang === "en"
          ? "User ID must be a valid number."
          : "User ID harus berupa angka yang valid.";
      await ctx.reply(msg);
      return;
    }

    const banned = await isBanned(targetId);
    const premium = await isPremium(targetId);
    const stats = await getUserStats(targetId);
    const trust = await getUserTrust(targetId);

    const linesId = [
      "👤 *Info user*",
      "",
      `• ID: ${targetId}`,
      `• Banned: ${banned ? "YA" : "TIDAK"}`,
      `• Premium: ${premium ? "YA" : "TIDAK"}`,
      stats.premium_expires_at
        ? `• Premium sampai: ${new Date(
            stats.premium_expires_at
          ).toLocaleString("id-ID")}`
        : "• Premium sampai: -",
      `• Total obrolan: ${stats.total_chats || 0}`,
      stats.last_active
        ? `• Terakhir aktif: ${new Date(stats.last_active).toLocaleString(
            "id-ID"
          )}`
        : "• Terakhir aktif: -",
      `• Trust score: ${trust.score} / 100`,
      `• Total laporan valid: ${trust.total_reports_valid || 0} / 15`,
    ];

    const linesEn = [
      "👤 *User info*",
      "",
      `• ID: ${targetId}`,
      `• Banned: ${banned ? "YES" : "NO"}`,
      `• Premium: ${premium ? "YES" : "NO"}`,
      stats.premium_expires_at
        ? `• Premium until: ${new Date(
            stats.premium_expires_at
          ).toLocaleString("en-US")}`
        : "• Premium until: -",
      `• Total chats: ${stats.total_chats || 0}`,
      stats.last_active
        ? `• Last active: ${new Date(stats.last_active).toLocaleString(
            "en-US"
          )}`
        : "• Last active: -",
      `• Trust score: ${trust.score} / 100`,
      `• Total valid reports: ${trust.total_reports_valid || 0} / 15`,
    ];

    await ctx.reply(lang === "en" ? linesEn.join("\n") : linesId.join("\n"), {
      parse_mode: "Markdown",
    });
  });

  bot.on("message", async (ctx) => {
    if (ctx.message.text && ctx.message.text.startsWith("/")) return;

    const userId = ctx.from.id;

    if (await isBanned(userId)) {
      const lang = await getUserLang(userId);
      const msg =
        lang === "en"
          ? "Your account is blocked."
          : "Akunmu diblokir.";
      await ctx.reply(msg);
      return;
    }

    // rate limit pesan
    const now = Date.now();
    const bucket = messageRateBuckets.get(userId) || {
      count: 0,
      resetAt: now + MESSAGE_RATE_WINDOW_MS,
    };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + MESSAGE_RATE_WINDOW_MS;
    }
    bucket.count += 1;
    messageRateBuckets.set(userId, bucket);

    if (bucket.count > MESSAGE_RATE_LIMIT_MAX) {
      const lang = await getUserLang(userId);
      const msg =
        lang === "en"
          ? "You are sending messages too fast. Please wait a moment."
          : "Kamu mengirim pesan terlalu cepat. Tunggu sebentar.";
      await ctx.reply(msg);
      return;
    }

    const paymentMode = await getPaymentSession(userId);
    if (paymentMode === "manual") {
      const lang = await getUserLang(userId);
      const msg = ctx.message;

      if (msg.photo && msg.photo.length > 0) {
        const photo = msg.photo[msg.photo.length - 1];
        const ocrText = await ocrPhotoFromTelegram(ctx, photo);
        const amounts = extractAmountCandidates(ocrText);
        const maxAmount = amounts.length ? amounts[amounts.length - 1] : 0;
        const codes = findPaymentCodes(ocrText);
        const txDate = parseTransactionDatetime(ocrText);
        const walletType = detectWallet(ocrText);
        const now = new Date();
        const diffHours =
          txDate != null
            ? Math.abs(now.getTime() - txDate.getTime()) / 3600000
            : null;

        const within24h =
          diffHours != null && Number.isFinite(diffHours) && diffHours <= 24;

        let baseDays = computePremiumDaysFromAmount(maxAmount);
        let status = "pending";

        // Verifikasi berbeda untuk DANA vs GoPay
        if (baseDays > 0 && within24h) {
          if (walletType === "GOPAY") {
            const { name, last4 } = parseGopayRecipient(ocrText);
            const expectedLast4 = E_WALLET_NUMBER.slice(-4);
            const norm = (s) =>
              (s || "")
                .toUpperCase()
                .replace(/\s+/g, " ")
                .trim();
            const nameOk =
              name && norm(name).includes(norm(E_WALLET_NAME));
            const last4Ok = last4 === expectedLast4;

            if (nameOk && last4Ok) {
              status = "approved";
            }
          } else {
            // Default: gunakan verifikasi nomor+nama seperti DANA
            const hasWalletInfo = containsWalletInfo(ocrText);
            if (hasWalletInfo) {
              status = "approved";
            }
          }
        }

        let totalDays = baseDays;
        let discountCode = null;
        let bonusDays = 0;
        if (status === "approved" && baseDays > 0) {
          const activeCode = await getUserDiscount(userId);
          if (activeCode) {
            const info = await getDiscountInfo(activeCode);
            if (info && maxAmount >= (info.min_amount || 0)) {
              discountCode = info.code;
              bonusDays = Math.max(
                Math.floor((baseDays * Number(info.percent || 0)) / 100),
                1
              );
              totalDays += bonusDays;
              await markDiscountUsed(discountCode, userId);
              await clearUserDiscount(userId);
            }
          }

          await extendPremium(userId, totalDays);
        }

        await logPayment({
          userId,
          method: "manual",
          amount: maxAmount || 0,
          days: totalDays || 0,
          status,
          wallet: discountCode
            ? `${walletType} (disc ${discountCode} ${bonusDays}d) | ${E_WALLET_NAME} ${E_WALLET_NUMBER}`
            : `${walletType} | ${E_WALLET_NAME} ${E_WALLET_NUMBER}`,
          ocrText,
          code: codes.length ? codes[0] : "",
          txDatetime: txDate ? txDate.toISOString() : null,
        });

        // Kirim log ke grup transaksi jika dikonfigurasi
        if (PAYMENT_LOG_CHAT_ID) {
          const baseLines = [
            "💸 *Pembayaran Manual*",
            "",
            `User ID: \`${userId}\``,
            `Status: ${status.toUpperCase()}`,
            `Jenis wallet OCR: ${walletType}`,
            `Nominal OCR: Rp ${
              maxAmount ? maxAmount.toLocaleString("id-ID") : 0
            }`,
            `Hari premium: ${days}`,
            `Wallet target: ${E_WALLET_NAME} (${E_WALLET_NUMBER})`,
            `Kode pembayaran OCR: ${codes.length ? codes.join(", ") : "-"}`,
            `Tanggal transaksi OCR: ${
              txDate ? txDate.toISOString() : "tidak terbaca"
            }`,
            "",
            "*OCR text:*",
            "```",
            (ocrText || "").slice(0, 1900),
            "```",
          ];
          const logText = baseLines.join("\n");

          try {
            await bot.api.sendMessage(PAYMENT_LOG_CHAT_ID, logText, {
              parse_mode: "Markdown",
              message_thread_id:
                PAYMENT_LOG_TOPIC_ID && PAYMENT_LOG_TOPIC_ID > 0
                  ? PAYMENT_LOG_TOPIC_ID
                  : undefined,
            });
          } catch (err) {
            console.error("Gagal kirim log pembayaran:", err.message);
          }
        }

        if (status === "approved") {
          const baseMsg =
            lang === "en"
              ? `✅ Payment detected successfully.\nAmount: Rp ${maxAmount.toLocaleString(
                  "id-ID"
                )}\nPremium extended by ${totalDays} day(s).`
              : `✅ Pembayaran berhasil terdeteksi.\nNominal: Rp ${maxAmount.toLocaleString(
                  "id-ID"
                )}\nPremium kamu ditambah ${totalDays} hari.`;

          const discMsg =
            discountCode && bonusDays > 0
              ? lang === "en"
                ? `\n\nIncluding bonus ${bonusDays} day(s) from discount code ${discountCode}.`
                : `\n\nTermasuk bonus ${bonusDays} hari dari kode diskon ${discountCode}.`
              : "";

          await ctx.reply(baseMsg + discMsg);
        } else {
          const linesId = [
            "⚠️ Pembayaranmu belum bisa diverifikasi otomatis.",
            "",
            `Nominal OCR: Rp ${
              maxAmount ? maxAmount.toLocaleString("id-ID") : 0
            }`,
            `Kode pembayaran OCR: ${codes.length ? codes.join(", ") : "-"}`,
            "",
            "Admin akan meninjau bukti pembayaranmu secara manual.",
            "Jika perlu, kamu bisa tetap menggunakan /paymanual untuk menghubungi admin.",
          ];
          const linesEn = [
            "⚠️ We couldn't automatically verify your payment.",
            "",
            `Amount OCR: Rp ${
              maxAmount ? maxAmount.toLocaleString("id-ID") : 0
            }`,
            `Payment code OCR: ${codes.length ? codes.join(", ") : "-"}`,
            "",
            "The admin will review your payment manually.",
            "If needed, you can still use /paymanual to contact the admin.",
          ];

          const text = lang === "en" ? linesEn.join("\n") : linesId.join("\n");
          const keyboard = new InlineKeyboard().text(
            lang === "en"
              ? "📤 Send to admin (once)"
              : "📤 Kirim ke admin (sekali)",
            `pay_manual_admin:${userId}:${msg.message_id}:${days || 0}`
          );

          await ctx.reply(text, { reply_markup: keyboard });
        }

        await setPaymentSession(userId, null);
      } else {
        await ctx.reply(
          lang === "en"
            ? "📷 Please send a *screenshot* of your transfer for manual payment."
            : "📷 Silakan kirim *screenshot* bukti transfer untuk pembayaran manual."
        );
      }
      return;
    }

    const partnerId = await getPartner(userId);

    if (!partnerId) {
      await ctx.reply("Kamu belum punya pasangan. Gunakan /search untuk mencari.");
      return;
    }

    const msg = ctx.message;

    // Cek apakah konten sudah diblokir (ban media/text)
    let mediaUniqueId = "";
    let textHash = "";
    if (msg.text) {
      const t = msg.text.trim();
      if (t.length > 0) {
        textHash = crypto
          .createHash("sha256")
          .update(t.toLowerCase())
          .digest("hex");
      }
    } else if (msg.photo && msg.photo.length > 0) {
      const photo = msg.photo[msg.photo.length - 1];
      mediaUniqueId = photo.file_unique_id;
    } else if (msg.sticker) {
      mediaUniqueId = msg.sticker.file_unique_id;
    } else if (msg.video) {
      mediaUniqueId = msg.video.file_unique_id;
    } else if (msg.document) {
      mediaUniqueId = msg.document.file_unique_id;
    } else if (msg.voice) {
      mediaUniqueId = msg.voice.file_unique_id;
    }

    if (mediaUniqueId || textHash) {
      try {
        const banned = await isMediaBanned({
          mediaUniqueId,
          ocrHash: "",
          textHash,
        });
        if (banned) {
          const lang = await getUserLang(userId);
          const blockMsg =
            lang === "en"
              ? "This content is blocked and was not forwarded to your partner."
              : "Konten ini diblokir dan tidak diteruskan ke pasanganmu.";
          await ctx.reply(blockMsg);
          return;
        }
      } catch (e) {
        console.error("Gagal cek banned media:", e.message);
      }
    }

    // Blok file berbahaya untuk dokumen
    if (msg.document && msg.document.file_name) {
      const name = msg.document.file_name.toLowerCase();
      if (
        DANGEROUS_EXTENSIONS.some((ext) => name.endsWith(ext))
      ) {
        const lang = await getUserLang(userId);
        const warn =
          lang === "en"
            ? "This type of file is not allowed."
            : "Tipe file ini tidak diizinkan.";
        await ctx.reply(warn);
        return;
      }
    }

    try {
      if (msg.text) {
        const safeText = censorText(msg.text);
        await bot.api.sendMessage(partnerId, safeText);
      } else if (msg.photo && msg.photo.length > 0) {
        const photo = msg.photo[msg.photo.length - 1];
        const caption = msg.caption ? censorText(msg.caption) : undefined;
        await bot.api.sendPhoto(partnerId, photo.file_id, {
          caption,
        });
      } else if (msg.sticker) {
        await bot.api.sendSticker(partnerId, msg.sticker.file_id);
      } else if (msg.voice) {
        await bot.api.sendVoice(partnerId, msg.voice.file_id);
      } else if (msg.document) {
        const caption = msg.caption ? censorText(msg.caption) : undefined;
        await bot.api.sendDocument(partnerId, msg.document.file_id, {
          caption,
        });
      } else {
        await ctx.reply("Jenis pesan ini belum didukung sepenuhnya.");
      }
    } catch (err) {
      console.error("Gagal forward ke partner:", err.message);
      await ctx.reply(
        "Terjadi kesalahan saat mengirim pesan ke pasangan. Mungkin dia sudah offline."
      );
      await clearPair(userId);
    }
  });

  bot.start();
  console.log("🤖 Bot Telegram berjalan (NodeJS + grammY + Supabase)");
}

main().catch((err) => {
  console.error("Gagal start bot:", err);
  process.exit(1);
});