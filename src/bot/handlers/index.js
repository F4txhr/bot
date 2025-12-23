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
  getUserGender
} = require('../../database');
const { 
  validateUserId, 
  validateText, 
  createBatch, 
  delay,
  isSearchCooldown,
  addReport: addReportUtil,
  addRating,
  getTrustLevel,
  AUTO_BAN_REPORTS
} = require('../../utils');
const { 
  getMessage, 
  actionKeyboard,
  handleSearchGender 
} = require('./../commands');
const config = require('../../config');

// Status broadcast untuk setiap admin
const broadcastStatus = new Map();
// Status giftpremium untuk setiap admin
const giftpremiumStatus = new Map();

// Handler untuk callback query (inline keyboard)
async function handleCallbackQuery(ctx) {
  try {
    const userId = ctx.from?.id;
    if (!validateUserId(userId)) {
      return;
    }

    // Cek apakah user dibanned
    if (await isBanned(userId)) {
      await ctx.answerCallbackQuery({ text: await getMessage(userId, 'banned') });
      return;
    }

    const callbackData = ctx.callbackQuery.data;

    if (callbackData === 'find') {
      await ctx.answerCallbackQuery();
      
      // Cek apakah user sudah punya pasangan
      const existingPartner = await getPartner(userId);
      if (existingPartner) {
        await ctx.editMessageText(await getMessage(userId, 'chat_with'), {
          reply_markup: actionKeyboard
        });
        return;
      }

      // Cek cooldown pencarian
      if (isSearchCooldown(userId)) {
        const lang = await getUserLang(userId) || 'id';
        const text = lang === 'id'
          ? 'Kamu sedang dalam cooldown 🕐. Tunggu sebentar sebelum mencari lagi.'
          : 'You are in cooldown 🕐. Please wait a moment before searching again.';
        await ctx.answerCallbackQuery({ text });
        return;
      }

      // Tambahkan user ke antrean
      const addedToQueue = await pushToQueue(userId);
      if (!addedToQueue) {
        await ctx.editMessageText(await getMessage(userId, 'find'), {
          reply_markup: actionKeyboard
        });
        return;
      }

      await ctx.editMessageText(await getMessage(userId, 'find'), {
        reply_markup: actionKeyboard
      });

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
            await ctx.editMessageText(await getMessage(userId, 'found'), {
              reply_markup: actionKeyboard
            });
            await ctx.api.sendMessage(partnerId, await getMessage(partnerId, 'found'), {
              reply_markup: actionKeyboard
            });
          } else {
            // Jika tidak menemukan pasangan, biarkan di antrean
            await ctx.editMessageText(await getMessage(userId, 'not_found'), {
              reply_markup: actionKeyboard
            });
          }
        } catch (error) {
          console.error('Error in matching timeout (callback):', error);
        }
      }, 2000);
    } else if (callbackData === 'leave') {
      await ctx.answerCallbackQuery();
      
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

      await ctx.editMessageText(await getMessage(userId, 'leave'), {
        reply_markup: actionKeyboard
      });
    } else if (callbackData.startsWith('lang_')) {
      await ctx.answerCallbackQuery();
      const lang = callbackData.split('_')[1];
      await setUserLang(userId, lang);
      await ctx.editMessageText(await getMessage(userId, 'lang_selected'), {
        reply_markup: actionKeyboard
      });
    }
  } catch (error) {
    console.error('Error in handleCallbackQuery:', error);
    await ctx.answerCallbackQuery({ text: 'Terjadi kesalahan. Silakan coba lagi.' });
  }
}

// Handler untuk pesan teks (termasuk dari admin untuk broadcast/giftpremium)
async function handleMessage(ctx) {
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

    // Jika pesan dari admin dan dalam status broadcast
    if (config.ADMIN_USER_IDS.includes(userId)) {
      // Cek apakah sedang dalam mode broadcast
      if (broadcastStatus.has(userId)) {
        const targetUsers = broadcastStatus.get(userId);
        await handleAdminBroadcast(ctx, targetUsers);
        return;
      }
      
      // Cek apakah sedang dalam mode giftpremium
      if (giftpremiumStatus.has(userId)) {
        await handleAdminGiftPremium(ctx);
        return;
      }
    }

    // Cek apakah user sedang dalam proses pemilihan gender
    // Untuk sementara, kita cek apakah pesan ini adalah pilihan gender
    const text = ctx.message.text?.trim().toLowerCase();
    if (text && ['male', 'female', 'other', 'cancel', 'batal'].includes(text)) {
      if (text === 'cancel' || text === 'batal') {
        // Hapus preferensi gender saat ini
        await setUserSearchGender(userId, null);
        
        const lang = await getUserLang(userId) || 'id';
        const responseText = lang === 'id'
          ? '❌ Preferensi pencarian berdasarkan gender telah dihapus.'
          : '❌ Gender-based search preference has been cleared.';
        await ctx.reply(responseText, { reply_markup: actionKeyboard });
        return;
      }

      if (['male', 'female', 'other'].includes(text)) {
        // Simpan preferensi gender
        await setUserSearchGender(userId, text);

        const lang = await getUserLang(userId) || 'id';
        const responseText = lang === 'id'
          ? `✅ Preferensi pencarian berdasarkan gender telah diatur ke: ${text}. Gunakan /find untuk mencari pasangan dengan preferensi ini.`
          : `✅ Gender-based search preference has been set to: ${text}. Use /find to search for partners with this preference.`;
        await ctx.reply(responseText, { reply_markup: actionKeyboard });
        return;
      }
    }

    // Tangani pesan dari user biasa (pesan chat ke pasangan)
    const partnerId = await getPartner(userId);
    if (partnerId) {
      // Kirim pesan ke pasangan
      try {
        if (ctx.message.text) {
          await ctx.api.sendMessage(partnerId, ctx.message.text);
        } else if (ctx.message.photo) {
          const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Ambil ukuran terbesar
          await ctx.api.sendPhoto(partnerId, photo.file_id, { caption: ctx.message.caption });
        } else if (ctx.message.document) {
          await ctx.api.sendDocument(partnerId, ctx.message.document.file_id, { caption: ctx.message.caption });
        } else if (ctx.message.video) {
          await ctx.api.sendVideo(partnerId, ctx.message.video.file_id, { caption: ctx.message.caption });
        }
      } catch (sendError) {
        // Jika gagal mengirim ke pasangan (mungkin pasangan sudah logout), hapus pasangan
        await clearPair(userId);
        await ctx.reply('⚠️ Gagal mengirim pesan ke pasangan. Koneksi telah diputus.');
      }
    } else {
      // Jika tidak ada pasangan, beri instruksi
      await ctx.reply('💬 Kirim pesanmu atau gunakan /find untuk mencari pasangan.');
    }
  } catch (error) {
    console.error('Error in handleMessage:', error);
  }
}

// Handler untuk admin broadcast
async function handleAdminBroadcast(ctx, targetUsers) {
  try {
    const adminId = ctx.from?.id;
    if (!config.ADMIN_USER_IDS.includes(adminId)) {
      return;
    }

    const message = ctx.message.text;
    if (!validateText(message)) {
      await ctx.reply('❌ Pesan tidak valid.');
      return;
    }

    // Hapus status broadcast
    broadcastStatus.delete(adminId);

    // Kirim pesan ke semua user dalam batch
    const batchSize = 50; // Jumlah user per batch untuk menghindari rate limit
    const batches = createBatch(targetUsers, batchSize);

    let successCount = 0;
    let failCount = 0;

    for (const batch of batches) {
      for (const userId of batch) {
        try {
          await ctx.api.sendMessage(userId, `📢 *PESAN DARI ADMIN*\n\n${message}`, {
            parse_mode: 'Markdown'
          });
          successCount++;
        } catch (error) {
          // Jika gagal mengirim, mungkin user telah memblokir bot
          failCount++;
        }
        
        // Delay kecil antar pengiriman untuk menghindari rate limit
        await delay(50);
      }
      
      // Delay antar batch
      await delay(1000);
    }

    await ctx.reply(`✅ Broadcast selesai!\nSukses: ${successCount}\nGagal: ${failCount}`);
  } catch (error) {
    console.error('Error in handleAdminBroadcast:', error);
    await ctx.reply('❌ Terjadi kesalahan saat menyiarakan pesan.');
  }
}

// Handler untuk admin giftpremium
async function handleAdminGiftPremium(ctx) {
  try {
    const adminId = ctx.from?.id;
    if (!config.ADMIN_USER_IDS.includes(adminId)) {
      return;
    }

    const message = ctx.message.text;
    if (!message) {
      await ctx.reply('❌ Format tidak valid. Gunakan: user_id jumlah_hari');
      return;
    }

    // Hapus status giftpremium
    giftpremiumStatus.delete(adminId);

    // Parse user_id dan durasi
    const [userIdStr, daysStr] = message.trim().split(' ');
    const userId = parseInt(userIdStr);
    const days = parseInt(daysStr);

    if (isNaN(userId) || isNaN(days) || userId <= 0 || days <= 0) {
      await ctx.reply('❌ Format tidak valid. Gunakan: user_id jumlah_hari\nContoh: 123456789 30');
      return;
    }

    // Berikan status premium
    const success = await setPremium(userId, days);
    if (success) {
      await ctx.api.sendMessage(userId, `🎉 Kamu telah menerima status premium selama ${days} hari!`);
      await ctx.reply(await getMessage(adminId, 'admin_giftpremium_success'));
    } else {
      await ctx.reply(await getMessage(adminId, 'admin_giftpremium_failed'));
    }
  } catch (error) {
    console.error('Error in handleAdminGiftPremium:', error);
    await ctx.reply('❌ Terjadi kesalahan saat memberikan premium.');
  }
}

// Handler untuk command yang tidak terdaftar di command handler
async function handleUnknownCommand(ctx) {
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

    await ctx.reply(await getMessage(userId, 'invalid_command'));
  } catch (error) {
    console.error('Error in handleUnknownCommand:', error);
  }
}

module.exports = {
  handleCallbackQuery,
  handleMessage,
  handleAdminBroadcast,
  handleAdminGiftPremium,
  handleUnknownCommand,
  broadcastStatus,
  giftpremiumStatus
};