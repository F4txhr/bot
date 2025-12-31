const { supabase } = require('../database');
const { createLogger } = require('../utils');

const logger = createLogger('Rating');

async function ratePartner(userId, partnerId, rating, comment = null) {
  if (!['positive', 'neutral', 'negative'].includes(rating)) {
    return { success: false, error: 'Invalid rating value' };
  }

  try {
    const { error } = await supabase
      .from('partner_ratings')
      .insert([{
        rater_id: userId,
        rated_user_id: partnerId,
        rating: rating,
        comment: comment,
        created_at: new Date().toISOString()
      }]);

    if (error) {
      logger.error('Error saving rating', { error: error.message, userId, partnerId });
      return { success: false, error: error.message };
    }

    logger.info('Partner rated', { userId, partnerId, rating });
    return { success: true };
  } catch (err) {
    logger.error('Unexpected error in ratePartner', { error: err.message });
    return { success: false, error: err.message };
  }
}

async function getUserRatingStats(userId) {
  try {
    const { data: ratings, error } = await supabase
      .from('partner_ratings')
      .select('rating')
      .eq('rated_user_id', userId);

    if (error) {
      if (error.message.includes('not find the table')) {
        return {
          totalRatings: 0,
          positive: 0,
          neutral: 0,
          negative: 0,
          score: 0,
          level: 'new'
        };
      }
      logger.error('Error fetching rating stats', { error: error.message, userId });
      return null;
    }

    if (!ratings || ratings.length === 0) {
      return {
        totalRatings: 0,
        positive: 0,
        neutral: 0,
        negative: 0,
        score: 0,
        level: 'new'
      };
    }

    const stats = {
      totalRatings: ratings.length,
      positive: ratings.filter(r => r.rating === 'positive').length,
      neutral: ratings.filter(r => r.rating === 'neutral').length,
      negative: ratings.filter(r => r.rating === 'negative').length
    };

    const score = ((stats.positive * 1 + stats.neutral * 0.5 - stats.negative * 0.5) / stats.totalRatings) * 100;
    stats.score = Math.max(0, Math.min(100, score)).toFixed(2);

    if (score >= 80) stats.level = 'excellent';
    else if (score >= 60) stats.level = 'good';
    else if (score >= 40) stats.level = 'average';
    else if (score >= 20) stats.level = 'poor';
    else stats.level = 'bad';

    return stats;
  } catch (err) {
    logger.error('Unexpected error in getUserRatingStats', { error: err.message });
    return {
      totalRatings: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
      score: 0,
      level: 'new'
    };
  }
}

async function hasRatedPartner(userId, partnerId) {
  try {
    const { data, error } = await supabase
      .from('partner_ratings')
      .select('id')
      .eq('rater_id', userId)
      .eq('rated_user_id', partnerId)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Error checking rating', { error: error.message });
      return false;
    }

    return !!data;
  } catch (err) {
    logger.error('Unexpected error in hasRatedPartner', { error: err.message });
    return false;
  }
}

module.exports = {
  ratePartner,
  getUserRatingStats,
  hasRatedPartner
};