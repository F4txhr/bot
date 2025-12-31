# ShadowChat Bot - Database Schema

## Tabel yang Diperlukan untuk Fitur Baru

### 1. partner_ratings (Rating System)
```sql
CREATE TABLE IF NOT EXISTS partner_ratings (
  id BIGSERIAL PRIMARY KEY,
  rater_id BIGINT NOT NULL,
  rated_user_id BIGINT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('positive', 'neutral', 'negative')),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(rater_id, rated_user_id)
);

CREATE INDEX idx_partner_ratings_rated_user ON partner_ratings(rated_user_id);
CREATE INDEX idx_partner_ratings_created_at ON partner_ratings(created_at);
```

### 2. referral_codes (Referral System)
```sql
CREATE TABLE IF NOT EXISTS referral_codes (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  uses INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_referral_codes_code ON referral_codes(code);
CREATE INDEX idx_referral_codes_user_id ON referral_codes(user_id);
```

### 3. referral_usage (Referral Tracking)
```sql
CREATE TABLE IF NOT EXISTS referral_usage (
  id BIGSERIAL PRIMARY KEY,
  referrer_id BIGINT NOT NULL,
  referred_user_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(referrer_id, referred_user_id)
);

CREATE INDEX idx_referral_usage_referrer ON referral_usage(referrer_id);
CREATE INDEX idx_referral_usage_created_at ON referral_usage(created_at);
```

### 4. user_activity (Analytics System)
```sql
CREATE TABLE IF NOT EXISTS user_activity (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  activity_type TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_activity_user_id ON user_activity(user_id);
CREATE INDEX idx_user_activity_type ON user_activity(activity_type);
CREATE INDEX idx_user_activity_created_at ON user_activity(created_at);
```

## Perintah SQL Lengkap

Jalankan script berikut di Supabase SQL Editor:

```sql
-- Partner Ratings Table
CREATE TABLE IF NOT EXISTS partner_ratings (
  id BIGSERIAL PRIMARY KEY,
  rater_id BIGINT NOT NULL,
  rated_user_id BIGINT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('positive', 'neutral', 'negative')),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(rater_id, rated_user_id)
);

CREATE INDEX IF NOT EXISTS idx_partner_ratings_rated_user ON partner_ratings(rated_user_id);
CREATE INDEX IF NOT EXISTS idx_partner_ratings_created_at ON partner_ratings(created_at);

-- Referral Codes Table
CREATE TABLE IF NOT EXISTS referral_codes (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  uses INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_codes_user_id ON referral_codes(user_id);

-- Referral Usage Table
CREATE TABLE IF NOT EXISTS referral_usage (
  id BIGSERIAL PRIMARY KEY,
  referrer_id BIGINT NOT NULL,
  referred_user_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(referrer_id, referred_user_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_usage_referrer ON referral_usage(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referral_usage_created_at ON referral_usage(created_at);

-- User Activity Table
CREATE TABLE IF NOT EXISTS user_activity (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  activity_type TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_type ON user_activity(activity_type);
CREATE INDEX IF NOT EXISTS idx_user_activity_created_at ON user_activity(created_at);
```

## Environment Variables Tambahan

Tambahkan di file `.env`:

```env
# Admin Dashboard
ADMIN_TOKEN=your_secure_admin_token_here
```

## Catatan
- Semua tabel sudah menggunakan TIMESTAMPTZ untuk timezone-aware timestamps
- Indexes sudah ditambahkan untuk query performance
- Unique constraints untuk mencegah duplikasi data
- Check constraints untuk validasi data
