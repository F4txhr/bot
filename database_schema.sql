-- Skema database untuk ShadowChat
-- Tabel users
CREATE TABLE IF NOT EXISTS users (
    user_id BIGINT PRIMARY KEY,
    language TEXT DEFAULT 'id',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    search_gender_pref TEXT, -- untuk menyimpan preferensi gender saat mencari
    gender TEXT -- untuk menyimpan gender pengguna
);

-- Tabel pairs (pasangan obrolan)
CREATE TABLE IF NOT EXISTS pairs (
    id SERIAL PRIMARY KEY,
    partner1_id BIGINT NOT NULL,
    partner2_id BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    FOREIGN KEY (partner1_id) REFERENCES users(user_id),
    FOREIGN KEY (partner2_id) REFERENCES users(user_id)
);

-- Tabel banned_users (pengguna yang diblokir)
CREATE TABLE IF NOT EXISTS banned_users (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE,
    reason TEXT,
    banned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- Tabel reports (laporan pengguna)
CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    reporter_id BIGINT NOT NULL,
    reported_id BIGINT NOT NULL,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    FOREIGN KEY (reporter_id) REFERENCES users(user_id),
    FOREIGN KEY (reported_id) REFERENCES users(user_id)
);

-- Tabel premium_users (pengguna premium)
CREATE TABLE IF NOT EXISTS premium_users (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- Tabel queue_free (antrian pencarian pasangan gratis)
CREATE TABLE IF NOT EXISTS queue_free (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- Indeks untuk performa
CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);
CREATE INDEX IF NOT EXISTS idx_pairs_partner1_id ON pairs(partner1_id);
CREATE INDEX IF NOT EXISTS idx_pairs_partner2_id ON pairs(partner2_id);
CREATE INDEX IF NOT EXISTS idx_banned_users_user_id ON banned_users(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_reported_id ON reports(reported_id);
CREATE INDEX IF NOT EXISTS idx_premium_users_user_id ON premium_users(user_id);
CREATE INDEX IF NOT EXISTS idx_premium_users_expires_at ON premium_users(expires_at);
CREATE INDEX IF NOT EXISTS idx_queue_free_user_id ON queue_free(user_id);
CREATE INDEX IF NOT EXISTS idx_queue_free_joined_at ON queue_free(joined_at);

-- Fungsi trigger untuk memperbarui updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger untuk tabel users
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger untuk tabel pairs
CREATE TRIGGER update_pairs_updated_at BEFORE UPDATE ON pairs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();