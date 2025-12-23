require('dotenv').config();
const { runBot } = require('./src/bot');

console.log('Supabase client siap digunakan');

// Jalankan bot
runBot();