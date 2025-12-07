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
} = require("./db");

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN belum diset di environment / .env");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

async function startSearch(ctx) {
  const userId = ctx.from.id;

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

async function main() {
  await initDb();
  console.log("✅ Database siap digunakan");

  bot.command("start", async (ctx) => {
    const name = ctx.from.first_name || "kamu";
    const text = [
      `👋 Hai, ${name}!`,
      "",
      "Selamat datang di *ShadowChat* (versi NodeJS, DB).",
      "",
      "Perintah utama:",
      "• /search — cari pasangan ngobrol anonim",
      "• /stop — hentikan obrolan yang sedang berjalan",
      "• /next — ganti ke pasangan berikutnya",
      "",
      "Coba kirim /search untuk mulai.",
    ].join("\n");

    await ctx.reply(text, { parse_mode: "Markdown" });
  });

  bot.command("search", async (ctx) => {
    await startSearch(ctx);
  });

  bot.command("stop", async (ctx) => {
    await stopChat(ctx);
  });

  bot.command("next", async (ctx) => {
    await stopChat(ctx);
    await startSearch(ctx);
  });

  bot.on("message", async (ctx) => {
    if (ctx.message.text && ctx.message.text.startsWith("/")) return;

    const userId = ctx.from.id;
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
  console.log("🤖 Bot Telegram berjalan (NodeJS + grammY + MySQL)");
}

main().catch((err) => {
  console.error("Gagal start bot:", err);
  process.exit(1);
});