const { Bot, session } = require('grammy');
const config = require('../config');
const { 
  handleStart,
  handleFind,
  handleLeave,
  handleDisconnect,
  handleHelp,
  handleLang,
  handleReport,
  handleBroadcast,
  handleGiftPremium,
  handlePremium,
  handleSearchGender,
  handleSetGender,
  handleDiscount,
  handleNext
} = require('./commands');
const {
  handleCallbackQuery,
  handleMessage,
  handleUnknownCommand
} = require('./handlers');
const { initDb } = require('../database');

// Inisialisasi bot
const bot = new Bot(config.BOT_TOKEN);

// Middleware untuk sesi (jika diperlukan)
bot.use(session({
  initial: () => ({
    // Data sesi awal jika diperlukan
  })
}));

// Perintah-perintah bot
bot.command('start', handleStart);
bot.command('find', handleFind);
bot.command('leave', handleLeave);
bot.command('disconnect', handleDisconnect);
bot.command('help', handleHelp);
bot.command('lang', handleLang);
bot.command('report', handleReport);
bot.command('broadcast', handleBroadcast); // Perintah admin
bot.command('giftpremium', handleGiftPremium); // Perintah admin
bot.command('premium', handlePremium);
bot.command('search_gender', handleSearchGender); // Perintah premium
bot.command('setgender', handleSetGender); // Perintah premium
bot.command('discount', handleDiscount);
bot.command('next', handleNext);

// Handler untuk callback query (inline keyboard)
bot.callbackQuery(/.*/, handleCallbackQuery);

// Handler untuk pesan teks
bot.on('message:text', handleMessage);

// Handler untuk pesan selain teks (gambar, dokumen, dll)
bot.on(':photo', handleMessage);
bot.on(':document', handleMessage);
bot.on(':video', handleMessage);

// Handler untuk perintah yang tidak dikenal
bot.on('message', handleUnknownCommand);

// Fungsi untuk menjalankan bot
async function runBot() {
  try {
    // Inisialisasi database
    const dbReady = await initDb();
    if (!dbReady) {
      console.error('❌ Gagal menginisialisasi database. Bot tidak akan berjalan.');
      return;
    }

    console.log('🤖 Bot Telegram berjalan (NodeJS + grammY + Supabase)');
    await bot.start({
      drop_pending_updates: true,
      allowed_updates: ['message', 'callback_query']
    });
  } catch (error) {
    console.error('❌ Terjadi kesalahan saat menjalankan bot:', error.message);
  }
}

module.exports = { bot, runBot };