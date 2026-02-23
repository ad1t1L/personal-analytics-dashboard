-- MySQL schema (reference). Create the database first, then set DATABASE_URL.
-- Example: mysql+pymysql://user:password@localhost:3306/plannerhub

CREATE TABLE IF NOT EXISTS users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(255) NOT NULL,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_verified   TINYINT(1) NOT NULL DEFAULT 0,
    is_active     TINYINT(1) NOT NULL DEFAULT 1,
    totp_secret        VARCHAR(32) NULL,
    totp_enabled       TINYINT(1) NOT NULL DEFAULT 0,
    email_2fa_enabled  TINYINT(1) NOT NULL DEFAULT 0,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login    DATETIME NULL,
    INDEX ix_users_email (email)
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT NOT NULL,
    token      VARCHAR(64) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX ix_email_verification_tokens_token (token)
);

CREATE TABLE IF NOT EXISTS email_2fa_codes (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT NOT NULL,
    code       VARCHAR(10) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX ix_email_2fa_codes_user_id (user_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    revoked    TINYINT(1) NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX ix_refresh_tokens_token_hash (token_hash)
);

CREATE TABLE IF NOT EXISTS tasks (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    user_id          INT NOT NULL,
    title            VARCHAR(255) NOT NULL,
    duration_minutes INT DEFAULT 30,
    deadline         VARCHAR(32) NULL,
    importance       INT DEFAULT 3,
    completed        TINYINT(1) DEFAULT 0,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS feedback (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    user_id      INT NOT NULL,
    date         VARCHAR(10) NOT NULL,
    stress_level INT NOT NULL,
    notes        TEXT NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
