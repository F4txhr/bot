const { supabase } = require('../database');
const { createLogger } = require('../utils');

const logger = createLogger('Analytics');

const analyticsCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function trackUserActivity(userId, activityType, metadata = {}) {
  try {
    const { error } = await supabase
      .from('user_activity')
      .insert([{
        user_id: userId,
        activity_type: activityType,
        metadata: metadata,
        created_at: new Date().toISOString()
      }]);

    if (error) {
      logger.error('Error tracking user activity', { error: error.message, userId, activityType });
      return false;
    }

    return true;
  } catch (err) {
    logger.error('Unexpected error in trackUserActivity', { error: err.message });
    return false;
  }
}

async function getUserGrowthStats(days = 30) {
  const cacheKey = `growth_${days}`;
  const cached = analyticsCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const growth = [];
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const startOfDay = new Date(date.setHours(0, 0, 0, 0)).toISOString();
      const endOfDay = new Date(date.setHours(23, 59, 59, 999)).toISOString();

      const { count, error } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startOfDay)
        .lte('created_at', endOfDay);

      if (error) {
        logger.error('Error fetching growth stats', { error: error.message });
        continue;
      }

      growth.push({
        date: startOfDay.split('T')[0],
        newUsers: count || 0
      });
    }

    const result = { growth, days };
    analyticsCache.set(cacheKey, { data: result, timestamp: Date.now() });
    
    return result;
  } catch (err) {
    logger.error('Unexpected error in getUserGrowthStats', { error: err.message });
    return { growth: [], days };
  }
}

async function getEngagementStats() {
  const cacheKey = 'engagement';
  const cached = analyticsCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { count: dailyActive } = await supabase
      .from('user_activity')
      .select('user_id', { count: 'exact', head: true })
      .gte('created_at', oneDayAgo);

    const { count: weeklyActive } = await supabase
      .from('user_activity')
      .select('user_id', { count: 'exact', head: true })
      .gte('created_at', oneWeekAgo);

    const { count: monthlyActive } = await supabase
      .from('user_activity')
      .select('user_id', { count: 'exact', head: true })
      .gte('created_at', oneMonthAgo);

    const result = {
      dailyActiveUsers: dailyActive || 0,
      weeklyActiveUsers: weeklyActive || 0,
      monthlyActiveUsers: monthlyActive || 0
    };

    analyticsCache.set(cacheKey, { data: result, timestamp: Date.now() });
    
    return result;
  } catch (err) {
    logger.error('Unexpected error in getEngagementStats', { error: err.message });
    return {
      dailyActiveUsers: 0,
      weeklyActiveUsers: 0,
      monthlyActiveUsers: 0
    };
  }
}

async function getRetentionStats() {
  const cacheKey = 'retention';
  const cached = analyticsCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newUsers } = await supabase
      .from('users')
      .select('user_id')
      .gte('created_at', twoWeeksAgo)
      .lt('created_at', oneWeekAgo);

    if (!newUsers || newUsers.length === 0) {
      return { retentionRate: 0, cohortSize: 0, retained: 0 };
    }

    const userIds = newUsers.map(u => u.user_id);

    const { data: activeUsers } = await supabase
      .from('user_activity')
      .select('user_id')
      .in('user_id', userIds)
      .gte('created_at', oneWeekAgo);

    const uniqueActiveUsers = new Set(activeUsers?.map(a => a.user_id) || []);
    const retentionRate = (uniqueActiveUsers.size / userIds.length) * 100;

    const result = {
      retentionRate: retentionRate.toFixed(2),
      cohortSize: userIds.length,
      retained: uniqueActiveUsers.size
    };

    analyticsCache.set(cacheKey, { data: result, timestamp: Date.now() });
    
    return result;
  } catch (err) {
    logger.error('Unexpected error in getRetentionStats', { error: err.message });
    return { retentionRate: 0, cohortSize: 0, retained: 0 };
  }
}

async function getPremiumConversionStats() {
  const cacheKey = 'premium_conversion';
  const cached = analyticsCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const { count: totalUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    const { count: premiumUsers } = await supabase
      .from('premium_users')
      .select('*', { count: 'exact', head: true })
      .gt('expires_at', new Date().toISOString());

    const conversionRate = totalUsers > 0 ? (premiumUsers / totalUsers) * 100 : 0;

    const result = {
      totalUsers: totalUsers || 0,
      premiumUsers: premiumUsers || 0,
      conversionRate: conversionRate.toFixed(2)
    };

    analyticsCache.set(cacheKey, { data: result, timestamp: Date.now() });
    
    return result;
  } catch (err) {
    logger.error('Unexpected error in getPremiumConversionStats', { error: err.message });
    return {
      totalUsers: 0,
      premiumUsers: 0,
      conversionRate: 0
    };
  }
}

async function getMessageStats(days = 7) {
  const cacheKey = `messages_${days}`;
  const cached = analyticsCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { count: totalMessages } = await supabase
      .from('user_activity')
      .select('*', { count: 'exact', head: true })
      .eq('activity_type', 'message_sent')
      .gte('created_at', cutoffDate);

    const { count: totalChats } = await supabase
      .from('user_activity')
      .select('*', { count: 'exact', head: true })
      .eq('activity_type', 'chat_started')
      .gte('created_at', cutoffDate);

    const avgMessagesPerChat = totalChats > 0 ? (totalMessages / totalChats).toFixed(2) : 0;

    const result = {
      totalMessages: totalMessages || 0,
      totalChats: totalChats || 0,
      avgMessagesPerChat,
      days
    };

    analyticsCache.set(cacheKey, { data: result, timestamp: Date.now() });
    
    return result;
  } catch (err) {
    logger.error('Unexpected error in getMessageStats', { error: err.message });
    return {
      totalMessages: 0,
      totalChats: 0,
      avgMessagesPerChat: 0,
      days
    };
  }
}

async function getAllAnalytics() {
  const [growth, engagement, retention, premium, messages] = await Promise.all([
    getUserGrowthStats(30),
    getEngagementStats(),
    getRetentionStats(),
    getPremiumConversionStats(),
    getMessageStats(7)
  ]);

  return {
    growth,
    engagement,
    retention,
    premium,
    messages,
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  trackUserActivity,
  getUserGrowthStats,
  getEngagementStats,
  getRetentionStats,
  getPremiumConversionStats,
  getMessageStats,
  getAllAnalytics
};
