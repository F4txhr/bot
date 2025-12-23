const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { isPremium, setPremium } = require('../database');
const { createLogger } = require('../utils');

// Inisialisasi logger
const logger = createLogger('Webhook');

// Validasi signature Trakteer
function validateTrakteerSignature(payload, signature, secret) {
  const expectedSignature = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')}`;
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// Fungsi untuk memproses webhook Trakteer
async function processTrakteerWebhook(req, res) {
  try {
    const signature = req.headers['x-trakteer-signature'];
    const payload = JSON.stringify(req.body);
    
    // Validasi signature
    if (!validateTrakteerSignature(payload, signature, config.TRAKTEER_SECRET)) {
      logger.warn('Invalid webhook signature', { ip: req.ip });
      return res.status(401).send('Unauthorized');
    }

    const { 
      payment_status, 
      payment_method, 
      sender_name, 
      amount, 
      note, 
      created_at,
      custom_field
    } = req.body;

    // Log webhook event
    logger.info('Received webhook', {
      payment_status,
      payment_method,
      sender_name,
      amount,
      note,
      created_at,
      custom_field
    });

    // Proses pembayaran jika berhasil
    if (payment_status === 'PAID' || payment_status === 'SUCCESS') {
      // Cek apakah ada custom_field (berisi user_id)
      if (custom_field) {
        const userId = parseInt(custom_field);
        if (!isNaN(userId) && userId > 0) {
          // Berikan status premium (misalnya 30 hari untuk pembayaran Rp 10.000)
          const days = Math.floor(amount / 10000) * 30 || 30; // 30 hari per 10k
          
          const success = await setPremium(userId, days);
          if (success) {
            logger.info('Premium status granted', { userId, days });
            
            // Kirim notifikasi ke user (jika memungkinkan)
            // Catatan: Kita tidak bisa langsung mengirimi user karena tidak ada bot instance di webhook
            // Tapi kita bisa mencatat bahwa user harus diberi notifikasi saat aktif
            
            return res.status(200).send('Premium status granted');
          } else {
            logger.error('Failed to grant premium status', { userId });
            return res.status(500).send('Failed to process premium');
          }
        } else {
          logger.warn('Invalid user ID in custom_field', { custom_field });
        }
      } else {
        logger.warn('No custom_field found in webhook', { body: req.body });
      }
    }

    // Balas dengan sukses untuk semua webhook yang valid
    return res.status(200).send('Webhook processed');
  } catch (error) {
    logger.error('Error processing webhook', {
      message: error.message,
      stack: error.stack,
      body: req.body
    });
    return res.status(500).send('Internal server error');
  }
}

// Fungsi untuk menjalankan server webhook
function runWebhookServer() {
  const app = express();
  
  // Middleware untuk parsing JSON
  app.use(express.json({ verify: (req, res, buf) => {
    req.rawBody = buf;
  }}));
  
  // Endpoint webhook
  app.post('/webhook/trakteer', processTrakteerWebhook);
  
  // Endpoint untuk cek status server
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
  });
  
  const port = config.WEBHOOK_PORT;
  
  app.listen(port, () => {
    logger.info(`Webhook server berjalan di port ${port}`);
  });
  
  return app;
}

module.exports = { runWebhookServer, processTrakteerWebhook };