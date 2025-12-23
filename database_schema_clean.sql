-- Hapus tabel-tabel jika sudah ada
DROP TABLE IF EXISTS pairs CASCADE;
DROP TABLE IF EXISTS banned_users CASCADE;
DROP TABLE IF EXISTS reports CASCADE;
DROP TABLE IF EXISTS premium_users CASCADE;
DROP TABLE IF EXISTS queue_free CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Buat tabel-tabel dari awal
-- Tabel users
CREATE TABLE users (
    user_id BIGINT PRIMARY KEY,
    language TEXT DEFAULT 'id',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    search_gender_pref TEXT,
    gender TEXT
);

-- Tabel pairs
CREATE TABLE pairs (
    id SERIAL PRIMARY KEY,
    partner1_id BIGINT NOT NULL,
    partner2_id BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabel banned_users
CREATE TABLE banned_users (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE,
    reason TEXT,
    banned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE
);

-- Tabel reports
CREATE TABLE reports (
    id SERIAL PRIMARY KEY,
    reporter_id BIGINT NOT NULL,
    reported_id BIGINT NOT NULL,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabel premium_users
CREATE TABLE premium_users (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabel queue_free
CREATE TABLE queue_free (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Buat indeks
CREATE INDEX idx_users_user_id ON users(user_id);
CREATE INDEX idx_pairs_partner1_id ON pairs(partner1_id);
CREATE INDEX idx_pairs_partner2_id ON pairs(partner2_id);
CREATE INDEX idx_banned_users_user_id ON banned_users(user_id);
CREATE INDEX idx_reports_reported_id ON reports(reported_id);
CREATE INDEX idx_premium_users_user_id ON premium_users(user_id);
CREATE INDEX idx_premium_users_expires_at ON premium_users(expires_at);
CREATE INDEX idx_queue_free_user_id ON queue_free(user_id);

-- Fungsi trigger untuk memperbarui updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger untuk tabel users
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger untuk tabel pairs
DROP TRIGGER IF EXISTS update_pairs_updated_at ON pairs;
CREATE TRIGGER update_pairs_updated_at BEFORE UPDATE ON pairs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();