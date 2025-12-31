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
const { moderateMessage, checkFloodControl } = require('../../admin/moderation');
const { trackUserActivity } = require('../../admin/analytics');
const { validateMedia, getBlockMessage } = require('../../admin/media-security');
const { isMediaBanned, isUserMediaRestricted } = require('../../admin/media-reports');
const { createMediaHash } = require('../../utils/media-hash');
const config = require('../../config');

// Status broadcast untuk setiap admin
const broadcastStatus = new Map();
// Status giftpremium untuk setiap admin
const giftpremiumStatus = new Map();
// Status sesi pembayaran untuk setiap user
const paymentSessionStatus = new Map();

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

    // Cek apakah user sedang dalam sesi pembayaran manual (in-memory)
    const paymentSession = paymentSessionStatus.get(userId);
    if (paymentSession && paymentSession.startsWith('manual:')) {
      // User dalam sesi pembayaran manual, proses bukti pembayaran
      const uniqueCode = paymentSession.split(':')[1];
      
      if (ctx.message.photo) {
        // Proses screenshot pembayaran dengan OCR
        const lang = await getUserLang(userId) || 'id';
        
        // Kirim pesan bahwa bukti pembayaran sedang diproses
        const processingText = lang === 'id'
          ? '🔍 Memproses bukti pembayaran...'
          : '🔍 Processing payment proof...';
        
        await ctx.reply(processingText);
        
        try {
          // Ambil foto terbesar (resolusi tertinggi)
          const photo = ctx.message.photo[ctx.message.photo.length - 1];
          const file = await ctx.api.getFile(photo.file_id);
          const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
          
          // Impor Tesseract di sini
          const Tesseract = require('tesseract.js');
          
          // Proses OCR
          const result = await Tesseract.recognize(
            fileUrl,
            'ind+eng', // Bahasa: Indonesia + English
            {
              logger: m => {} // Matikan logging
            }
          );
          
          const ocrText = result.data.text;
          
          // Ekstrak informasi dari OCR
          const amountMatches = ocrText.match(/(?:Rp|rp|IDR)\s*([0-9.,]+)/gi);
          const codeMatches = ocrText.match(/SC\d+-[A-Z0-9]+/gi); // Cari kode unik SCxxx-xxxx
          
          // Cek apakah kode cocok
          const codeMatch = codeMatches && codeMatches.find(code => code.includes(uniqueCode));
          
          if (codeMatch) {
            // Cek jumlah transfer
            if (amountMatches && amountMatches.length > 0) {
              // Ambil jumlah terbesar dari OCR
              const amounts = amountMatches.map(match => {
                const num = match.replace(/Rp|rp|IDR|[.,]/g, '').trim();
                return parseInt(num) || 0;
              }).filter(num => num > 0);
              
              if (amounts.length > 0) {
                const maxAmount = Math.max(...amounts);
                // Hitung hari premium berdasarkan jumlah transfer
                const premiumDays = Math.floor(maxAmount / 1000); // Rp 1.000 = 1 hari
                
                if (premiumDays > 0) {
                  // Perpanjang premium
                  await setPremium(userId, premiumDays);
                  
                  const successText = lang === 'id'
                    ? `✅ Pembayaran berhasil diverifikasi!\n\nKamu mendapatkan ${premiumDays} hari premium.\nFitur premium sekarang aktif.`
                    : `✅ Payment successfully verified!\n\nYou received ${premiumDays} days of premium.\nPremium features are now active.`;
                  
                  await ctx.reply(successText);
                  
                  // Kirim notifikasi ke admin atau grup
                  for (const adminId of config.ADMIN_USER_IDS) {
                    try {
                      const adminText = `💰 Pembayaran otomatis terverifikasi\n\nUser: ${userId}\nJumlah: Rp ${maxAmount.toLocaleString()}\nKode: ${codeMatch}\nHari: ${premiumDays} hari`;
                      await ctx.api.sendMessage(adminId, adminText);
                    } catch (e) {
                      console.error('Gagal kirim notifikasi ke admin:', e.message);
                    }
                  }
                  
                  // Kirim ke grup log pembayaran jika dikonfigurasi
                  if (config.PAYMENT_LOG_CHAT_ID && config.PAYMENT_LOG_CHAT_ID !== 0) {
                    try {
                      const logText = [
                        "💸 *Payment Verification Success*",
                        "",
                        `User ID: \`${userId}\``,
                        `Amount: Rp ${maxAmount.toLocaleString("id-ID")}`,
                        `Code: ${codeMatch}`,
                        `Days: ${premiumDays}`,
                        `Status: Automatic Verification Success`,
                      ].join("\n");
                      
                      await ctx.api.sendMessage(config.PAYMENT_LOG_CHAT_ID, logText, {
                        parse_mode: "Markdown",
                        message_thread_id: config.PAYMENT_LOG_TOPIC_ID && config.PAYMENT_LOG_TOPIC_ID > 0
                          ? config.PAYMENT_LOG_TOPIC_ID
                          : undefined,
                      });
                    } catch (err) {
                      console.error("Gagal kirim log pembayaran ke grup:", err.message);
                    }
                  }
                  
                  // Hapus sesi pembayaran
                  paymentSessionStatus.delete(userId);
                  return;
                }
              }
            }
          }
          
          // Jika tidak cocok atau tidak bisa diverifikasi otomatis, kirim ke admin
          const manualText = lang === 'id'
            ? `⚠️ Pembayaran perlu verifikasi manual.\n\nAdmin akan segera memverifikasi bukti pembayaranmu.`
            : `⚠️ Payment requires manual verification.\n\nAdmin will verify your payment proof shortly.`;
          
          await ctx.reply(manualText);
          
          // Kirim bukti pembayaran ke admin untuk verifikasi manual
          for (const adminId of config.ADMIN_USER_IDS) {
            try {
              // Kirim foto bukti pembayaran ke admin
              await ctx.api.sendPhoto(adminId, photo.file_id, {
                caption: `Manual Payment Verification Required\n\nUser: ${userId}\nExpected Code: ${uniqueCode}\n\nOCR Text: ${ocrText.substring(0, 200)}...`
              });
            } catch (e) {
              console.error('Gagal kirim bukti pembayaran ke admin:', e.message);
            }
          }
          
          // Kirim ke grup log pembayaran jika dikonfigurasi
          if (config.PAYMENT_LOG_CHAT_ID && config.PAYMENT_LOG_CHAT_ID !== 0) {
            try {
              const logText = [
                "💸 *Manual Payment Verification*",
                "",
                `User ID: \`${userId}\``,
                `Expected Code: ${uniqueCode}`,
                `Status: Manual Verification Required`,
                "",
                "*OCR text:*",
                "```",
                ocrText.substring(0, 1900),
                "```",
              ].join("\n");
              
              await ctx.api.sendMessage(config.PAYMENT_LOG_CHAT_ID, logText, {
                parse_mode: "Markdown",
                message_thread_id: config.PAYMENT_LOG_TOPIC_ID && config.PAYMENT_LOG_TOPIC_ID > 0
                  ? config.PAYMENT_LOG_TOPIC_ID
                  : undefined,
              });
            } catch (err) {
              console.error("Gagal kirim log pembayaran ke grup:", err.message);
            }
          }
          
          // Hapus sesi pembayaran
          paymentSessionStatus.delete(userId);
          
        } catch (ocrError) {
          console.error('OCR Error:', ocrError);
          
          // Jika OCR gagal, kirim ke admin untuk verifikasi manual
          const errorText = lang === 'id'
            ? `⚠️ Terjadi kesalahan saat memproses bukti pembayaran.\n\nAdmin akan segera memverifikasi bukti pembayaranmu secara manual.`
            : `⚠️ Error processing payment proof.\n\nAdmin will verify your payment proof manually shortly.`;
          
          await ctx.reply(errorText);
          
          // Kirim bukti pembayaran ke admin untuk verifikasi manual
          for (const adminId of config.ADMIN_USER_IDS) {
            try {
              // Kirim foto bukti pembayaran ke admin
              await ctx.api.sendPhoto(adminId, photo.file_id, {
                caption: `OCR Failed - Manual Verification Required\n\nUser: ${userId}\nExpected Code: ${uniqueCode}\n\nError: ${ocrError.message}`
              });
            } catch (e) {
              console.error('Gagal kirim bukti pembayaran ke admin:', e.message);
            }
          }
          
          // Kirim ke grup log pembayaran jika dikonfigurasi
          if (config.PAYMENT_LOG_CHAT_ID && config.PAYMENT_LOG_CHAT_ID !== 0) {
            try {
              const logText = [
                "💸 *OCR Failed - Manual Verification Required*",
                "",
                `User ID: \`${userId}\``,
                `Expected Code: ${uniqueCode}`,
                `Status: OCR Failed, Manual Verification Required`,
                `Error: ${ocrError.message}`,
              ].join("\n");
              
              await ctx.api.sendMessage(config.PAYMENT_LOG_CHAT_ID, logText, {
                parse_mode: "Markdown",
                message_thread_id: config.PAYMENT_LOG_TOPIC_ID && config.PAYMENT_LOG_TOPIC_ID > 0
                  ? config.PAYMENT_LOG_TOPIC_ID
                  : undefined,
              });
            } catch (err) {
              console.error("Gagal kirim log pembayaran ke grup:", err.message);
            }
          }
          
          // Hapus sesi pembayaran
          paymentSessionStatus.delete(userId);
        }
      } else {
        // Jika bukan foto, beri instruksi
        const lang = await getUserLang(userId) || 'id';
        const text = lang === 'id'
          ? '📷 Silakan kirim screenshot bukti transfer kamu.'
          : '📷 Please send your payment transfer screenshot.';
        
        await ctx.reply(text);
      }
      return; // Keluar dari handler karena ini adalah pesan pembayaran, bukan pesan chat
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
      // Check flood control
      const floodCheck = await checkFloodControl(userId);
      if (floodCheck.shouldBlock) {
        const lang = await getUserLang(userId) || 'id';
        const text = lang === 'id'
          ? '⚠️ Kamu mengirim pesan terlalu cepat. Tunggu sebentar.'
          : '⚠️ You are sending messages too fast. Please wait.';
        await ctx.reply(text);
        return;
      }

      // Check if user is premium
      const userIsPremium = await isPremium(userId);

      // Validate media security
      const mediaValidation = await validateMedia(ctx, userIsPremium);
      
      if (!mediaValidation.allowed) {
        const lang = await getUserLang(userId) || 'id';
        const blockMsg = await getBlockMessage(mediaValidation, lang);
        await ctx.reply(blockMsg, { parse_mode: 'Markdown' });
        
        // Log dangerous file attempts
        if (mediaValidation.severity === 'critical' || mediaValidation.severity === 'high') {
          await addReport(userId, 0, `Dangerous file attempt: ${mediaValidation.fileName} (${mediaValidation.reason})`);
          
          // Notify admins
          for (const adminId of config.ADMIN_USER_IDS) {
            try {
              await ctx.api.sendMessage(adminId, 
                `🚨 Dangerous File Attempt\n\nUser: ${userId}\nFile: ${mediaValidation.fileName}\nReason: ${mediaValidation.reason}\nSeverity: ${mediaValidation.severity}`
              );
            } catch (e) {
              console.error('Failed to notify admin:', e.message);
            }
          }
        }
        return;
      }

      // Show warning for suspicious files
      if (mediaValidation.warning) {
        const lang = await getUserLang(userId) || 'id';
        const warnMsg = await getBlockMessage(mediaValidation, lang);
        await ctx.reply(warnMsg, { parse_mode: 'Markdown' });
      }

      // Moderate message if text
      if (ctx.message.text) {
        const lang = await getUserLang(userId) || 'id';
        const modResult = await moderateMessage(ctx.message.text, userId, lang);
        
        if (modResult.shouldBlock) {
          const blockText = lang === 'id'
            ? '🚫 Pesanmu mengandung konten yang tidak pantas dan tidak dapat dikirim.'
            : '🚫 Your message contains inappropriate content and cannot be sent.';
          await ctx.reply(blockText);
          
          // Notify partner
          const partnerLang = await getUserLang(partnerId) || 'id';
          const partnerText = partnerLang === 'id'
            ? '⚠️ Pasangan mencoba mengirim konten yang tidak pantas. Tetap waspada.'
            : '⚠️ Your partner tried to send inappropriate content. Stay alert.';
          await ctx.api.sendMessage(partnerId, partnerText);
          return;
        }
        
        if (modResult.shouldWarn) {
          const warnText = lang === 'id'
            ? '⚠️ Pesan dikirim, tapi harap jaga kesopanan dalam berkomunikasi.'
            : '⚠️ Message sent, but please maintain courtesy in communication.';
          await ctx.reply(warnText);
        }
      }

      // Track activity
      await trackUserActivity(userId, 'message_sent', {
        messageType: ctx.message.text ? 'text' : 
                     ctx.message.photo ? 'photo' :
                     ctx.message.video ? 'video' :
                     ctx.message.voice ? 'voice' :
                     ctx.message.sticker ? 'sticker' :
                     ctx.message.document ? 'document' : 'other'
      });

      // Check banned media (untuk media selain text)
      if (!ctx.message.text && !ctx.message.location && !ctx.message.contact) {
        let mediaFileId = null;
        let mediaType = null;

        if (ctx.message.photo) {
          mediaFileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
          mediaType = 'photo';
        } else if (ctx.message.video) {
          mediaFileId = ctx.message.video.file_id;
          mediaType = 'video';
        } else if (ctx.message.voice) {
          mediaFileId = ctx.message.voice.file_id;
          mediaType = 'voice';
        } else if (ctx.message.video_note) {
          mediaFileId = ctx.message.video_note.file_id;
          mediaType = 'video_note';
        } else if (ctx.message.audio) {
          mediaFileId = ctx.message.audio.file_id;
          mediaType = 'audio';
        } else if (ctx.message.sticker) {
          mediaFileId = ctx.message.sticker.file_id;
          mediaType = 'sticker';
        } else if (ctx.message.document) {
          mediaFileId = ctx.message.document.file_id;
          mediaType = 'document';
        } else if (ctx.message.animation) {
          mediaFileId = ctx.message.animation.file_id;
          mediaType = 'animation';
        }

        if (mediaFileId && mediaType) {
          // Check if media is banned
          const mediaHash = await createMediaHash(mediaFileId, mediaType);
          if (mediaHash && await isMediaBanned(mediaHash)) {
            const lang = await getUserLang(userId) || 'id';
            const blockText = lang === 'id'
              ? '🚫 Media ini telah dilarang dan tidak dapat dikirim.\n\nMedia ini telah dilaporkan sebelumnya dan di-ban oleh admin.'
              : '🚫 This media has been banned and cannot be sent.\n\nThis media was previously reported and banned by admin.';
            await ctx.reply(blockText);
            return;
          }

          // Check if user is restricted from sending this media type
          if (await isUserMediaRestricted(userId, mediaType)) {
            const lang = await getUserLang(userId) || 'id';
            const restrictText = lang === 'id'
              ? `🚫 Kamu tidak diizinkan mengirim ${mediaType}.\n\nAkun kamu telah dibatasi oleh admin.`
              : `🚫 You are not allowed to send ${mediaType}.\n\nYour account has been restricted by admin.`;
            await ctx.reply(restrictText);
            return;
          }
        }
      }

      // Kirim pesan ke pasangan
      try {
        if (ctx.message.text) {
          await ctx.api.sendMessage(partnerId, ctx.message.text);
        } else if (ctx.message.photo) {
          const photo = ctx.message.photo[ctx.message.photo.length - 1];
          await ctx.api.sendPhoto(partnerId, photo.file_id, { 
            caption: ctx.message.caption || undefined 
          });
        } else if (ctx.message.video) {
          await ctx.api.sendVideo(partnerId, ctx.message.video.file_id, { 
            caption: ctx.message.caption || undefined 
          });
        } else if (ctx.message.voice) {
          await ctx.api.sendVoice(partnerId, ctx.message.voice.file_id, {
            caption: ctx.message.caption || undefined
          });
        } else if (ctx.message.video_note) {
          await ctx.api.sendVideoNote(partnerId, ctx.message.video_note.file_id);
        } else if (ctx.message.audio) {
          await ctx.api.sendAudio(partnerId, ctx.message.audio.file_id, {
            caption: ctx.message.caption || undefined
          });
        } else if (ctx.message.sticker) {
          await ctx.api.sendSticker(partnerId, ctx.message.sticker.file_id);
        } else if (ctx.message.document) {
          await ctx.api.sendDocument(partnerId, ctx.message.document.file_id, { 
            caption: ctx.message.caption || undefined 
          });
        } else if (ctx.message.animation) {
          await ctx.api.sendAnimation(partnerId, ctx.message.animation.file_id, {
            caption: ctx.message.caption || undefined
          });
        } else if (ctx.message.location) {
          await ctx.api.sendLocation(partnerId, 
            ctx.message.location.latitude, 
            ctx.message.location.longitude
          );
        } else if (ctx.message.contact) {
          await ctx.api.sendContact(partnerId,
            ctx.message.contact.phone_number,
            ctx.message.contact.first_name,
            {
              last_name: ctx.message.contact.last_name || undefined
            }
          );
        }
      } catch (sendError) {
        await clearPair(userId);
        const lang = await getUserLang(userId) || 'id';
        const errorText = lang === 'id'
          ? '⚠️ Gagal mengirim pesan ke pasangan. Koneksi telah diputus.'
          : '⚠️ Failed to send message to partner. Connection has been lost.';
        await ctx.reply(errorText);
      }
    } else {
      const lang = await getUserLang(userId) || 'id';
      const text = lang === 'id'
        ? '💬 Kirim pesanmu atau gunakan /find untuk mencari pasangan.'
        : '💬 Send your message or use /find to search for a partner.';
      await ctx.reply(text);
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