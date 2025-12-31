const { supabase } = require('../database');
const { createLogger, normalizeDiscountCode } = require('../utils');
const { setPremium } = require('../database');

const logger = createLogger('Referral');

function generateReferralCode(userId) {
  const base = userId.toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `REF${base}${random}`;
}

async function createReferralCode(userId) {
  try {
    const { data: existing } = await supabase
      .from('referral_codes')
      .select('code')
      .eq('user_id', userId)
      .single();

    if (existing) {
      return { success: true, code: existing.code, isNew: false };
    }

    const code = generateReferralCode(userId);

    const { error } = await supabase
      .from('referral_codes')
      .insert([{
        user_id: userId,
        code: code,
        uses: 0,
        created_at: new Date().toISOString()
      }]);

    if (error) {
      logger.error('Error creating referral code', { error: error.message, userId });
      return { success: false, error: error.message };
    }

    logger.info('Referral code created', { userId, code });
    return { success: true, code, isNew: true };
  } catch (err) {
    logger.error('Unexpected error in createReferralCode', { error: err.message });
    return { success: false, error: err.message };
  }
}

async function useReferralCode(newUserId, code) {
  try {
    const normalizedCode = normalizeDiscountCode(code);
    
    const { data: referralData, error: fetchError } = await supabase
      .from('referral_codes')
      .select('*')
      .eq('code', normalizedCode)
      .single();

    if (fetchError || !referralData) {
      logger.warn('Invalid referral code', { code: normalizedCode, newUserId });
      return { success: false, error: 'Invalid referral code' };
    }

    const referrerId = referralData.user_id;

    if (referrerId === newUserId) {
      return { success: false, error: 'Cannot use your own referral code' };
    }

    const { data: alreadyUsed } = await supabase
      .from('referral_usage')
      .select('id')
      .eq('referrer_id', referrerId)
      .eq('referred_user_id', newUserId)
      .single();

    if (alreadyUsed) {
      return { success: false, error: 'Referral code already used' };
    }

    const { error: usageError } = await supabase
      .from('referral_usage')
      .insert([{
        referrer_id: referrerId,
        referred_user_id: newUserId,
        created_at: new Date().toISOString()
      }]);

    if (usageError) {
      logger.error('Error recording referral usage', { error: usageError.message });
      return { success: false, error: usageError.message };
    }

    const { error: updateError } = await supabase
      .from('referral_codes')
      .update({ uses: referralData.uses + 1 })
      .eq('code', normalizedCode);

    if (updateError) {
      logger.warn('Error updating referral count', { error: updateError.message });
    }

    const bonusDays = 3;
    await setPremium(referrerId, bonusDays);
    await setPremium(newUserId, bonusDays);

    logger.info('Referral code used successfully', { 
      referrerId, 
      newUserId, 
      code: normalizedCode,
      bonusDays 
    });

    return {
      success: true,
      referrerId,
      bonusDays,
      message: `Both you and your referrer received ${bonusDays} days of premium!`
    };
  } catch (err) {
    logger.error('Unexpected error in useReferralCode', { error: err.message });
    return { success: false, error: err.message };
  }
}

async function getReferralStats(userId) {
  try {
    const { data: referralCode } = await supabase
      .from('referral_codes')
      .select('code, uses')
      .eq('user_id', userId)
      .single();

    const { count: totalReferred } = await supabase
      .from('referral_usage')
      .select('*', { count: 'exact', head: true })
      .eq('referrer_id', userId);

    const { data: recentReferrals } = await supabase
      .from('referral_usage')
      .select('referred_user_id, created_at')
      .eq('referrer_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    return {
      code: referralCode?.code || null,
      totalReferred: totalReferred || 0,
      recentReferrals: recentReferrals || [],
      bonusEarned: (totalReferred || 0) * 3
    };
  } catch (err) {
    logger.error('Unexpected error in getReferralStats', { error: err.message });
    return {
      code: null,
      totalReferred: 0,
      recentReferrals: [],
      bonusEarned: 0
    };
  }
}

module.exports = {
  generateReferralCode,
  createReferralCode,
  useReferralCode,
  getReferralStats
};
