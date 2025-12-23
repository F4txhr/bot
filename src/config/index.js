require('dotenv').config();

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_ANON_KEY,
  TRAKTEER_SECRET: process.env.TRAKTEER_WEBHOOK_SECRET,
  WEBHOOK_PORT: process.env.WEBHOOK_PORT || 3000,
  ADMIN_USER_IDS: process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim())) : [],
  MAX_BAN_DURATION: process.env.MAX_BAN_DURATION || 7, // days
  OCR_ENABLED: process.env.OCR_ENABLED === 'true',
};