const { Bot, InlineKeyboard } = require("grammy");
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
} = require("./db");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean)
  .map((x) => Number(x))
  .filter((x) => !Number.isNaN(x));
const TRAKTEER_URL = process.env.TRAKTEER_URL || "";

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN belum diset di environment / .env");
  process.exit(1);
}

const AUTO_BAN_REPORTS = 3;

const bot = new Bot(BOT_TOKEN);

function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
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

    const textEn =
      "📱 *Manual payment (DANA/OVO/GoPay)*\n\n" +
      "Please send your transfer *screenshot* in this chat, and the admin will review it.\n" +
      "If automatic checking fails, you can still use /paymanual to request a manual review.";
    const textId =
      "📱 *Pembayaran manual (DANA/OVO/GoPay)*\n\n" +
      "Silakan kirim *screenshot bukti transfer* di chat ini, nanti admin akan meninjaunya.\n" +
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