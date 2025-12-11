const http = require("http");
const { Bot } = require("grammy");
require("dotenv").config();

const {
  getUserLang,
  extendPremium,
  logPayment,
  findUserByPaymentCode,
  markPaymentCodeUsed,
} = require("./db");

const BOT_TOKEN = process.env.BOT_TOKEN;
const PAYMENT_LOG_CHAT_ID = Number(process.env.PAYMENT_LOG_CHAT_ID || "0");
const PAYMENT_LOG_TOPIC_ID = Number(process.env.PAYMENT_LOG_TOPIC_ID || "0");
const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT || "8000");

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN belum diset di environment / .env");
  process.exit(1);
}

// Bot instance hanya untuk kirim pesan (tidak memanggil bot.start())
const bot = new Bot(BOT_TOKEN);

/**
 * Handler HTTP untuk webhook Trakteer.
 * Endpoint: POST /trakteer/webhook
 */
const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/trakteer/webhook") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "text/plain");
    res.end("Method Not Allowed");
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 1e6) {
      // batasi body, hindari flood
      req.destroy();
    }
  });

  req.on("end", async () => {
    res.setHeader("Content-Type", "application/json");

    try {
      const data = body ? JSON.parse(body) : {};
      console.log("📥 [VPS] Trakteer webhook payload diterima:", data);

      const amount = Number(
        data.amount ?? data.nominal ?? data.value ?? data.price ?? 0
      );
      const message =
        (data.message ||
          data.note ||
          data.support_message ||
          data.supporter_message ||
          data.pesan ||
          "") + "";

      const codes =
        message.toUpperCase().match(/PAY-[A-Z0-9]{4,12}/g) || [];
      const code = codes.length ? codes[0] : null;

      if (!code || !Number.isFinite(amount) || amount < 1000) {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            status: "ignored",
            reason: "no valid code or amount < 1000",
          })
        );
        return;
      }

      const userId = await findUserByPaymentCode(code, "trakteer");

      if (!userId) {
        console.warn(
          "[VPS] Trakteer webhook: kode tidak dikenal atau sudah dipakai:",
          code
        );
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            status: "ignored",
            reason: "unknown or used code",
          })
        );
        return;
      }

      const days = Math.floor(amount / 1000);
      if (days <= 0) {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            status: "ignored",
            reason: "calculated days <= 0",
          })
        );
        return;
      }

      await extendPremium(userId, days);
      await markPaymentCodeUsed(code);
      await logPayment({
        userId,
        method: "trakteer",
        amount,
        days,
        status: "approved",
        wallet: "TRAKTEER",
        ocrText: "",
        code,
        txDatetime: null,
      });

      try {
        const lang = await getUserLang(userId);
        const msg =
          lang === "en"
            ? `🎉 Thank you for supporting via Trakteer!\nAmount: Rp ${amount.toLocaleString(
                "id-ID"
              )}\nPremium extended by ${days} day(s).`
            : `🎉 Terima kasih sudah mendukung via Trakteer!\nNominal: Rp ${amount.toLocaleString(
                "id-ID"
              )}\nPremium kamu ditambah ${days} hari.`;
        await bot.api.sendMessage(userId, msg);
      } catch (err) {
        console.error(
          "[VPS] Gagal kirim notifikasi ke user dari webhook Trakteer:",
          err.message
        );
      }

      if (PAYMENT_LOG_CHAT_ID) {
        const logLines = [
          "💳 *Pembayaran Trakteer*",
          "",
          `User ID: \`${userId}\``,
          `Status: APPROVED`,
          `Nominal: Rp ${amount.toLocaleString("id-ID")}`,
          `Hari premium: ${days}`,
          `Kode unik: ${code}`,
          "",
          "*Payload:*",
          "```",
          JSON.stringify(data, null, 2).slice(0, 1900),
          "```",
        ];
        const logText = logLines.join("\n");
        try {
          await bot.api.sendMessage(PAYMENT_LOG_CHAT_ID, logText, {
            parse_mode: "Markdown",
            message_thread_id:
              PAYMENT_LOG_TOPIC_ID && PAYMENT_LOG_TOPIC_ID > 0
                ? PAYMENT_LOG_TOPIC_ID
                : undefined,
          });
        } catch (err) {
          console.error(
            "[VPS] Gagal kirim log pembayaran Trakteer:",
            err.message
          );
        }
      }

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          status: "ok",
          user_id: userId,
          days,
        })
      );
    } catch (err) {
      console.error("[VPS] Gagal proses payload webhook Trakteer:", err.message);
      res.statusCode = 400;
      res.end(JSON.stringify({ status: "error", error: err.message }));
    }
  });
});

server.listen(WEBHOOK_PORT, () => {
  console.log(
    "🌐 [VPS] HTTP server webhook Trakteer listen di port",
    WEBHOOK_PORT
  );
});