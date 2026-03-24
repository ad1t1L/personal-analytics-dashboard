import os

from dotenv import load_dotenv
load_dotenv()

# Local dev: use SQLite by default. Set USE_SQLITE=1 to force SQLite even if
# DATABASE_URL is set in .env. For production, set DATABASE_URL to MySQL.
# MySQL example: mysql+pymysql://user:password@localhost:3306/dbname
USE_SQLITE = os.environ.get("USE_SQLITE", "").lower() in ("1", "true")
DATABASE_URL = (
    "sqlite:///database/app.db"
    if USE_SQLITE
    else os.environ.get("DATABASE_URL", "sqlite:///database/app.db")
)

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
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "goqo xlfy gcig zabg")
FROM_EMAIL    = os.environ.get("FROM_EMAIL",    "no-reply@yourapp.com")

APP_BASE_URL  = os.environ.get("APP_BASE_URL",  "http://localhost:8000")

# ── Password rules ────────────────────────────────────────────────────────────
MIN_PASSWORD_LENGTH = 8

# ── Rate limiting ─────────────────────────────────────────────────────────────
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_MINUTES    = 15

# ── Email 2FA code expiry (minutes) ───────────────────────────────────────────
EMAIL_2FA_CODE_EXPIRE_MINUTES = 10