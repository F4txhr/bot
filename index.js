const { Bot } = require("grammy");
const { createClient } = require("redis");
require("dotenv").config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const REDIS_URL = process.env.REDIS_URL;

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN belum diset di environment / .env");
  process.exit(1);
}
if (!REDIS_URL) {
  console.error("REDIS_URL belum diset di environment / .env");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

const redis = createClient({
  url: REDIS_URL,
});
redis.on("error", (err) => console.error("Redis error:", err));

async function getPartner(userId) {
  return await redis.get(`partner:${userId}`);
}

async function setPair(userA, userB) {
  await redis.set(`partner:${userA}`, String(userB));
  await redis.set(`partner:${userB}`, String(userA));
}

async function clearPair(userId) {
  const partnerId = await getPartner(userId);
  if (!partnerId) return null;
  await redis.del(`partner:${userId}`, `partner:${partnerId}`);
  return Number(partnerId);
}

async function removeFromQueue(userId) {
  await redis.lRem("queue:free", 0, String(userId));
}

async function startSearch(ctx) {
  const userId = ctx.from.id;

  const hasPartner = await getPartner(userId);
  if (hasPartner) {
    await ctx.reply("ℹ️ Kamu sudah dalam obrolan. Gunakan /stop untuk keluar.");
    return;
  }

  await removeFromQueue(userId);

  const otherIdStr = await redis.lPop("queue:free");

  if (otherIdStr && otherIdStr !== String(userId)) {
    const otherId = Number(otherIdStr);

    await setPair(userId, otherId);

    await ctx.reply("✅ Ditemukan pasangan! Mulai ngobrol sekarang.");
    await bot.api.sendMessage(
      otherId,
      "✅ Ditemukan pasangan! Mulai ngobrol sekarang."
    );
  } else {
    if (!otherIdStr) {
      await redis.rPush("queue:free", String(userId));
    }
    await ctx.reply("🔍 Kamu masuk antrian, menunggu pasangan...");
  }
}

async function stopChat(ctx) {
  const userId = ctx.from.id;

  await removeFromQueue(userId);

  const partnerIdStr = await getPartner(userId);
  if (!partnerIdStr) {
    await ctx.reply("ℹ️ Kamu tidak sedang dalam obrolan.");
    return;
  }

  const partnerId = Number(partnerIdStr);
  await clearPair(userId);

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
  await redis.connect();
  console.log("✅ Terhubung ke Redis");

  bot.command("start", async (ctx) => {
    const name = ctx.from.first_name || "kamu";
    const text = [
      `👋 Hai, ${name}!`,
      "",
      "Selamat datang di *ShadowChat* (versi NodeJS).",
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
    const partnerIdStr = await getPartner(userId);

    if (!partnerIdStr) {
      await ctx.reply("Kamu belum punya pasangan. Gunakan /search untuk mencari.");
      return;
    }

    const partnerId = Number(partnerIdStr);
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
  console.log("🤖 Bot Telegram berjalan (NodeJS + grammY)");
}

main().catch((err) => {
  console.error("Gagal start bot:", err);
  process.exit(1);
});