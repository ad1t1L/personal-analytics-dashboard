-- database/schema.sql
-- Full schema including all auth tables.
-- SQLAlchemy creates these automatically via Base.metadata.create_all()
-- This file is for reference, documentation, and manual inspection only.

-- ─────────────────────────────────────────────────────────────────────────────
-- USERS
-- Central identity table. One row per registered account.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE,   -- always stored lowercase
    password_hash TEXT    NOT NULL,          -- bcrypt hash, never plain text
    is_verified   BOOLEAN NOT NULL DEFAULT 0,-- 0 until email link is clicked
    is_active     BOOLEAN NOT NULL DEFAULT 1,-- set to 0 to soft-disable account
    totp_secret        VARCHAR(32),               -- base32 TOTP secret for 2FA
    totp_enabled       BOOLEAN NOT NULL DEFAULT 0,-- 1 when user verified first code
    email_2fa_enabled  BOOLEAN NOT NULL DEFAULT 0,-- 1 = can request code at login
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login    DATETIME
);
CREATE INDEX IF NOT EXISTS ix_users_email ON users (email);

-- ─────────────────────────────────────────────────────────────────────────────
-- EMAIL VERIFICATION TOKENS
-- One row per pending verification. Deleted on use or expiry.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT     NOT NULL UNIQUE,  -- 64-char hex, sent in the email link
    expires_at DATETIME NOT NULL,         -- created_at + 24 hours
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_email_verification_tokens_token
    ON email_verification_tokens (token);

-- ─────────────────────────────────────────────────────────────────────────────
-- REFRESH TOKENS
-- One row per active session/device. Revoked on logout or rotation.
-- We store a SHA-256 HASH of the raw token, not the token itself.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT     NOT NULL UNIQUE,  -- SHA-256(raw_token)
    expires_at DATETIME NOT NULL,         -- created_at + 30 days
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    revoked    BOOLEAN  NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_refresh_tokens_token_hash
    ON refresh_tokens (token_hash);

-- ─────────────────────────────────────────────────────────────────────────────
-- EMAIL 2FA CODES (one-time codes sent to email at login)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_2fa_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code       TEXT     NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_email_2fa_codes_user_id ON email_2fa_codes (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- TASKS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title            TEXT    NOT NULL,
    duration_minutes INTEGER DEFAULT 30,
    deadline         TEXT,                -- ISO date string, nullable
    importance       INTEGER DEFAULT 3,   -- 1-5
    completed        BOOLEAN DEFAULT 0,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────────────────────
-- FEEDBACK
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date         TEXT    NOT NULL,        -- YYYY-MM-DD
    stress_level INTEGER NOT NULL,        -- 1-5
    notes        TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);