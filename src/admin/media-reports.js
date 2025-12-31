const { supabase } = require('../database');
const { createLogger } = require('../utils');
const { createMediaHash } = require('../utils/media-hash');

const logger = createLogger('MediaReport');

async function addMediaReport(reporterId, reportedUserId, mediaType, mediaFileId, caption = null, reason = null) {
  try {
    const mediaHash = await createMediaHash(mediaFileId, mediaType);
    
    const { data, error } = await supabase
      .from('reports')
      .insert([{
        reporter_id: reporterId,
        reported_id: reportedUserId,
        media_type: mediaType,
        media_file_id: mediaFileId,
        media_hash: mediaHash,
        media_caption: caption,
        reason: reason,
        status: 'pending',
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) {
      logger.error('Error adding media report', { 
        error: error.message, 
        reporterId, 
        reportedUserId,
        mediaType 
      });
      return { success: false, error: error.message };
    }

    logger.info('Media report added', { 
      reportId: data.id,
      reporterId, 
      reportedUserId, 
      mediaType,
      mediaHash 
    });

    return { success: true, reportId: data.id, mediaHash };
  } catch (err) {
    logger.error('Unexpected error in addMediaReport', { error: err.message });
    return { success: false, error: err.message };
  }
}

async function getMediaReports(status = null, limit = 50) {
  try {
    let query = supabase
      .from('reports')
      .select('*')
      .not('media_type', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Error fetching media reports', { error: error.message });
      return [];
    }

    return data || [];
  } catch (err) {
    logger.error('Unexpected error in getMediaReports', { error: err.message });
    return [];
  }
}

async function updateReportStatus(reportId, status, reviewedBy, actionTaken = null, notes = null) {
  try {
    const updateData = {
      status,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString()
    };

    if (actionTaken) updateData.action_taken = actionTaken;
    if (notes) updateData.notes = notes;

    const { error } = await supabase
      .from('reports')
      .update(updateData)
      .eq('id', reportId);

    if (error) {
      logger.error('Error updating report status', { error: error.message, reportId });
      return false;
    }

    logger.info('Report status updated', { reportId, status, actionTaken });
    return true;
  } catch (err) {
    logger.error('Unexpected error in updateReportStatus', { error: err.message });
    return false;
  }
}

async function isMediaBanned(mediaHash) {
  try {
    const { data, error } = await supabase
      .from('media_bans')
      .select('id, reason, banned_at')
      .eq('media_hash', mediaHash)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Error checking media ban', { error: error.message, mediaHash });
      return false;
    }

    return !!data;
  } catch (err) {
    logger.error('Unexpected error in isMediaBanned', { error: err.message });
    return false;
  }
}

async function banMedia(mediaHash, mediaType, mediaFileId, reason, bannedBy) {
  try {
    const { data, error } = await supabase
      .from('media_bans')
      .insert([{
        media_hash: mediaHash,
        media_type: mediaType,
        media_file_id: mediaFileId,
        reason: reason,
        banned_by: bannedBy,
        banned_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        const { error: updateError } = await supabase
          .from('media_bans')
          .update({
            report_count: supabase.rpc('increment', { row_id: mediaHash, field: 'report_count' }),
            last_reported_at: new Date().toISOString()
          })
          .eq('media_hash', mediaHash);

        if (!updateError) {
          logger.info('Media ban updated (already exists)', { mediaHash });
          return { success: true, alreadyBanned: true };
        }
      }

      logger.error('Error banning media', { error: error.message, mediaHash });
      return { success: false, error: error.message };
    }

    logger.info('Media banned', { mediaHash, mediaType, reason });
    return { success: true, alreadyBanned: false };
  } catch (err) {
    logger.error('Unexpected error in banMedia', { error: err.message });
    return { success: false, error: err.message };
  }
}

async function isUserMediaRestricted(userId, mediaType) {
  try {
    const now = new Date().toISOString();
    
    const { data, error } = await supabase
      .from('user_media_restrictions')
      .select('*')
      .eq('user_id', userId)
      .eq('media_type', mediaType)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Error checking user media restriction', { error: error.message, userId, mediaType });
      return false;
    }

    return !!data;
  } catch (err) {
    logger.error('Unexpected error in isUserMediaRestricted', { error: err.message });
    return false;
  }
}

async function restrictUserMedia(userId, mediaType, reason, restrictedBy, durationDays = null) {
  try {
    const expiresAt = durationDays 
      ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const { error } = await supabase
      .from('user_media_restrictions')
      .insert([{
        user_id: userId,
        media_type: mediaType,
        reason: reason,
        restricted_by: restrictedBy,
        restricted_at: new Date().toISOString(),
        expires_at: expiresAt
      }]);

    if (error) {
      if (error.code === '23505') {
        const { error: updateError } = await supabase
          .from('user_media_restrictions')
          .update({
            reason: reason,
            restricted_by: restrictedBy,
            restricted_at: new Date().toISOString(),
            expires_at: expiresAt
          })
          .eq('user_id', userId)
          .eq('media_type', mediaType);

        if (!updateError) {
          logger.info('User media restriction updated', { userId, mediaType });
          return { success: true };
        }
      }

      logger.error('Error restricting user media', { error: error.message, userId, mediaType });
      return { success: false, error: error.message };
    }

    logger.info('User media restricted', { userId, mediaType, durationDays });
    return { success: true };
  } catch (err) {
    logger.error('Unexpected error in restrictUserMedia', { error: err.message });
    return { success: false, error: err.message };
  }
}

async function getMediaReportStats() {
  try {
    const { data, error } = await supabase
      .from('report_stats')
      .select('*')
      .limit(30);

    if (error) {
      logger.error('Error fetching media report stats', { error: error.message });
      return [];
    }

    return data || [];
  } catch (err) {
    logger.error('Unexpected error in getMediaReportStats', { error: err.message });
    return [];
  }
}

module.exports = {
  addMediaReport,
  getMediaReports,
  updateReportStatus,
  isMediaBanned,
  banMedia,
  isUserMediaRestricted,
  restrictUserMedia,
  getMediaReportStats
};
