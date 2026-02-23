import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import pyotp
from jose import jwt
from jose.exceptions import JWTError

from backend.config import (
    SECRET_KEY, ALGORITHM,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    REFRESH_TOKEN_EXPIRE_DAYS,
)

# Short-lived token used after password login when 2FA is required (5 min)
TOTP_PENDING_EXPIRE_MINUTES = 5

__all__ = [
    "JWTError", "hash_password", "verify_password", "create_access_token",
    "decode_access_token", "generate_refresh_token", "hash_refresh_token",
    "refresh_token_expiry", "generate_verification_token",
    "generate_totp_secret", "verify_totp", "get_totp_uri",
    "create_2fa_pending_token", "decode_2fa_pending_token",
]


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: int, email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload: dict[str, Any] = {
        "sub":   str(user_id),
        "email": email,
        "exp":   expire,
        "iat":   datetime.now(timezone.utc),
    }
    return str(jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM))


def decode_access_token(token: str) -> dict[str, Any]:
    result: dict[str, Any] = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    return result


def generate_refresh_token() -> str:
    return secrets.token_hex(32)


def hash_refresh_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


def refresh_token_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)


def generate_verification_token() -> str:
    return secrets.token_hex(32)


# ── 2FA (TOTP) ───────────────────────────────────────────────────────────────

def generate_totp_secret() -> str:
    return pyotp.random_base32()


def verify_totp(secret: str, code: str) -> bool:
    if not secret or not code or len(code) != 6:
        return False
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)


def get_totp_uri(secret: str, email: str, issuer: str = "PlannerHub") -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=issuer)


def create_2fa_pending_token(user_id: int, email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=TOTP_PENDING_EXPIRE_MINUTES)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "email": email,
        "purpose": "2fa_pending",
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    return str(jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM))


def decode_2fa_pending_token(token: str) -> dict[str, Any]:
    payload: dict[str, Any] = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    if payload.get("purpose") != "2fa_pending":
        raise ValueError("Invalid token purpose")
    return payload