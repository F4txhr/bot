const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

// Inisialisasi Supabase client
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY);

// Cache untuk operasi yang sering diakses
const userLangCache = new Map();
const premiumCache = new Map();

// TTL cache dalam milidetik (5 menit)
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Inisialisasi database dan cek koneksi
 */
async function initDb() {
  try {
    // Cek koneksi dengan query sederhana, menggunakan user_id sebagai ganti id
    const { data, error } = await supabase
      .from('users')
      .select('user_id')
      .limit(1);

    if (error) {
      console.error('❌ Gagal terhubung ke database:', error.message);
      return false;
    }

    console.log('✅ Koneksi database siap digunakan');
    return true;
  } catch (err) {
    console.error('❌ Terjadi kesalahan saat inisialisasi database:', err.message);
    return false;
  }
}

/**
 * Mendapatkan pasangan chat dari database.
 */
async function getPartner(userId) {
  try {
    const { data, error } = await supabase
      .from("pairs")
      .select("partner1_id, partner2_id")
      .or(`partner1_id.eq.${userId},partner2_id.eq.${userId}`)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("Supabase getPartner error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId
      });
      return null;
    }

    if (!data) return null;

    // Kembalikan pasangan (bukan diri sendiri)
    return data.partner1_id === userId ? data.partner2_id : data.partner1_id;
  } catch (err) {
    console.error("Unexpected error in getPartner:", {
      message: err.message,
      stack: err.stack,
      userId: userId
    });
    return null;
  }
}

/**
 * Menyimpan pasangan ke database.
 */
async function setPair(userId1, userId2) {
  try {
    // Hapus entri lama jika ada
    await clearPair(userId1);
    await clearPair(userId2);

    const { error } = await supabase
      .from("pairs")
      .insert([
        {
          partner1_id: userId1,
          partner2_id: userId2
        }
      ]);

    if (error) {
      console.error("Supabase setPair error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId1: userId1,
        userId2: userId2
      });
      return false;
    }

    return true;
  } catch (err) {
    console.error("Unexpected error in setPair:", {
      message: err.message,
      stack: err.stack,
      userId1: userId1,
      userId2: userId2
    });
    return false;
  }
}

/**
 * Menghapus pasangan dari database.
 */
async function clearPair(userId) {
  try {
    const { error } = await supabase
      .from("pairs")
      .delete()
      .or(`partner1_id.eq.${userId},partner2_id.eq.${userId}`);

    if (error) {
      console.error("Supabase clearPair error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId
      });
      return false;
    }

    return true;
  } catch (err) {
    console.error("Unexpected error in clearPair:", {
      message: err.message,
      stack: err.stack,
      userId: userId
    });
    return false;
  }
}

/**
 * Menghapus user dari antrean.
 */
async function removeFromQueue(userId) {
  try {
    const { error } = await supabase
      .from("queue_free")
      .delete()
      .eq("user_id", userId);

    if (error) {
      console.error("Supabase removeFromQueue error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId
      });
    }
  } catch (err) {
    console.error("Unexpected error in removeFromQueue:", {
      message: err.message,
      stack: err.stack,
      userId: userId
    });
  }
}

/**
 * Menambahkan user ke antrean pencarian pasangan.
 */
async function pushToQueue(userId) {
  try {
    // Periksa apakah user sudah ada di queue
    const { data: existingQueue, error: selectError } = await supabase
      .from("queue_free")
      .select("user_id")
      .eq("user_id", userId);

    if (selectError) {
      console.error("Supabase pushToQueue select error:", {
        message: selectError.message,
        code: selectError.code,
        details: selectError.details,
        userId: userId
      });
      return false;
    }

    // Jika user sudah ada di queue, tidak perlu ditambahkan lagi
    if (existingQueue && existingQueue.length > 0) {
      return true; // Sudah ada di queue
    }

    // Tambahkan user ke queue
    const { error } = await supabase
      .from("queue_free")
      .insert([
        {
          user_id: userId
        }
      ]);

    if (error) {
      console.error("Supabase pushToQueue insert error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId
      });
      return false;
    }

    return true;
  } catch (err) {
    console.error("Unexpected error in pushToQueue:", {
      message: err.message,
      stack: err.stack,
      userId: userId
    });
    return false;
  }
}

/**
 * Mengambil satu user dari antrean (bukan diri sendiri).
 */
async function popFromQueueExcept(userId, preferPremium = false) {
  // Ambil kandidat dari queue_free yang bukan user ini
  // Jika preferPremium = true, prioritaskan user premium terlebih dahulu.
  try {
    let otherId = null;

    if (preferPremium) {
      // Cari premium dulu
      const { data: premList, error: premErr } = await supabase
        .from("queue_free")
        .select("user_id, joined_at")
        .neq("user_id", userId)
        .order("joined_at", { ascending: true });

      if (premErr && premErr.code !== "PGRST116") {
        console.error(
          "Supabase popFromQueueExcept premium list error:",
          {
            message: premErr.message,
            code: premErr.code,
            userId: userId,
            preferPremium: preferPremium
          }
        );
      } else if (Array.isArray(premList) && premList.length > 0) {
        for (const row of premList) {
          const uid = row.user_id;
          if (!uid) continue;
          const isPrem = await isPremium(uid);
          if (isPrem) {
            otherId = uid;
            // Hapus user yang dipilih dari queue
            await supabase
              .from("queue_free")
              .delete()
              .eq("user_id", uid);
            return otherId;
          }
        }
      }
    }

    if (!otherId) {
      // fallback: ambil satu user apa adanya (berdasarkan waktu bergabung terlebih dahulu)
      const { data, error } = await supabase
        .from("queue_free")
        .select("user_id, joined_at")
        .neq("user_id", userId)
        .order("joined_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error && error.code !== "PGRST116") {
        console.error("Supabase popFromQueueExcept error:", {
          message: error.message,
          code: error.code,
          details: error.details,
          userId: userId,
          preferPremium: preferPremium
        });
        return null;
      }
      if (!data) return null;
      otherId = data.user_id;
    }

    const { error: delErr } = await supabase
      .from("queue_free")
      .delete()
      .eq("user_id", otherId);

    if (delErr && delErr.code !== "PGRST116") {
      console.error("Supabase popFromQueueExcept delete error:", {
        message: delErr.message,
        code: delErr.code,
        otherId: otherId
      });
    }

    return otherId;
  } catch (e) {
    console.error("Supabase popFromQueueExcept failure:", {
      message: e.message,
      stack: e.stack,
      userId: userId,
      preferPremium: preferPremium
    });
    return null;
  }
}

/**
 * Mengecek apakah user diblokir.
 */
async function isBanned(userId) {
  try {
    const { data, error } = await supabase
      .from("banned_users")
      .select("user_id")
      .eq("user_id", userId)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("Supabase isBanned error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId
      });
      return false;
    }

    return !!data;
  } catch (err) {
    console.error("Unexpected error in isBanned:", {
      message: err.message,
      stack: err.stack,
      userId: userId
    });
    return false;
  }
}

/**
 * Memblokir user.
 */
async function banUser(userId, reason = null, duration = null) {
  try {
    const banData = {
      user_id: userId,
      reason: reason,
      banned_at: new Date().toISOString()
    };

    if (duration) {
      banData.expires_at = new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString();
    }

    const { error } = await supabase
      .from("banned_users")
      .insert([banData], { onConflict: 'user_id' });

    if (error) {
      console.error("Supabase banUser error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId,
        reason: reason
      });
      return false;
    }

    return true;
  } catch (err) {
    console.error("Unexpected error in banUser:", {
      message: err.message,
      stack: err.stack,
      userId: userId,
      reason: reason
    });
    return false;
  }
}

/**
 * Membatalkan pemblokiran user.
 */
async function unbanUser(userId) {
  try {
    const { error } = await supabase
      .from("banned_users")
      .delete()
      .eq("user_id", userId);

    if (error) {
      console.error("Supabase unbanUser error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId
      });
      return false;
    }

    return true;
  } catch (err) {
    console.error("Unexpected error in unbanUser:", {
      message: err.message,
      stack: err.stack,
      userId: userId
    });
    return false;
  }
}

/**
 * Menambahkan laporan terhadap user.
 */
async function addReport(reporterId, reportedId, reason = null) {
  try {
    const reportData = {
      reporter_id: reporterId,
      reported_id: reportedId,
      reason: reason,
      created_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from("reports")
      .insert([reportData]);

    if (error) {
      console.error("Supabase addReport error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        reporterId: reporterId,
        reportedId: reportedId,
        reason: reason
      });
      return false;
    }

    return true;
  } catch (err) {
    console.error("Unexpected error in addReport:", {
      message: err.message,
      stack: err.stack,
      reporterId: reporterId,
      reportedId: reportedId,
      reason: reason
    });
    return false;
  }
}

/**
 * Mendapatkan bahasa user dari database.
 */
async function getUserLang(userId) {
  // Cek cache terlebih dahulu
  const cacheKey = `lang_${userId}`;
  const cached = userLangCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.value;
  }

  try {
    const { data, error } = await supabase
      .from("users")
      .select("language")
      .eq("user_id", userId)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("Supabase getUserLang error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId
      });
      return null;
    }

    const lang = data ? data.language : null;
    
    // Simpan ke cache
    userLangCache.set(cacheKey, {
      value: lang,
      timestamp: Date.now()
    });

    return lang;
  } catch (err) {
    console.error("Unexpected error in getUserLang:", {
      message: err.message,
      stack: err.stack,
      userId: userId
    });
    return null;
  }
}

/**
 * Mengatur bahasa user di database.
 */
async function setUserLang(userId, language) {
  try {
    const { error } = await supabase
      .from("users")
      .upsert(
        {
          user_id: userId,
          language: language,
          created_at: new Date().toISOString()
        },
        { onConflict: 'user_id' }
      );

    if (error) {
      console.error("Supabase setUserLang error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId,
        language: language
      });
      return false;
    }

    // Update cache
    const cacheKey = `lang_${userId}`;
    userLangCache.set(cacheKey, {
      value: language,
      timestamp: Date.now()
    });

    return true;
  } catch (err) {
    console.error("Unexpected error in setUserLang:", {
      message: err.message,
      stack: err.stack,
      userId: userId,
      language: language
    });
    return false;
  }
}

/**
 * Mengecek apakah user memiliki status premium.
 */
async function isPremium(userId) {
  // Cek cache terlebih dahulu
  const cacheKey = `premium_${userId}`;
  const cached = premiumCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.value;
  }

  try {
    const { data, error } = await supabase
      .from("premium_users")
      .select("user_id")
      .eq("user_id", userId)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("Supabase isPremium error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId
      });
      return false;
    }

    const isUserPremium = !!data;
    
    // Simpan ke cache
    premiumCache.set(cacheKey, {
      value: isUserPremium,
      timestamp: Date.now()
    });

    return isUserPremium;
  } catch (err) {
    console.error("Unexpected error in isPremium:", {
      message: err.message,
      stack: err.stack,
      userId: userId
    });
    return false;
  }
}

/**
 * Memberikan status premium ke user.
 */
async function setPremium(userId, duration = 30) { // default 30 hari
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + duration * 24 * 60 * 60 * 1000);

    const { error } = await supabase
      .from("premium_users")
      .upsert(
        {
          user_id: userId,
          expires_at: expiresAt.toISOString(),
          created_at: now.toISOString()
        },
        { onConflict: 'user_id' }
      );

    if (error) {
      console.error("Supabase setPremium error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId,
        duration: duration
      });
      return false;
    }

    // Hapus dari cache agar data terbaru terbaca
    const cacheKey = `premium_${userId}`;
    premiumCache.delete(cacheKey);

    return true;
  } catch (err) {
    console.error("Unexpected error in setPremium:", {
      message: err.message,
      stack: err.stack,
      userId: userId,
      duration: duration
    });
    return false;
  }
}

/**
 * Menghapus status premium dari user dan mereset preferensi terkait.
 */
async function removePremiumAndResetPreferences(userId) {
  try {
    const { error } = await supabase
      .from("premium_users")
      .delete()
      .eq("user_id", userId);

    if (error) {
      console.error("Supabase removePremium error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId
      });
      return false;
    }

    // Hapus dari cache
    const cacheKey = `premium_${userId}`;
    premiumCache.delete(cacheKey);

    // Reset preferensi gender
    await setUserSearchGender(userId, null);

    return true;
  } catch (err) {
    console.error("Unexpected error in removePremiumAndResetPreferences:", {
      message: err.message,
      stack: err.stack,
      userId: userId
    });
    return false;
  }
}

/**
 * Menghapus status premium dari user.
 */
async function removePremium(userId) {
  try {
    const { error } = await supabase
      .from("premium_users")
      .delete()
      .eq("user_id", userId);

    if (error) {
      console.error("Supabase removePremium error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId
      });
      return false;
    }

    // Hapus dari cache
    const cacheKey = `premium_${userId}`;
    premiumCache.delete(cacheKey);

    return true;
  } catch (err) {
    console.error("Unexpected error in removePremium:", {
      message: err.message,
      stack: err.stack,
      userId: userId
    });
    return false;
  }
}

/**
 * Mendapatkan semua user premium yang aktif.
 */
async function getActivePremiumUsers() {
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("premium_users")
      .select("user_id, expires_at")
      .gte("expires_at", now);

    if (error) {
      console.error("Supabase getActivePremiumUsers error:", {
        message: error.message,
        code: error.code,
        details: error.details
      });
      return [];
    }

    return data || [];
  } catch (err) {
    console.error("Unexpected error in getActivePremiumUsers:", {
      message: err.message,
      stack: err.stack
    });
    return [];
  }
}

/**
 * Mendapatkan preferensi gender untuk pencarian pengguna
 */
async function getUserSearchGender(userId) {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("search_gender_pref")
      .eq("user_id", userId)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("Supabase getUserSearchGender error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId
      });
      return null;
    }

    return data ? data.search_gender_pref : null;
  } catch (err) {
    console.error("Unexpected error in getUserSearchGender:", {
      message: err.message,
      stack: err.stack,
      userId: userId
    });
    return null;
  }
}

/**
 * Mengatur preferensi gender untuk pencarian pengguna
 */
async function setUserSearchGender(userId, gender) {
  try {
    const { error } = await supabase
      .from("users")
      .upsert(
        {
          user_id: userId,
          search_gender_pref: gender,
          created_at: new Date().toISOString()
        },
        { onConflict: 'user_id' }
      );

    if (error) {
      console.error("Supabase setUserSearchGender error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId,
        gender: gender
      });
      return false;
    }

    return true;
  } catch (err) {
    console.error("Unexpected error in setUserSearchGender:", {
      message: err.message,
      stack: err.stack,
      userId: userId,
      gender: gender
    });
    return false;
  }
}

/**
 * Mendapatkan gender pengguna
 */
async function getUserGender(userId) {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("gender")
      .eq("user_id", userId)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("Supabase getUserGender error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId
      });
      return null;
    }

    return data ? data.gender : null;
  } catch (err) {
    console.error("Unexpected error in getUserGender:", {
      message: err.message,
      stack: err.stack,
      userId: userId
    });
    return null;
  }
}

/**
 * Mengatur gender pengguna
 */
async function setUserGender(userId, gender) {
  try {
    const { error } = await supabase
      .from("users")
      .upsert(
        {
          user_id: userId,
          gender: gender,
          created_at: new Date().toISOString()
        },
        { onConflict: 'user_id' }
      );

    if (error) {
      console.error("Supabase setUserGender error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        userId: userId,
        gender: gender
      });
      return false;
    }

    return true;
  } catch (err) {
    console.error("Unexpected error in setUserGender:", {
      message: err.message,
      stack: err.stack,
      userId: userId,
      gender: gender
    });
    return false;
  }
}

/**
 * Membersihkan cache
 */
function clearCache() {
  userLangCache.clear();
  premiumCache.clear();
}

module.exports = {
  supabase,
  initDb,
  // matching
  getPartner,
  setPair,
  clearPair,
  removeFromQueue,
  popFromQueueExcept,
  pushToQueue,
  // report & ban
  isBanned,
  banUser,
  unbanUser,
  addReport,
  // user settings
  getUserLang,
  setUserLang,
  // gender preferences
  getUserSearchGender,
  setUserSearchGender,
  getUserGender,
  setUserGender,
  // premium
  isPremium,
  setPremium,
  removePremium,
  getActivePremiumUsers,
  removePremiumAndResetPreferences,
  // cache
  clearCache
};