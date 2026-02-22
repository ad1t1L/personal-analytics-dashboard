import os

DATABASE_URL = "sqlite:///database/app.db"

SECRET_KEY = os.environ.get("SECRET_KEY", "CHANGE_ME_BEFORE_DEPLOY")

ALGORITHM                    = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES  = 15
REFRESH_TOKEN_EXPIRE_DAYS    = 30

# ── Email verification ────────────────────────────────────────────────────────
VERIFICATION_TOKEN_EXPIRE_HOURS = 24

# ── Password reset ────────────────────────────────────────────────────────────
PASSWORD_RESET_TOKEN_EXPIRE_HOURS = 1

# ── Email (SMTP) settings ─────────────────────────────────────────────────────
SMTP_HOST     = os.environ.get("SMTP_HOST",     "smtp.gmail.com")
SMTP_PORT     = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER     = os.environ.get("SMTP_USER",     "speedka65@gmail.com")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "gxdd vwdt bqsl kymg")
FROM_EMAIL    = os.environ.get("FROM_EMAIL",    "no-reply@yourapp.com")

APP_BASE_URL  = os.environ.get("APP_BASE_URL",  "http://localhost:8000")

# ── Password rules ────────────────────────────────────────────────────────────
MIN_PASSWORD_LENGTH = 8

# ── Rate limiting ─────────────────────────────────────────────────────────────
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_MINUTES    = 15