-- Update Reports Table untuk Media Evidence
-- Jalankan di Supabase SQL Editor

-- Backup existing reports table (optional)
-- CREATE TABLE reports_backup AS SELECT * FROM reports;

-- Add new columns to reports table
ALTER TABLE reports 
ADD COLUMN IF NOT EXISTS media_type TEXT,
ADD COLUMN IF NOT EXISTS media_file_id TEXT,
ADD COLUMN IF NOT EXISTS media_hash TEXT,
ADD COLUMN IF NOT EXISTS media_caption TEXT,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS reviewed_by BIGINT,
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS action_taken TEXT,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Update existing reports to have pending status
UPDATE reports SET status = 'pending' WHERE status IS NULL;

-- Create index for media_hash (untuk detect duplicate media)
CREATE INDEX IF NOT EXISTS idx_reports_media_hash ON reports(media_hash);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_media_file_id ON reports(media_file_id);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);

-- Create media_bans table (untuk ban media yang sudah di-report)
CREATE TABLE IF NOT EXISTS media_bans (
    id SERIAL PRIMARY KEY,
    media_hash TEXT NOT NULL UNIQUE,
    media_type TEXT NOT NULL,
    media_file_id TEXT,
    reason TEXT,
    banned_by BIGINT NOT NULL,
    banned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    report_count INTEGER DEFAULT 1,
    last_reported_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for media_bans
CREATE INDEX IF NOT EXISTS idx_media_bans_media_hash ON media_bans(media_hash);
CREATE INDEX IF NOT EXISTS idx_media_bans_media_type ON media_bans(media_type);
CREATE INDEX IF NOT EXISTS idx_media_bans_banned_at ON media_bans(banned_at);

-- Create user_media_restrictions table (ban user dari kirim tipe media tertentu)
CREATE TABLE IF NOT EXISTS user_media_restrictions (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    media_type TEXT NOT NULL,
    reason TEXT,
    restricted_by BIGINT NOT NULL,
    restricted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(user_id, media_type),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- Create index for user_media_restrictions
CREATE INDEX IF NOT EXISTS idx_user_media_restrictions_user_id ON user_media_restrictions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_media_restrictions_media_type ON user_media_restrictions(media_type);
CREATE INDEX IF NOT EXISTS idx_user_media_restrictions_expires_at ON user_media_restrictions(expires_at);

-- Create report_stats view (untuk dashboard)
CREATE OR REPLACE VIEW report_stats AS
SELECT 
    DATE(created_at) as report_date,
    status,
    media_type,
    COUNT(*) as count
FROM reports
WHERE media_type IS NOT NULL
GROUP BY DATE(created_at), status, media_type
ORDER BY report_date DESC;

-- Comments for documentation
COMMENT ON COLUMN reports.media_type IS 'Type of media: photo, video, voice, sticker, document, etc';
COMMENT ON COLUMN reports.media_file_id IS 'Telegram file_id for the reported media';
COMMENT ON COLUMN reports.media_hash IS 'Hash of media file for duplicate detection';
COMMENT ON COLUMN reports.status IS 'Status: pending, reviewed, action_taken, dismissed';
COMMENT ON COLUMN reports.reviewed_by IS 'Admin user_id who reviewed the report';
COMMENT ON COLUMN reports.action_taken IS 'Action taken: banned_user, banned_media, warned, dismissed';

COMMENT ON TABLE media_bans IS 'Banned media that will be auto-blocked when shared';
COMMENT ON TABLE user_media_restrictions IS 'User restrictions from sending specific media types';

-- Grant permissions (adjust as needed)
-- GRANT SELECT, INSERT, UPDATE ON reports TO authenticated;
-- GRANT SELECT, INSERT, UPDATE ON media_bans TO authenticated;
-- GRANT SELECT, INSERT, UPDATE ON user_media_restrictions TO authenticated;
