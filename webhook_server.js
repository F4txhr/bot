const http = require("http");
const { Bot } = require("grammy");
const crypto = require("crypto");
require("dotenv").config();

const {
  getUserLang,
  extendPremium,
  logPayment,
  findUserByPaymentCode,
  markPaymentCodeUsed,
  getUserDiscount,
  getDiscountInfo,
  markDiscountUsed,
  clearUserDiscount,
} = require("./db");

const BOT_TOKEN = process.env.BOT_TOKEN;
const PAYMENT_LOG_CHAT_ID = Number(process.env.PAYMENT_LOG_CHAT_ID || "0");
const PAYMENT_LOG_TOPIC_ID = Number(process.env.PAYMENT_LOG_TOPIC_ID || "0");
const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT || "8000");
const TRAKTEER_WEBHOOK_SECRET = process.env.TRAKTEER_WEBHOOK_SECRET || "";

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN belum diset di environment / .env");
  process.exit(1);
}

// Bot instance hanya untuk kirim pesan (tidak memanggil bot.start())
const bot = new Bot(BOT_TOKEN);

function verifyTrakteerSignature(rawBody, secret, headers) {
  if (!secret) return true;
  const sig =
    headers["x-trakteer-signature"] ||
    headers["X-Trakteer-Signature"] ||
    "";
  if (!sig) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");

  return sig === expected;
}

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
      const rawBody = body || "";

      const okSig = verifyTrakteerSignature(
        rawBody,
        TRAKTEER_WEBHOOK_SECRET,
        req.headers
      );
      if (!okSig) {
        console.warn("[VPS] Trakteer webhook: invalid signature");
        res.statusCode = 401;
        res.end(
          JSON.stringify({ status: "error", reason: "invalid_signature" })
        );
        return;
      }

      const data = rawBody ? JSON.parse(rawBody) : {};
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

      const baseDays = Math.floor(amount / 1000);
      if (baseDays <= 0) {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            status: "ignored",
            reason: "calculated days <= 0",
          })
        );
        return;
      }

      // Cek diskon aktif untuk user
      let totalDays = baseDays;
      let discountCode = null;
      let bonusDays = 0;
      const activeCode = await getUserDiscount(userId);
      if (activeCode) {
        const info = await getDiscountInfo(activeCode);
        if (info && amount >= (info.min_amount || 0)) {
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
      await markPaymentCodeUsed(code);
      await logPayment({
        userId,
        method: "trakteer",
        amount,
        days: totalDays,
        status: "approved",
        wallet: discountCode
          ? `TRAKTEER (disc ${discountCode} ${bonusDays}d)`
          : "TRAKTEER",
        ocrText: "",
        code,
        txDatetime: null,
      });

      try {
        const lang = await getUserLang(userId);
        const baseLine =
          lang === "en"
            ? `🎉 Thank you for supporting via Trakteer!\nAmount: Rp ${amount.toLocaleString(
                "id-ID"
              )}\nPremium extended by ${totalDays} day(s).`
            : `🎉 Terima kasih sudah mendukung via Trakteer!\nNominal: Rp ${amount.toLocaleString(
                "id-ID"
              )}\nPremium kamu ditambah ${totalDays} hari.`;
        const discLine =
          discountCode && bonusDays > 0
            ? lang === "en"
              ? `\n\nIncluding bonus ${bonusDays} day(s) from discount code \`${discountCode}\`.`
              : `\n\nTermasuk bonus ${bonusDays} hari dari kode diskon \`${discountCode}\`.`
            : "";
        const msg = baseLine + discLine;
        await bot.api.sendMessage(userId, msg, { parse_mode: "Markdown" });
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
          `Hari premium: ${totalDays}`,
          `Kode unik: ${code}`,
        ];
        if (discountCode && bonusDays > 0) {
          logLines.push(
            `Diskon: kode ${discountCode}, bonus ${bonusDays} hari`
          );
        }
        logLines.push(
          "",
          "*Payload:*",
          "```",
          JSON.stringify(data, null, 2).slice(0, 1900),
          "```"
        );
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
          days: totalDays,
        })
      );
    } catch (err) {
      console.error("[VPS] Gagal proses payload webhook Trakteer:", err.message);
      res.statusCode = 400;
      res.end(JSON.stringify({ status: "error", error: err.message }));
    }
  });
});

/**
 * Handler HTTP untuk webhook Trakteer.
 * Endpoint: POST /trakteer/webhook
 */
server.listen(WEBHOOK_PORT, () => {
  console.log(
    "🌐 [VPS] HTTP server webhook Trakteer listen di port",
    WEBHOOK_PORT
  );
});