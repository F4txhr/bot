const { Bot } = require("grammy");
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
} = require("./db");

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN belum diset di environment / .env");
  process.exit(1);
}

const AUTO_BAN_REPORTS = 3;

const bot = new Bot(BOT_TOKEN);

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

  if (lang === "en") {
    const text = premium
      ? "💎 You are currently a *premium* user.\n(Feature details can be added here later.)"
      : "💎 Premium user feature (placeholder).\nYou are currently *not* premium.\n(Activation/payment logic can be added later.)";
    await ctx.reply(text, { parse_mode: "Markdown" });
  } else {
    const text = premium
      ? "💎 Kamu saat ini adalah pengguna *premium*.\n(Detail fitur bisa ditambahkan nanti.)"
      : "💎 Fitur pengguna premium (placeholder).\nSaat ini kamu *belum* premium.\n(Logika aktivasi/pembayaran bisa ditambahkan nanti.)";
    await ctx.reply(text, { parse_mode: "Markdown" });
  }
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