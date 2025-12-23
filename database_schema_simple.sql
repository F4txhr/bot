-- Langkah 1: Buat tabel users
CREATE TABLE users (
    user_id BIGINT PRIMARY KEY,
    language TEXT DEFAULT 'id',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    search_gender_pref TEXT,
    gender TEXT
);

-- Buat tabel pairs
CREATE TABLE pairs (
    id SERIAL PRIMARY KEY,
    partner1_id BIGINT NOT NULL,
    partner2_id BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Buat tabel banned_users
CREATE TABLE banned_users (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE,
    reason TEXT,
    banned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE
);

-- Buat tabel reports
CREATE TABLE reports (
    id SERIAL PRIMARY KEY,
    reporter_id BIGINT NOT NULL,
    reported_id BIGINT NOT NULL,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Buat tabel premium_users
CREATE TABLE premium_users (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Buat tabel queue_free
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