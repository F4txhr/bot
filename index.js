const { Bot, InlineKeyboard } = require("grammy");
const Tesseract = require("tesseract.js");
require("dotenv").config();

const {
  initDb,
  getPartner,
  setPair,
  clearPair,
  removeFromQueue,
  popFromQueueExcept,
  pushToQueue,
  isBanned,
  banUser,
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
} = require("./db");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean)
  .map((x) => Number(x))
  .filter((x) => !Number.isNaN(x));
const TRAKTEER_URL = process.env.TRAKTEER_URL || "";
const E_WALLET_NUMBER = (process.env.E_WALLET_NUMBER || "089647770084").trim();
const E_WALLET_NAME = (process.env.E_WALLET_NAME || "Achmad fatkurrois").trim();
const PAYMENT_LOG_CHAT_ID = Number(process.env.PAYMENT_LOG_CHAT_ID || "0");
const PAYMENT_LOG_TOPIC_ID = Number(process.env.PAYMENT_LOG_TOPIC_ID || "0");
const REPORT_LOG_CHAT_ID = Number(
  process.env.REPORT_LOG_CHAT_ID || PAYMENT_LOG_CHAT_ID || "0"
);
const REPORT_LOG_TOPIC_ID = Number(process.env.REPORT_LOG_TOPIC_ID || "0");

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN belum diset di environment / .env");
  process.exit(1);
}

const AUTO_BAN_REPORTS = 3;

const bot = new Bot(BOT_TOKEN);

function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

// === Helper OCR & parsing pembayaran manual ===

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
        ? "❌ Your account is blocked."
        : "❌ Akunmu diblokir.";
    await ctx.reply(msg);
    return;
  }

  const partnerIdExisting = await getPartner(userId);
  if (partnerIdExisting) {
    await ctx.reply("ℹ️ Kamu sudah dalam obrolan. Gunakan /stop untuk keluar.");
    return;
  }

  await removeFromQueue(userId);

  const otherId = await popFromQueueExcept(userId);

  if (otherId && otherId !== userId) {
    await setPair(userId, otherId);

    await ctx.reply("✅ Ditemukan pasangan! Mulai ngobrol sekarang.");
    await bot.api.sendMessage(
      otherId,
      "✅ Ditemukan pasangan! Mulai ngobrol sekarang."
    );
  } else {
    await pushToQueue(userId);
    await ctx.reply("🔍 Kamu masuk antrian, menunggu pasangan...");
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
  const partnerId = await getPartner(userId);

  const lang = await getUserLang(userId);

  if (!partnerId) {
    const msg =
      lang === "en"
        ? "ℹ️ You are not currently in a chat, so there is no one to report."
        : "ℹ️ Kamu tidak sedang dalam obrolan, tidak ada yang bisa dilaporkan.";
    await ctx.reply(msg);
    return;
  }

  const total = await addReport(partnerId, userId, 24);

  const msgUser =
    lang === "en"
      ? "✅ Your report has been recorded. Thank you for helping keep the community safe."
      : "✅ Laporanmu sudah direkam. Terima kasih sudah membantu menjaga komunitas.";

  await ctx.reply(msgUser);

  if (total >= AUTO_BAN_REPORTS) {
    await banUser(partnerId, "Auto-ban by reports");
    try {
      await bot.api.sendMessage(
        partnerId,
        "❌ Akunmu diblokir karena terlalu banyak laporan dari pengguna lain."
      );
    } catch (_) {}
    await clearPair(userId);
  }

  // Log ke grup report jika dikonfigurasi
  if (REPORT_LOG_CHAT_ID) {
    const reportTextId = [
      "🛑 *Laporan Pengguna*",
      "",
      `Pelapor: \`${userId}\``,
      `Dilaporkan: \`${partnerId}\``,
      `Total laporan 24 jam terakhir: ${total}`,
    ].join("\n");
    const reportTextEn = [
      "🛑 *User Report*",
      "",
      `Reporter: \`${userId}\``,
      `Reported user: \`${partnerId}\``,
      `Total reports in last 24h: ${total}`,
    ].join("\n");
    const adminLang = await getUserLang(userId);
    try {
      await bot.api.sendMessage(
        REPORT_LOG_CHAT_ID,
        adminLang === "en" ? reportTextEn : reportTextId,
        {
          parse_mode: "Markdown",
          message_thread_id:
            REPORT_LOG_TOPIC_ID && REPORT_LOG_TOPIC_ID > 0
              ? REPORT_LOG_TOPIC_ID
              : undefined,
        }
      );
    } catch (err) {
      console.error("Gagal kirim log report:", err.message);
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
      ? "Choose language: /lang id atau /lang en"
      : "Pilih bahasa: /lang id atau /lang en";
  await ctx.reply(text);
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
    if (lang === "en") {
      const text = premium
        ? "💎 You are currently a *premium* user.\n\nPayment methods are currently unavailable."
        : "💎 You are currently *not* premium.\n\nPayment methods are currently unavailable.";
      await ctx.reply(text, { parse_mode: "Markdown" });
    } else {
      const text = premium
        ? "💎 Kamu saat ini adalah pengguna *premium*.\n\nSaat ini tidak ada metode pembayaran yang tersedia."
        : "💎 Kamu saat ini *belum* premium.\n\nSaat ini tidak ada metode pembayaran yang tersedia.";
      await ctx.reply(text, { parse_mode: "Markdown" });
    }
    return;
  }

  let text;
  if (lang === "en") {
    text = premium
      ? "💎 You are currently a *premium* user.\n\nChoose a payment method below to extend your premium:"
      : "💎 You are currently *not* premium.\n\nChoose a payment method below to activate premium:";
  } else {
    text = premium
      ? "💎 Kamu saat ini adalah pengguna *premium*.\n\nPilih metode pembayaran di bawah untuk memperpanjang premium:"
      : "💎 Kamu saat ini *belum* premium.\n\nPilih metode pembayaran di bawah untuk mengaktifkan premium:";
  }

  const keyboard = new InlineKeyboard();
  if (manualEnabled) {
    keyboard.text(
      lang === "en" ? "📱 Manual transfer" : "📱 Transfer manual",
      "pay_manual"
    );
  }
  if (trakteerEnabled) {
    if (manualEnabled) keyboard.row();
    keyboard.text(
      lang === "en" ? "💳 Trakteer" : "💳 Trakteer",
      "pay_trakteer"
    );
  }

  await ctx.reply(text, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
}

async function main() {
  await initDb();
  console.log("✅ Koneksi Supabase siap digunakan");

  bot.command("start", async (ctx) => {
    const name = ctx.from.first_name || "kamu";
    const lang = await getUserLang(ctx.from.id);

    const textId = [
      `👋 Hai, ${name}!`,
      "",
      "Selamat datang di *ShadowChat* (NodeJS + Supabase).",
      "",
      "Perintah utama:",
      "• /search — cari pasangan ngobrol anonim",
      "• /stop — hentikan obrolan yang sedang berjalan",
      "• /next — ganti ke pasangan berikutnya",
      "• /report — laporkan pasangan yang melanggar",
      "• /lang — ganti bahasa (id/en)",
      "• /showid — kirim link profilmu ke pasangan",
      "",
      "Coba kirim /search untuk mulai.",
    ].join("\n");

    const textEn = [
      `👋 Hey, ${name}!`,
      "",
      "Welcome to *ShadowChat* (NodeJS + Supabase).",
      "",
      "Main commands:",
      "• /search — find a random chat partner",
      "• /stop — end current chat",
      "• /next — find the next partner",
      "• /report — report your current partner",
      "• /lang — change language (id/en)",
      "• /showid — share your profile link with partner",
      "",
      "Type /search to start.",
    ].join("\n");

    await ctx.reply(lang === "en" ? textEn : textId, {
      parse_mode: "Markdown",
    });
  });

  bot.command("search", async (ctx) => {
    await startSearch(ctx);
    // Setiap kali mulai chat baru (saat nanti dipasangkan), kita akan
    // increment di dalam setPair. Di versi sederhana ini, kita bisa
    // increment saat user memulai pencarian.
    await incrementChatCount(ctx.from.id);
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

  bot.command("lang", async (ctx) => {
    await handleLang(ctx);
  });

  bot.command("showid", async (ctx) => {
    await handleShowId(ctx);
  });

  bot.command("premium", async (ctx) => {
    await handlePremium(ctx);
  });

  // Callback pembayaran manual/Trakteer
  bot.callbackQuery("pay_manual", async (ctx) => {
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

    await setPaymentSession(userId, "manual");

    const textEn =
      "📱 *Manual payment (DANA/OVO/GoPay)*\n\n" +
      "Please send your transfer *screenshot* in this chat now, and the admin will review it.\n" +
      "While you are in this payment session, your messages will not be forwarded to any chat partner.\n\n" +
      "If automatic checking fails, you can still use /paymanual to request a manual review.";
    const textId =
      "📱 *Pembayaran manual (DANA/OVO/GoPay)*\n\n" +
      "Silakan kirim *screenshot bukti transfer* di chat ini sekarang, nanti admin akan meninjaunya.\n" +
      "Selama kamu berada dalam sesi pembayaran ini, pesanmu tidak akan diteruskan ke pasangan chat.\n\n" +
      "Jika pengecekan otomatis gagal, kamu tetap bisa gunakan /paymanual untuk meminta review manual dari admin.";

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(lang === "en" ? textEn : textId, {
      parse_mode: "Markdown",
    });
  });

  bot.callbackQuery("pay_trakteer", async (ctx) => {
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

    const textEn =
      "💳 *Payment via Trakteer*\n\n" +
      "Tap the button below to open the Trakteer page.\n" +
      "Please mention your Telegram ID or username in the message so the admin can verify it.\n\n" +
      "If automatic recognition is not implemented yet, the admin will manually extend your premium after checking.";
    const textId =
      "💳 *Pembayaran via Trakteer*\n\n" +
      "Tap tombol di bawah untuk membuka halaman Trakteer.\n" +
      "Mohon tulis ID atau username Telegram kamu di pesan dukungan agar admin mudah memverifikasi.\n\n" +
      "Jika pengecekan otomatis belum tersedia, admin akan menambah premium kamu secara manual setelah dicek.";

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

  bot.command("stats", async (ctx) => {
    const userId = ctx.from.id;
    const lang = await getUserLang(userId);
    const premium = await isPremium(userId);
    const stats = await getUserStats(userId);

    const linesId = [
      "📊 Statistik kamu:",
      `• Total obrolan (search): ${stats.total_chats || 0}`,
      premium ? "• Status: Premium ✅" : "• Status: Gratis",
      stats.last_active
        ? `• Terakhir aktif: ${new Date(stats.last_active).toLocaleString("id-ID")}`
        : "• Terakhir aktif: -",
    ];

    const linesEn = [
      "📊 Your stats:",
      `• Total chats (search): ${stats.total_chats || 0}`,
      premium ? "• Status: Premium ✅" : "• Status: Free",
      stats.last_active
        ? `• Last active: ${new Date(stats.last_active).toLocaleString("en-US")}`
        : "• Last active: -",
    ];

    await ctx.reply(lang === "en" ? linesEn.join("\n") : linesId.join("\n"));
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
        ? `✅ Premium for user ${userId} extended by ${days} day(s).`
        : `✅ Premium untuk user ${userId} ditambah ${days} hari.`;
    await ctx.reply(msgAdmin);

    try {
      const userLang = await getUserLang(userId);
      const msgUser =
        userLang === "en"
          ? `🎉 Your premium has been extended by ${days} day(s) by admin.`
          : `🎉 Premium kamu ditambah ${days} hari oleh admin.`;
      await bot.api.sendMessage(userId, msgUser);
    } catch (_) {}
  });

  bot.on("message", async (ctx) => {
    if (ctx.message.text && ctx.message.text.startsWith("/")) return;

    const userId = ctx.from.id;

    if (await isBanned(userId)) {
      const lang = await getUserLang(userId);
      const msg =
        lang === "en"
          ? "❌ Your account is blocked."
          : "❌ Akunmu diblokir.";
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

        let days = computePremiumDaysFromAmount(maxAmount);
        let status = "pending";

        // Verifikasi berbeda untuk DANA vs GoPay
        if (days > 0 && within24h) {
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
              await extendPremium(userId, days);
            }
          } else {
            // Default: gunakan verifikasi nomor+nama seperti DANA
            const hasWalletInfo = containsWalletInfo(ocrText);
            if (hasWalletInfo) {
              status = "approved";
              await extendPremium(userId, days);
            }
          }
        }

        await logPayment({
          userId,
          method: "manual",
          amount: maxAmount || 0,
          days: days || 0,
          status,
          wallet: `${walletType} | ${E_WALLET_NAME} ${E_WALLET_NUMBER}`,
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
          const msgText =
            lang === "en"
              ? `✅ Payment detected successfully.\nAmount: Rp ${maxAmount.toLocaleString(
                  "id-ID"
                )}\nPremium extended by ${days} day(s).`
              : `✅ Pembayaran berhasil terdeteksi.\nNominal: Rp ${maxAmount.toLocaleString(
                  "id-ID"
                )}\nPremium kamu ditambah ${days} hari.`;

          await ctx.reply(msgText);
        } else {
          const linesId = [
            "⚠️ Pembayaranmu belum bisa diverifikasi otomatis.",
            "",
            `Nominal OCR: Rp ${
              maxAmount ? maxAmount.toLocaleString("id-ID") : 0
            }`,
            `Kode pembayaran OCR: ${codes.length ? codes.join(", ") : "-"}`,
            `Tanggal transaksi OCR: ${
              txDate ? txDate.toISOString() : "tidak terbaca"
            }`,
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
            `Transaction datetime OCR: ${
              txDate ? txDate.toISOString() : "not detected"
            }`,
            "",
            "The admin will review your payment manually.",
            "If needed, you can still use /paymanual to contact the admin.",
          ];

          await ctx.reply(lang === "en" ? linesEn.join("\n") : linesId.join("\n"));
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

    try {
      if (msg.text) {
        await bot.api.sendMessage(partnerId, msg.text);
      } else if (msg.photo && msg.photo.length > 0) {
        const photo = msg.photo[msg.photo.length - 1];
        const caption = msg.caption || undefined;
        await bot.api.sendPhoto(partnerId, photo.file_id, {
          caption,
        });
      } else if (msg.sticker) {
        await bot.api.sendSticker(partnerId, msg.sticker.file_id);
      } else if (msg.voice) {
        await bot.api.sendVoice(partnerId, msg.voice.file_id);
      } else if (msg.document) {
        await bot.api.sendDocument(partnerId, msg.document.file_id, {
          caption: msg.caption || undefined,
        });
      } else {
        await ctx.reply("Jenis pesan ini belum didukung sepenuhnya.");
      }
    } catch (err) {
      console.error("Gagal forward ke partner:", err.message);
      await ctx.reply(
        "⚠️ Terjadi kesalahan saat mengirim pesan ke pasangan. Mungkin dia sudah offline."
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