const { InlineKeyboard } = require('grammy');
const { 
  getPartner, 
  setPair, 
  clearPair, 
  removeFromQueue, 
  pushToQueue, 
  popFromQueueExcept, 
  isBanned, 
  getUserLang, 
  setUserLang, 
  isPremium,
  setPremium,
  removePremium,
  banUser,
  unbanUser,
  addReport,
  getUserSearchGender,
  setUserSearchGender,
  getUserGender,
  setUserGender
} = require('../../database');
const { 
  validateUserId, 
  validateText,
  getTrustLevel,
  addReport: addReportUtil,
  addRating,
  isSearchCooldown,
  createDiscountCode,
  getDiscountInfo,
  assignDiscountToUser,
  getUserDiscount,
  clearUserDiscount,
  markDiscountUsed,
  clearDiscountCode,
  normalizeDiscountCode,
  SEARCH_COOLDOWN,
  AUTO_BAN_REPORTS
} = require('../../utils');
const { addMediaReport } = require('../../admin/media-reports');
const { createMediaHash } = require('../../utils/media-hash');
const config = require('../../config');

// Pesan dalam bahasa Indonesia dan Inggris
const messages = {
  id: {
    start: ` halo! 👋\n\nObrolan anonim tanpa batas. Temukan teman baru dari berbagai penjuru hanya dengan satu sentuhan.\n\nFitur Unggulan:\n• Cari pasangan acak\n• Premium: Cari berdasarkan gender\n• Pilihan bahasa (ID/EN)\n• Laporan & moderasi aman\n\nKetik /find untuk mulai mencari pasangan!`,
    find: `Mencari pasangan... 🔄\nKami sedang mencarikan seseorang untukmu\n\nHarap tunggu sebentar ya! Kami sedang mencocokkan kamu dengan pengguna lain yang sedang online.`,
    found: `Ditemukan! 🎉\nKamu sekarang terhubung dengan seseorang\n\nTips:\n• Kirim pesan apa pun untuk memulai obrolan\n• Gunakan /next jika ingin ganti pasangan\n• Gunakan /stop jika ingin keluar`,
    not_found: `Belum ada pasangan saat ini 🕐\n\nJangan khawatir! Coba lagi nanti atau ajak temanmu untuk bergabung di ShadowChat agar lebih seru.`,
    disconnected: `Pasangan kamu telah pergi 😔\nMereka telah meninggalkan obrolan\n\nJangan khawatir! Kamu bisa mencari pasangan baru:\n• /find - Cari pasangan acak\n• /search_gender - Cari berdasarkan gender (premium)`,
    leave: `Mengakhiri obrolan 🚪\nKamu telah meninggalkan obrolan saat ini\n\nTerima kasih telah berinteraksi! Kamu bisa mencari pasangan baru dengan:\n\n/find - Cari acak\n/search_gender - Cari berdasarkan gender (premium)`,
    chat_with: `Obrolan sedang berlangsung 💬\nPasangan: [Status Anonim]\n\nTips: Gunakan /next jika ingin ganti pasangan`,
    banned: `Akun kamu telah diblokir ❌\n\nKamu tidak dapat menggunakan bot ini. Hubungi admin jika kamu pikir ini adalah kesalahan.`,
    already_searching: `Kamu sedang dalam antrean pencarian 🔄\n\nTunggu sebentar, kami sedang mencarikan pasangan untukmu.`,
    admin_broadcast_start: `Siapkan pesan siaran 📢\n\nSilakan kirim pesan yang ingin kamu siarkan ke semua pengguna aktif.`,
    admin_broadcast_success: `Siaran berhasil dikirim ke semua pengguna ✅`,
    admin_broadcast_failed: `Gagal mengirim siaran ❌`,
    admin_giftpremium_start: `Format pemberian premium 🎁\nuser_id jumlah_hari\n\nContoh: 123456789 30\n\nSilakan kirim user_id dan durasi premium (dalam hari):`,
    admin_giftpremium_success: `Status premium berhasil diberikan ✅`,
    admin_giftpremium_failed: `Gagal memberikan status premium ❌`,
    invalid_command: `Perintah tidak dikenal ❓\n\nGunakan /help untuk melihat daftar perintah yang tersedia.`,
    help: `ShadowChat - Bantuan 📚\n\nCari Pasangan\n• /find - Acak\n• /search_gender - Berdasarkan gender (premium)\n\nPremium Features\n• /premium - Upgrade\n• /discount - Kode diskon\n• /setgender - Atur gender\n\nProfil & Pengaturan\n• /lang - Ganti bahasa\n• /report - Laporkan pengguna\n\nTips: Gunakan /next untuk ganti pasangan tanpa keluar!`,
    report_success: `Laporan telah dikirim ke admin ✅\n\nTerima kasih telah membantu menjaga komunitas ShadowChat tetap aman.`,
    report_failed: `Gagal mengirim laporan ❌\n\nSilakan coba lagi nanti.`,
    lang_menu: `Pilih Bahasa 🌐\n\nIndonesia / English`,
    lang_selected: `Bahasa telah diubah ✅`,
    premium_status: (expiresAt) => expiresAt 
      ? `Status Premium: AKTIF 💎\nBerakhir: ${new Date(expiresAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}\nFitur: Search by Gender` 
      : `Status Premium: Tidak Aktif 💎\n\nUpgrade ke premium untuk akses fitur eksklusif seperti pencarian berdasarkan gender.`,
    error: 'Terjadi kesalahan ❌\n\nSilakan coba lagi nanti.'
  },
  en: {
    start: ` welcome! 👋\n\nAnonymous chat without limits. Find new friends from around the world with just one tap.\n\nKey Features:\n• Random partner matching\n• Premium: Gender-based search\n• Language options (ID/EN)\n• Safe reporting & moderation\n\nType /find to start searching for a partner!`,
    find: `Finding a partner... 🔄\nWe're searching for someone for you\n\nPlease wait a moment! We're matching you with another online user.`,
    found: `Found! 🎉\nYou're now connected with someone\n\nTips:\n• Send any message to start chatting\n• Use /next to switch partners\n• Use /stop to leave`,
    not_found: `No partners available right now 🕐\n\nDon't worry! Try again later or invite friends to join ShadowChat for more fun.`,
    disconnected: `Your partner has left 😔\nThey've ended the chat\n\nDon't worry! You can find a new partner:\n• /find - Random search\n• /search_gender - Gender-based search (premium)`,
    leave: `Ending chat 🚪\nYou've left the current chat\n\nThank you for interacting! You can find a new partner with:\n\n/find - Random search\n/search_gender - Gender-based search (premium)`,
    chat_with: `Chat in progress 💬\nPartner: [Anonymous Status]\n\nTip: Use /next to switch partners`,
    banned: `Your account has been banned ❌\n\nYou cannot use this bot. Contact admin if you think this is an error.`,
    already_searching: `You're in the search queue 🔄\n\nPlease wait, we're finding a partner for you.`,
    admin_broadcast_start: `Prepare broadcast message 📢\n\nPlease send the message you want to broadcast to all active users.`,
    admin_broadcast_success: `Broadcast successfully sent to all users ✅`,
    admin_broadcast_failed: `Failed to send broadcast ❌`,
    admin_giftpremium_start: `Premium gift format 🎁\nuser_id days_count\n\nExample: 123456789 30\n\nPlease send user_id and premium duration (in days):`,
    admin_giftpremium_success: `Premium status successfully granted ✅`,
    admin_giftpremium_failed: `Failed to grant premium status ❌`,
    invalid_command: `Unknown command ❓\n\nUse /help to see available commands.`,
    help: `ShadowChat - Help 📚\n\nFind Partners\n• /find - Random\n• /search_gender - Gender-based (premium)\n\nPremium Features\n• /premium - Upgrade\n• /discount - Discount codes\n• /setgender - Set your gender\n\nProfile & Settings\n• /lang - Change language\n• /report - Report user\n\nTip: Use /next to switch partners without leaving!`,
    report_success: `Report has been sent to admin ✅\n\nThank you for helping keep the ShadowChat community safe.`,
    report_failed: `Failed to send report ❌\n\nPlease try again later.`,
    lang_menu: `Choose Language 🌐\n\nIndonesia / English`,
    lang_selected: `Language has been changed ✅`,
    premium_status: (expiresAt) => expiresAt 
      ? `Premium Status: ACTIVE 💎\nExpires: ${new Date(expiresAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}\nFeatures: Gender-based search` 
      : `Premium Status: Inactive 💎\n\nUpgrade to premium for exclusive features like gender-based search.`,
    error: 'An error occurred ❌\n\nPlease try again later.'
  }
};

// Keyboard untuk tindakan
const actionKeyboard = new InlineKeyboard()
  .text('🔄 Cari Lagi', 'find')
  .text('📤 Keluar', 'leave');

// Fungsi untuk mendapatkan pesan berdasarkan bahasa user
async function getMessage(userId, key, ...params) {
  const userLang = await getUserLang(userId) || 'id';
  const langMessages = messages[userLang] || messages.id;
  
  if (typeof langMessages[key] === 'function') {
    return langMessages[key](...params);
  }
  return langMessages[key] || messages.id[key] || key;
}

// Handler untuk perintah /start
async function handleStart(ctx) {
  try {
    const userId = ctx.from?.id;
    if (!validateUserId(userId)) {
      return;
    }

    // Cek apakah user dibanned
    if (await isBanned(userId)) {
      await ctx.reply(await getMessage(userId, 'banned'));
      return;
    }

    await ctx.reply(await getMessage(userId, 'start'), {
      reply_markup: actionKeyboard
    });
  } catch (error) {
    console.error('Error in handleStart:', error);
  }
}

// Handler untuk perintah /find
async function handleFind(ctx) {
  try {
    const userId = ctx.from?.id;
    if (!validateUserId(userId)) {
      return;
    }

    // Cek apakah user dibanned
    if (await isBanned(userId)) {
      await ctx.reply(await getMessage(userId, 'banned'));
      return;
    }

    // Cek apakah user sudah punya pasangan
    const existingPartner = await getPartner(userId);
    if (existingPartner) {
      await ctx.reply(await getMessage(userId, 'chat_with'), {
        reply_markup: actionKeyboard
      });
      return;
    }

    // Cek apakah user sudah dalam antrean
    // Di sini kita bisa menambahkan logika untuk memeriksa antrean jika diperlukan

    // Tambahkan user ke antrean
    const addedToQueue = await pushToQueue(userId);
    if (!addedToQueue) {
      await ctx.reply(await getMessage(userId, 'find'));
      return;
    }

    await ctx.reply(await getMessage(userId, 'find'));

    // Coba cocokkan dengan pasangan
    setTimeout(async () => {
      try {
        // Ambil preferensi gender pengguna
        const genderPref = await getUserSearchGender(userId);
        let partnerId;
        
        if (genderPref) {
          // Jika ada preferensi gender, kita perlu logika pencocokan berdasarkan gender
          // Untuk sementara, gunakan fungsi popFromQueueExcept biasa
          // Dalam implementasi penuh, kita akan membutuhkan queue terpisah berdasarkan gender
          partnerId = await popFromQueueExcept(userId, false);
        } else {
          partnerId = await popFromQueueExcept(userId, false);
        }

        if (partnerId) {
          await setPair(userId, partnerId);
          await ctx.api.sendMessage(userId, await getMessage(userId, 'found'), {
            reply_markup: actionKeyboard
          });
          await ctx.api.sendMessage(partnerId, await getMessage(partnerId, 'found'), {
            reply_markup: actionKeyboard
          });
        } else {
          // Jika tidak menemukan pasangan, biarkan di antrean
          await ctx.api.sendMessage(userId, await getMessage(userId, 'not_found'));
        }
      } catch (error) {
        console.error('Error in matching timeout:', error);
      }
    }, 2000); // Tunggu 2 detik sebelum mencoba mencocokkan
  } catch (error) {
    console.error('Error in handleFind:', error);
  }
}

// Handler untuk perintah /leave
async function handleLeave(ctx) {
  try {
    const userId = ctx.from?.id;
    if (!validateUserId(userId)) {
      return;
    }

    // Cek apakah user dibanned
    if (await isBanned(userId)) {
      await ctx.reply(await getMessage(userId, 'banned'));
      return;
    }

    // Hapus pasangan jika ada
    const partnerId = await getPartner(userId);
    if (partnerId) {
      await clearPair(userId);
      await ctx.api.sendMessage(partnerId, await getMessage(partnerId, 'disconnected'), {
        reply_markup: actionKeyboard
      });
    }

    // Hapus dari antrean jika ada
    await removeFromQueue(userId);

    await ctx.reply(await getMessage(userId, 'leave'), {
      reply_markup: actionKeyboard
    });
  } catch (error) {
    console.error('Error in handleLeave:', error);
  }
}

// Handler untuk perintah /disconnect
async function handleDisconnect(ctx) {
  try {
    const userId = ctx.from?.id;
    if (!validateUserId(userId)) {
      return;
    }

    // Cek apakah user dibanned
    if (await isBanned(userId)) {
      await ctx.reply(await getMessage(userId, 'banned'));
      return;
    }

    // Hapus pasangan jika ada
    const partnerId = await getPartner(userId);
    if (partnerId) {
      await clearPair(userId);
      await ctx.api.sendMessage(partnerId, await getMessage(partnerId, 'disconnected'), {
        reply_markup: actionKeyboard
      });
      await ctx.reply(await getMessage(userId, 'disconnected'), {
        reply_markup: actionKeyboard
      });
    } else {
      await ctx.reply(await getMessage(userId, 'not_found'));
    }
  } catch (error) {
    console.error('Error in handleDisconnect:', error);
  }
}

// Handler untuk perintah /help
async function handleHelp(ctx) {
  try {
    const userId = ctx.from?.id;
    if (!validateUserId(userId)) {
      return;
    }

    // Cek apakah user dibanned
    if (await isBanned(userId)) {
      await ctx.reply(await getMessage(userId, 'banned'));
      return;
    }

    await ctx.reply(await getMessage(userId, 'help'));
  } catch (error) {
    console.error('Error in handleHelp:', error);
  }
}

// Handler untuk perintah /lang
async function handleLang(ctx) {
  try {
    const userId = ctx.from?.id;
    if (!validateUserId(userId)) {
      return;
    }

    // Cek apakah user dibanned
    if (await isBanned(userId)) {
      await ctx.reply(await getMessage(userId, 'banned'));
      return;
    }

    const langKeyboard = new InlineKeyboard()
      .text('🇮🇩 Indonesia', 'lang_id')
      .row()
      .text('🇺🇸 English', 'lang_en');

    await ctx.reply(await getMessage(userId, 'lang_menu'), {
      reply_markup: langKeyboard
    });
  } catch (error) {
    console.error('Error in handleLang:', error);
  }
}

// Handler untuk perintah /report
async function handleReport(ctx) {
  try {
    const userId = ctx.from?.id;
    if (!validateUserId(userId)) {
      return;
    }

    // Cek apakah user dibanned
    if (await isBanned(userId)) {
      await ctx.reply(await getMessage(userId, 'banned'));
      return;
    }

    const partnerId = await getPartner(userId);
    if (!partnerId) {
      await ctx.reply(await getMessage(userId, 'not_found'));
      return;
    }

    const success = await addReport(userId, partnerId);
    if (success) {
      await clearPair(userId); // Putuskan koneksi setelah laporan
      await ctx.reply(await getMessage(userId, 'report_success'));
    } else {
      await ctx.reply(await getMessage(userId, 'report_failed'));
    }
  } catch (error) {
    console.error('Error in handleReport:', error);
  }
}

// Handler untuk perintah admin /broadcast
async function handleBroadcast(ctx) {
  try {
    const userId = ctx.from?.id;
    if (!validateUserId(userId)) {
      return;
    }

    // Cek apakah user adalah admin
    if (!config.ADMIN_USER_IDS.includes(userId)) {
      return;
    }

    await ctx.reply(await getMessage(userId, 'admin_broadcast_start'));
    // Logika untuk menangani pesan broadcast akan ditangani di handler pesan
  } catch (error) {
    console.error('Error in handleBroadcast:', error);
  }
}

// Handler untuk perintah admin /giftpremium
async function handleGiftPremium(ctx) {
  try {
    const userId = ctx.from?.id;
    if (!validateUserId(userId)) {
      return;
    }

    // Cek apakah user adalah admin
    if (!config.ADMIN_USER_IDS.includes(userId)) {
      return;
    }

    await ctx.reply(await getMessage(userId, 'admin_giftpremium_start'));
    // Logika untuk menangani pemberian premium akan ditangani di handler pesan
  } catch (error) {
    console.error('Error in handleGiftPremium:', error);
  }
}

// Handler untuk perintah /premium
async function handlePremium(ctx) {
  try {
    const userId = ctx.from?.id;
    if (!validateUserId(userId)) {
      return;
    }

    // Cek apakah user dibanned
    if (await isBanned(userId)) {
      await ctx.reply(await getMessage(userId, 'banned'));
      return;
    }

    const isUserPremium = await isPremium(userId);
    const lang = await getUserLang(userId) || 'id';
    
    if (isUserPremium) {
      // Dapatkan preferensi gender saat ini
      const currentGenderPref = await getUserSearchGender(userId);
      let genderPrefText = '';
      
      if (currentGenderPref) {
        genderPrefText = lang === 'id'
          ? `\n🔍 Preferensi pencarian saat ini: ${currentGenderPref}`
          : `\n🔍 Current search preference: ${currentGenderPref}`;
      }
      
      // Tambahkan info tentang fitur pencarian berdasarkan gender
      const searchGenderInfo = lang === 'id'
        ? '\n\n💡 Kamu bisa mencari pasangan berdasarkan gender dengan: /search_gender'
        : '\n\n💡 You can search for partners by gender using: /search_gender';
      
      await ctx.reply(await getMessage(userId, 'premium_status', 'active') + searchGenderInfo + genderPrefText);
    } else {
      // Tampilkan informasi pembayaran premium dengan keyboard
      const uniqueCode = `SC${userId}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      
      // Harga premium
      const priceList = lang === 'id' 
        ? `💰 **Daftar Harga Premium:**
• Rp 1.000 = 1 hari premium
• Rp 3.000 = 3 hari premium
• Rp 5.000 = 5 hari premium
• Rp 10.000 = 10 hari premium
• Rp 25.000 = 25 hari premium
• Rp 50.000 = 50 hari premium`
        : `💰 **Premium Price List:**
• Rp 1,000 = 1 day premium
• Rp 3,000 = 3 days premium
• Rp 5,000 = 5 days premium
• Rp 10,000 = 10 days premium
• Rp 25,000 = 25 days premium
• Rp 50,000 = 50 days premium`;

      const paymentInfo = lang === 'id'
        ? `💎 **Info Premium ShadowChat**

Dengan premium, kamu bisa:
• 🔍 Cari pasangan berdasarkan gender
• ⚡ Prioritas dalam antrian pencarian
• 📊 Lihat statistik obrolan yang lebih lengkap

${priceList}

📥 **Cara Aktifkan:**

**Opsi 1: Trakteer (Otomatis)**
• Di kolom pesan dukungan, tulis salah satu:
  • \`ID: ${userId}\`
  • atau kode unik: \`${uniqueCode}\`
  (bot akan otomatis mengaktifkan premium)

**Opsi 2: Transfer Manual**
• Di catatan transfer, tulis salah satu:
  • \`ID: ${userId}\`
  • atau kode unik: \`${uniqueCode}\`
  (bot akan otomatis mengaktifkan premium)`
        : `💎 **ShadowChat Premium Info**

With premium, you can:
• 🔍 Search for partners by gender
• ⚡ Priority in search queue
• 📊 View more detailed chat statistics

${priceList}

📥 **How to Activate:**

**Option 1: Trakteer (Automatic)**
• In the support message field, write either:
  • \`ID: ${userId}\`
  • or the unique code: \`${uniqueCode}\`
  (the bot will automatically activate your premium)

**Option 2: Manual Transfer**
• In your transfer note, write either:
  • \`ID: ${userId}\`
  • or the unique code: \`${uniqueCode}\`
  (the bot will automatically activate your premium)`;

      const { InlineKeyboard } = require('grammy');
      const paymentKeyboard = new InlineKeyboard()
        .text(lang === 'id' ? '💳 Transfer Manual' : '💳 Manual Transfer', `pay_manual:${uniqueCode}`)
        .row()
        .text(lang === 'id' ? '🌐 Buka Trakteer' : '🌐 Open Trakteer', `pay_trakteer:${uniqueCode}`);

      await ctx.reply(paymentInfo, {
        reply_markup: paymentKeyboard,
        parse_mode: 'Markdown'
      });
    }
  } catch (error) {
    console.error('Error in handlePremium:', error);
  }
}

// Handler untuk perintah /search_gender
async function handleSearchGender(ctx) {
  try {
    const userId = ctx.from?.id;
    if (!validateUserId(userId)) {
      return;
    }

    // Cek apakah user dibanned
    if (await isBanned(userId)) {
      await ctx.reply(await getMessage(userId, 'banned'));
      return;
    }

    // Cek apakah user adalah premium
    if (!await isPremium(userId)) {
      const lang = await getUserLang(userId) || 'id';
      const text = lang === 'id' 
        ? '🔒 Pencarian berdasarkan gender hanya untuk pengguna premium. Ketik /premium untuk info lebih lanjut.'
        : '🔒 Search by gender is only available for premium users. Type /premium for more info.';
      await ctx.reply(text);
      return;
    }

    const lang = await getUserLang(userId) || 'id';
    const text = lang === 'id'
      ? 'Pilih gender yang ingin kamu cari:\n- male\n- female\n- other (tanpa preferensi khusus)\n\nKirimkan pilihanmu (male/female/other), atau kirim "cancel" untuk membatalkan.'
      : 'Please choose the gender you want to search for:\n- male\n- female\n- other (no specific preference)\n\nSend your choice (male/female/other), or send "cancel" to cancel.';
    
    await ctx.reply(text);
  } catch (error) {
    console.error('Error in handleSearchGender:', error);
  }
}

// Handler untuk perintah /setgender
async function handleSetGender(ctx) {
  try {
    const userId = ctx.from?.id;
    if (!validateUserId(userId)) {
      return;
    }

    // Cek apakah user dibanned
    if (await isBanned(userId)) {
      await ctx.reply(await getMessage(userId, 'banned'));
      return;
    }

    // Cek apakah user adalah premium
    if (!await isPremium(userId)) {
      const lang = await getUserLang(userId) || 'id';
      const text = lang === 'id' 
        ? '🔒 Fitur set gender hanya untuk pengguna premium.'
        : '🔒 Set gender feature is only available for premium users.';
      await ctx.reply(text);
      return;
    }

    const args = ctx.message.text.split(' ').slice(1);
    if (args.length === 0) {
      const lang = await getUserLang(userId) || 'id';
      const text = lang === 'id'
        ? 'Gunakan: /setgender <male/female/other>'
        : 'Use: /setgender <male/female/other>';
      await ctx.reply(text);
      return;
    }

    const gender = args[0].toLowerCase();
    if (!['male', 'female', 'other'].includes(gender)) {
      const lang = await getUserLang(userId) || 'id';
      const text = lang === 'id'
        ? 'Gender tidak valid. Gunakan: male/female/other'
        : 'Invalid gender. Use: male/female/other';
      await ctx.reply(text);
      return;
    }

    const success = await setUserGender(userId, gender);
    if (success) {
      const lang = await getUserLang(userId) || 'id';
      const text = lang === 'id'
        ? `✅ Gender berhasil diatur ke: ${gender}`
        : `✅ Gender successfully set to: ${gender}`;
      await ctx.reply(text);
    } else {
      await ctx.reply(await getMessage(userId, 'error'));
    }
  } catch (error) {
    console.error('Error in handleSetGender:', error);
  }
}

// Handler untuk perintah /discount
async function handleDiscount(ctx) {
  try {
    const userId = ctx.from?.id;
    if (!validateUserId(userId)) {
      return;
    }

    // Cek apakah user dibanned
    if (await isBanned(userId)) {
      await ctx.reply(await getMessage(userId, 'banned'));
      return;
    }

    const args = ctx.message.text.split(' ').slice(1);
    if (args.length === 0) {
      // Mode 1: Tampilkan semua diskon yang tersedia
      // Dalam implementasi sederhana ini, kita hanya menampilkan diskon yang sedang aktif untuk user
      const currentDiscount = getUserDiscount(userId);
      const lang = await getUserLang(userId) || 'id';
      if (currentDiscount) {
        const info = getDiscountInfo(currentDiscount);
        if (info) {
          const text = lang === 'id'
            ? `🎁 Kode diskon aktif: ${info.code} (${info.percent}% potongan)`
            : `🎁 Active discount code: ${info.code} (${info.percent}% discount)`;
          await ctx.reply(text);
        } else {
          const text = lang === 'id'
            ? 'ℹ️ Tidak ada kode diskon yang aktif saat ini.'
            : 'ℹ️ No active discount codes right now.';
          await ctx.reply(text);
        }
      } else {
        const text = lang === 'id'
          ? 'ℹ️ Tidak ada kode diskon yang aktif saat ini.'
          : 'ℹ️ No active discount codes right now.';
        await ctx.reply(text);
      }
    } else {
      // Mode 2: Terapkan kode diskon
      const code = args[0];
      const result = assignDiscountToUser(userId, code);
      
      const lang = await getUserLang(userId) || 'id';
      if (result) {
        const text = lang === 'id'
          ? `✅ Kode diskon berhasil diterapkan: ${result.code} (${result.percent}% potongan)`
          : `✅ Discount code applied: ${result.code} (${result.percent}% discount)`;
        await ctx.reply(text);
      } else {
        const text = lang === 'id'
          ? '❌ Kode diskon tidak valid atau sudah mencapai batas penggunaan.'
          : '❌ Invalid discount code or usage limit reached.';
        await ctx.reply(text);
      }
    }
  } catch (error) {
    console.error('Error in handleDiscount:', error);
  }
}

// Handler untuk perintah /next
async function handleNext(ctx) {
  try {
    const userId = ctx.from?.id;
    if (!validateUserId(userId)) {
      return;
    }

    // Cek apakah user dibanned
    if (await isBanned(userId)) {
      await ctx.reply(await getMessage(userId, 'banned'));
      return;
    }

    // Hapus pasangan saat ini
    const partnerId = await getPartner(userId);
    if (partnerId) {
      await clearPair(userId);
      // Kirim pesan ke pasangan bahwa obrolan diakhiri
      try {
        const partnerLang = await getUserLang(partnerId) || 'id';
        await ctx.api.sendMessage(partnerId, await getMessage(partnerId, 'disconnected'));
      } catch (e) {
        // Jika gagal mengirim ke partner (mungkin sudah logout), abaikan
      }
    }

    // Kirim pesan ke user bahwa kita sedang mencari pasangan baru
    await ctx.reply(await getMessage(userId, 'find'));

    // Cari pasangan baru dengan menggunakan preferensi gender jika ada
    setTimeout(async () => {
      try {
        // Ambil preferensi gender pengguna
        const genderPref = await getUserSearchGender(userId);
        let partnerId;
        
        if (genderPref) {
          // Jika ada preferensi gender, kita perlu logika pencocokan berdasarkan gender
          partnerId = await popFromQueueExcept(userId, false);
        } else {
          partnerId = await popFromQueueExcept(userId, false);
        }

        if (partnerId) {
          await setPair(userId, partnerId);
          await ctx.api.sendMessage(userId, await getMessage(userId, 'found'), {
            reply_markup: actionKeyboard
          });
          await ctx.api.sendMessage(partnerId, await getMessage(partnerId, 'found'), {
            reply_markup: actionKeyboard
          });
        } else {
          // Jika tidak menemukan pasangan, biarkan di antrean
          await ctx.api.sendMessage(userId, await getMessage(userId, 'not_found'));
        }
      } catch (error) {
        console.error('Error in matching timeout (next):', error);
      }
    }, 2000);
  } catch (error) {
    console.error('Error in handleNext:', error);
  }
}

// Handler untuk perintah /reportmedia (reply to media)
async function handleReportMedia(ctx) {
  try {
    const userId = ctx.from?.id;
    if (!validateUserId(userId)) {
      return;
    }

    // Cek apakah user dibanned
    if (await isBanned(userId)) {
      await ctx.reply(await getMessage(userId, 'banned'));
      return;
    }

    // Cek apakah user punya pasangan
    const partnerId = await getPartner(userId);
    if (!partnerId) {
      const lang = await getUserLang(userId) || 'id';
      const text = lang === 'id'
        ? '❌ Kamu tidak sedang dalam obrolan. Gunakan /find untuk mencari pasangan.'
        : '❌ You are not in a chat. Use /find to search for a partner.';
      await ctx.reply(text);
      return;
    }

    // Cek apakah ini reply ke message
    const repliedMsg = ctx.message?.reply_to_message;
    if (!repliedMsg) {
      const lang = await getUserLang(userId) || 'id';
      const text = lang === 'id'
        ? '❌ Gunakan /reportmedia dengan reply ke foto/video/media yang ingin dilaporkan.\n\nContoh: Reply ke foto lalu ketik /reportmedia'
        : '❌ Use /reportmedia by replying to the photo/video/media you want to report.\n\nExample: Reply to photo then type /reportmedia';
      await ctx.reply(text);
      return;
    }

    // Detect media type
    let mediaType = null;
    let mediaFileId = null;
    let caption = null;

    if (repliedMsg.photo) {
      mediaType = 'photo';
      mediaFileId = repliedMsg.photo[repliedMsg.photo.length - 1].file_id;
      caption = repliedMsg.caption;
    } else if (repliedMsg.video) {
      mediaType = 'video';
      mediaFileId = repliedMsg.video.file_id;
      caption = repliedMsg.caption;
    } else if (repliedMsg.voice) {
      mediaType = 'voice';
      mediaFileId = repliedMsg.voice.file_id;
    } else if (repliedMsg.video_note) {
      mediaType = 'video_note';
      mediaFileId = repliedMsg.video_note.file_id;
    } else if (repliedMsg.audio) {
      mediaType = 'audio';
      mediaFileId = repliedMsg.audio.file_id;
      caption = repliedMsg.caption;
    } else if (repliedMsg.sticker) {
      mediaType = 'sticker';
      mediaFileId = repliedMsg.sticker.file_id;
    } else if (repliedMsg.document) {
      mediaType = 'document';
      mediaFileId = repliedMsg.document.file_id;
      caption = repliedMsg.caption;
    } else if (repliedMsg.animation) {
      mediaType = 'animation';
      mediaFileId = repliedMsg.animation.file_id;
      caption = repliedMsg.caption;
    } else {
      const lang = await getUserLang(userId) || 'id';
      const text = lang === 'id'
        ? '❌ Pesan yang kamu reply bukan media yang bisa dilaporkan.\n\nYang bisa dilaporkan: foto, video, voice, sticker, dokumen, GIF.'
        : '❌ The message you replied to is not reportable media.\n\nReportable: photo, video, voice, sticker, document, GIF.';
      await ctx.reply(text);
      return;
    }

    // Extract reason from command (optional)
    const commandText = ctx.message.text || '';
    const reason = commandText.replace('/reportmedia', '').trim() || 'Konten tidak pantas';

    // Add media report
    const result = await addMediaReport(
      userId,
      partnerId,
      mediaType,
      mediaFileId,
      caption,
      reason
    );

    if (!result.success) {
      const lang = await getUserLang(userId) || 'id';
      const text = lang === 'id'
        ? '❌ Gagal melaporkan media. Silakan coba lagi.'
        : '❌ Failed to report media. Please try again.';
      await ctx.reply(text);
      return;
    }

    // Send confirmation to reporter
    const lang = await getUserLang(userId) || 'id';
    const confirmText = lang === 'id'
      ? '✅ **Media Berhasil Dilaporkan**\n\nTerima kasih atas laporanmu. Tim moderasi akan meninjau media ini.\n\n⚠️ Obrolan tetap berlanjut. Gunakan /leave jika ingin keluar dari obrolan.'
      : '✅ **Media Successfully Reported**\n\nThank you for your report. The moderation team will review this media.\n\n⚠️ Chat continues. Use /leave if you want to exit the chat.';
    await ctx.reply(confirmText, { parse_mode: 'Markdown' });

    // Forward media to admins with report info
    for (const adminId of config.ADMIN_USER_IDS) {
      try {
        const mediaHash = result.mediaHash;
        const reportText = `🚨 **MEDIA REPORT** #${result.reportId}\n\n` +
          `📋 **Report Details:**\n` +
          `Reporter: ${userId}\n` +
          `Reported User: ${partnerId}\n` +
          `Media Type: ${mediaType}\n` +
          `Reason: ${reason}\n` +
          `Hash: \`${mediaHash}\`\n\n` +
          `⚡ **Quick Actions:**\n` +
          `/banmedia ${mediaHash} - Ban this media\n` +
          `/banuser ${partnerId} - Ban reported user\n` +
          `/restrictmedia ${partnerId} ${mediaType} - Restrict media type`;

        // Forward the actual media
        if (mediaType === 'photo') {
          await ctx.api.sendPhoto(adminId, mediaFileId, { 
            caption: reportText,
            parse_mode: 'Markdown'
          });
        } else if (mediaType === 'video') {
          await ctx.api.sendVideo(adminId, mediaFileId, { 
            caption: reportText,
            parse_mode: 'Markdown'
          });
        } else if (mediaType === 'voice') {
          await ctx.api.sendVoice(adminId, mediaFileId);
          await ctx.api.sendMessage(adminId, reportText, { parse_mode: 'Markdown' });
        } else if (mediaType === 'video_note') {
          await ctx.api.sendVideoNote(adminId, mediaFileId);
          await ctx.api.sendMessage(adminId, reportText, { parse_mode: 'Markdown' });
        } else if (mediaType === 'audio') {
          await ctx.api.sendAudio(adminId, mediaFileId, { 
            caption: reportText,
            parse_mode: 'Markdown'
          });
        } else if (mediaType === 'sticker') {
          await ctx.api.sendSticker(adminId, mediaFileId);
          await ctx.api.sendMessage(adminId, reportText, { parse_mode: 'Markdown' });
        } else if (mediaType === 'document') {
          await ctx.api.sendDocument(adminId, mediaFileId, { 
            caption: reportText,
            parse_mode: 'Markdown'
          });
        } else if (mediaType === 'animation') {
          await ctx.api.sendAnimation(adminId, mediaFileId, { 
            caption: reportText,
            parse_mode: 'Markdown'
          });
        }
      } catch (adminError) {
        console.error('Failed to forward report to admin:', adminError.message);
      }
    }

    // Send to report log group if configured
    if (config.REPORT_LOG_CHAT_ID && config.REPORT_LOG_CHAT_ID !== 0) {
      try {
        const logText = `🚨 **Media Report** #${result.reportId}\n\n` +
          `Reporter: \`${userId}\`\n` +
          `Reported: \`${partnerId}\`\n` +
          `Type: ${mediaType}\n` +
          `Reason: ${reason}`;

        await ctx.api.sendMessage(config.REPORT_LOG_CHAT_ID, logText, {
          parse_mode: 'Markdown',
          message_thread_id: config.REPORT_LOG_TOPIC_ID && config.REPORT_LOG_TOPIC_ID > 0
            ? config.REPORT_LOG_TOPIC_ID
            : undefined,
        });
      } catch (logError) {
        console.error('Failed to send report to log group:', logError.message);
      }
    }

  } catch (error) {
    console.error('Error in handleReportMedia:', error);
  }
}

module.exports = {
  handleStart,
  handleFind,
  handleLeave,
  handleDisconnect,
  handleHelp,
  handleLang,
  handleReport,
  handleReportMedia,
  handleBroadcast,
  handleGiftPremium,
  handlePremium,
  handleSearchGender,
  handleSetGender,
  handleDiscount,
  handleNext,
  getMessage,
  actionKeyboard
};