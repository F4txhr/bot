-- Indexing untuk optimasi performa database

-- Index untuk user_settings (bahasa pengguna)
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings (user_id);
CREATE INDEX IF NOT EXISTS idx_user_settings_lang ON user_settings (lang);

-- Index untuk premium (status premium pengguna)
CREATE INDEX IF NOT EXISTS idx_premium_user_id ON premium (user_id);
CREATE INDEX IF NOT EXISTS idx_premium_expires_at ON premium (expires_at);

-- Index untuk pairs (pasangan chat)
CREATE INDEX IF NOT EXISTS idx_pairs_user_id ON pairs (user_id);
CREATE INDEX IF NOT EXISTS idx_pairs_partner_id ON pairs (partner_id);

-- Index untuk queue_free (antrian pengguna)
CREATE INDEX IF NOT EXISTS idx_queue_free_user_id ON queue_free (user_id);
CREATE INDEX IF NOT EXISTS idx_queue_free_joined_at ON queue_free (joined_at);

-- Index untuk banned_users (pengguna yang diblokir)
CREATE INDEX IF NOT EXISTS idx_banned_users_user_id ON banned_users (user_id);

-- Index untuk payment_codes (kode pembayaran)
CREATE INDEX IF NOT EXISTS idx_payment_codes_code ON payment_codes (code);
CREATE INDEX IF NOT EXISTS idx_payment_codes_user_id ON payment_codes (user_id);
CREATE INDEX IF NOT EXISTS idx_payment_codes_used ON payment_codes (used);

-- Index untuk payments (riwayat pembayaran)
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments (user_id);
CREATE INDEX IF NOT EXISTS idx_payments_method ON payments (method);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments (created_at);

-- Index untuk discount_codes (kode diskon)
CREATE INDEX IF NOT EXISTS idx_discount_codes_code ON discount_codes (code);
CREATE INDEX IF NOT EXISTS idx_discount_codes_disabled ON discount_codes (disabled);

-- Index untuk user_discounts (diskon pengguna)
CREATE INDEX IF NOT EXISTS idx_user_discounts_user_id ON user_discounts (user_id);
CREATE INDEX IF NOT EXISTS idx_user_discounts_code ON user_discounts (code);

-- Index untuk user_stats (statistik pengguna)
CREATE INDEX IF NOT EXISTS idx_user_stats_user_id ON user_stats (user_id);
CREATE INDEX IF NOT EXISTS idx_user_stats_last_active ON user_stats (last_active);

-- Index untuk reported_messages (pesan yang dilaporkan)
CREATE INDEX IF NOT EXISTS idx_reported_messages_reporter_id ON reported_messages (reporter_id);
CREATE INDEX IF NOT EXISTS idx_reported_messages_partner_id ON reported_messages (partner_id);
CREATE INDEX IF NOT EXISTS idx_reported_messages_created_at ON reported_messages (created_at);

-- Index untuk banned_media (media yang diblokir)
CREATE INDEX IF NOT EXISTS idx_banned_media_media_type ON banned_media (media_type);
CREATE INDEX IF NOT EXISTS idx_banned_media_created_at ON banned_media (created_at);