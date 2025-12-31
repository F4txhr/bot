const { supabase } = require('../database');
const { createLogger } = require('../utils');

const logger = createLogger('Cleanup');

async function cleanupExpiredPremium() {
  try {
    const now = new Date().toISOString();
    
    const { data: expiredUsers, error } = await supabase
      .from('premium_users')
      .select('user_id, expires_at')
      .lt('expires_at', now);

    if (error) {
      logger.error('Error fetching expired premium users', { error: error.message });
      return { success: false, count: 0 };
    }

    if (!expiredUsers || expiredUsers.length === 0) {
      logger.info('No expired premium users found');
      return { success: true, count: 0 };
    }

    const userIds = expiredUsers.map(u => u.user_id);

    const { error: deleteError } = await supabase
      .from('premium_users')
      .delete()
      .in('user_id', userIds);

    if (deleteError) {
      logger.error('Error deleting expired premium users', { error: deleteError.message });
      return { success: false, count: 0 };
    }

    const { error: resetGenderError } = await supabase
      .from('users')
      .update({ search_gender: null })
      .in('user_id', userIds);

    if (resetGenderError) {
      logger.warn('Error resetting gender preferences', { error: resetGenderError.message });
    }

    logger.info('Cleaned up expired premium users', { count: expiredUsers.length });
    return { success: true, count: expiredUsers.length };
  } catch (err) {
    logger.error('Unexpected error in cleanupExpiredPremium', { error: err.message });
    return { success: false, count: 0 };
  }
}

async function cleanupOldReports(daysOld = 30) {
  try {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();

    const { count, error } = await supabase
      .from('reports')
      .delete()
      .lt('created_at', cutoffDate);

    if (error) {
      logger.error('Error cleaning up old reports', { error: error.message });
      return { success: false, count: 0 };
    }

    logger.info('Cleaned up old reports', { count: count || 0, daysOld });
    return { success: true, count: count || 0 };
  } catch (err) {
    logger.error('Unexpected error in cleanupOldReports', { error: err.message });
    return { success: false, count: 0 };
  }
}

async function cleanupOrphanedPairs() {
  try {
    const { data: pairs, error } = await supabase
      .from('pairs')
      .select('partner1_id, partner2_id, created_at');

    if (error) {
      logger.error('Error fetching pairs', { error: error.message });
      return { success: false, count: 0 };
    }

    if (!pairs || pairs.length === 0) {
      return { success: true, count: 0 };
    }

    const cutoffTime = Date.now() - 24 * 60 * 60 * 1000;
    const oldPairs = pairs.filter(p => new Date(p.created_at).getTime() < cutoffTime);

    if (oldPairs.length === 0) {
      return { success: true, count: 0 };
    }

    const idsToDelete = [];
    for (const pair of oldPairs) {
      idsToDelete.push(pair.partner1_id);
      idsToDelete.push(pair.partner2_id);
    }

    const { error: deleteError } = await supabase
      .from('pairs')
      .delete()
      .or(idsToDelete.map(id => `partner1_id.eq.${id},partner2_id.eq.${id}`).join(','));

    if (deleteError) {
      logger.error('Error deleting orphaned pairs', { error: deleteError.message });
      return { success: false, count: 0 };
    }

    logger.info('Cleaned up orphaned pairs', { count: oldPairs.length });
    return { success: true, count: oldPairs.length };
  } catch (err) {
    logger.error('Unexpected error in cleanupOrphanedPairs', { error: err.message });
    return { success: false, count: 0 };
  }
}

async function cleanupStaleQueue() {
  try {
    const cutoffTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const { count, error } = await supabase
      .from('queue_free')
      .delete()
      .lt('joined_at', cutoffTime);

    if (error) {
      logger.error('Error cleaning up stale queue', { error: error.message });
      return { success: false, count: 0 };
    }

    logger.info('Cleaned up stale queue entries', { count: count || 0 });
    return { success: true, count: count || 0 };
  } catch (err) {
    logger.error('Unexpected error in cleanupStaleQueue', { error: err.message });
    return { success: false, count: 0 };
  }
}

async function runAllCleanups() {
  logger.info('Starting scheduled cleanup tasks');

  const results = {
    expiredPremium: await cleanupExpiredPremium(),
    oldReports: await cleanupOldReports(30),
    orphanedPairs: await cleanupOrphanedPairs(),
    staleQueue: await cleanupStaleQueue()
  };

  const totalCleaned = 
    results.expiredPremium.count +
    results.oldReports.count +
    results.orphanedPairs.count +
    results.staleQueue.count;

  logger.info('Cleanup tasks completed', {
    totalCleaned,
    breakdown: {
      expiredPremium: results.expiredPremium.count,
      oldReports: results.oldReports.count,
      orphanedPairs: results.orphanedPairs.count,
      staleQueue: results.staleQueue.count
    }
  });

  return results;
}

function startPeriodicCleanup(intervalHours = 6) {
  const intervalMs = intervalHours * 60 * 60 * 1000;
  
  logger.info('Starting periodic cleanup', { intervalHours });
  
  runAllCleanups();
  
  setInterval(() => {
    runAllCleanups();
  }, intervalMs);
}

module.exports = {
  cleanupExpiredPremium,
  cleanupOldReports,
  cleanupOrphanedPairs,
  cleanupStaleQueue,
  runAllCleanups,
  startPeriodicCleanup
};
