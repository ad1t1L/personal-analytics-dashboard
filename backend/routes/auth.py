import base64
import io
import logging
import secrets as sec
from datetime import datetime, timedelta, timezone
from typing import Any

import qrcode
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy.orm import Session

from backend.dependencies import get_db, get_current_user
from backend.models import User, EmailVerificationToken, RefreshToken, Email2FACode, PasswordResetToken
from backend.security import (
    hash_password, verify_password,
    create_access_token,
    generate_refresh_token, hash_refresh_token, refresh_token_expiry,
    generate_verification_token,
    generate_totp_secret, verify_totp, get_totp_uri,
    create_2fa_pending_token, decode_2fa_pending_token,
)
from backend.email_utils import send_verification_email, send_2fa_code_email, send_password_reset_email
from backend.config import (
    DISABLE_SMTP_SENDING,
    EMAIL_2FA_CODE_EXPIRE_MINUTES,
    MIN_PASSWORD_LENGTH,
    PASSWORD_RESET_TOKEN_EXPIRE_HOURS,
    VERIFICATION_TOKEN_EXPIRE_HOURS,
)

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    """Current UTC time. Use for expiry checks."""
    return datetime.now(timezone.utc)


def _ensure_utc(dt: datetime) -> datetime:
    """
    Normalize datetime for comparison. SQLite returns naive datetimes; assume UTC.
    MySQL: returns naive by default; same assumption applies.
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


# ── Schemas ───────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    name:     str
    email:    EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < MIN_PASSWORD_LENGTH:
            raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one number")
        return v

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip()


class TokenResponse(BaseModel):
    """When token_type='2fa_pending', refresh_token holds the short-lived 2FA JWT."""
    access_token:  str
    refresh_token: str
    token_type:    str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class Login2FARequest(BaseModel):
    pending_2fa_token: str
    code: str  # 6-digit code (from authenticator app or email)


class SendEmail2FARequest(BaseModel):
    pending_2fa_token: str


class TwoFAVerifyRequest(BaseModel):
    code: str  # 6-digit TOTP code


# ── Register ──────────────────────────────────────────────────────────────────

@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    email = str(body.email).lower().strip()

    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail="An account with this email already exists. Please sign in instead."
        )
    user = User(
        name          = body.name.strip(),
        email         = email,
        password_hash = hash_password(body.password),
        is_verified   = bool(DISABLE_SMTP_SENDING),
        is_active     = True,
    )
    db.add(user)
    db.flush()

    if not DISABLE_SMTP_SENDING:
        raw_token = generate_verification_token()
        token_row = EmailVerificationToken(
            user_id    = user.id,
            token      = raw_token,
            expires_at = _utc_now() + timedelta(hours=VERIFICATION_TOKEN_EXPIRE_HOURS),
        )
        db.add(token_row)
    db.commit()

    if not DISABLE_SMTP_SENDING:
        try:
            send_verification_email(to=email, name=str(user.name), token=raw_token)
        except Exception:
            logger.exception(
                "Failed to send verification email (check SMTP_* and FROM_EMAIL in .env; see server logs)"
            )

    if DISABLE_SMTP_SENDING:
        return {"message": "Account created. (SMTP disabled: email verification skipped.)"}
    return {"message": "If that email is new, a verification link has been sent."}


# ── Verify email ──────────────────────────────────────────────────────────────

@router.get("/verify")
def verify_email(token: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    token_row = (
        db.query(EmailVerificationToken)
        .filter(EmailVerificationToken.token == token)
        .first()
    )

    if not token_row:
        raise HTTPException(status_code=400, detail="Invalid or already used verification link")

    if _ensure_utc(token_row.expires_at) < _utc_now():
        db.delete(token_row)
        db.commit()
        raise HTTPException(status_code=400, detail="Verification link has expired. Please request a new one.")

    user = token_row.user
    user.is_verified = True
    db.delete(token_row)
    db.commit()

    return {"message": "Email verified. You can now log in."}


# ── Login ─────────────────────────────────────────────────────────────────────
# When 2FA is enabled, returns token_type="2fa_pending" and refresh_token holds
# the short-lived JWT. Client must call /auth/2fa/send-email-code (if email 2FA)
# then /auth/login/2fa with the code to get access/refresh tokens.
# MySQL: no changes; same queries work.

@router.post("/login", response_model=TokenResponse)
def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db:   Session = Depends(get_db),
) -> TokenResponse:
    email = form.username.lower().strip()
    user  = db.query(User).filter(User.email == email).first()

    dummy_hash  = "$2b$12$notarealhashXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
    stored_hash: str = str(user.password_hash) if user else dummy_hash

    if not user or not verify_password(form.password, stored_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not bool(user.is_active):
        raise HTTPException(status_code=400, detail="Account is disabled")
    if not bool(user.is_verified):
        raise HTTPException(status_code=403, detail="Please verify your email before logging in")

    # If 2FA is enabled (authenticator app and/or email), return a short-lived pending token
    if bool(user.totp_enabled) or bool(user.email_2fa_enabled):
        pending = create_2fa_pending_token(int(user.id), str(user.email))

        # Auto-send email 2FA code when user has email 2FA enabled (better UX)
        if bool(user.email_2fa_enabled):
            code = "".join(sec.choice("0123456789") for _ in range(6))
            expires_at = _utc_now() + timedelta(minutes=EMAIL_2FA_CODE_EXPIRE_MINUTES)
            db.query(Email2FACode).filter(Email2FACode.user_id == user.id).delete()
            db.add(Email2FACode(user_id=user.id, code=code, expires_at=expires_at))
            db.commit()
            try:
                send_2fa_code_email(to=str(user.email), name=str(user.name), code=code)
            except Exception:
                logger.exception("Failed to send email 2FA code at login")

        return TokenResponse(
            access_token="",
            refresh_token=pending,
            token_type="2fa_pending",
        )

    access_token = create_access_token(int(user.id), str(user.email))
    raw_refresh  = generate_refresh_token()

    db.add(RefreshToken(
        user_id    = user.id,
        token_hash = hash_refresh_token(raw_refresh),
        expires_at = refresh_token_expiry(),
    ))

    user.last_login = _utc_now()
    db.commit()

    return TokenResponse(access_token=access_token, refresh_token=raw_refresh)


# ── Send 2FA code to email (when user chose email 2FA at login) ───────────────
# Replaces any existing code for the user. MySQL: same; consider adding index on
# (user_id, expires_at) for large email_2fa_codes tables.

@router.post("/2fa/send-email-code")
def send_email_2fa_code(body: SendEmail2FARequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    try:
        payload = decode_2fa_pending_token(body.pending_2fa_token)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired 2FA request. Please log in again.")

    user_id = int(payload["sub"])
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.email_2fa_enabled:
        raise HTTPException(status_code=400, detail="Email 2FA is not enabled for this account.")

    code = "".join(sec.choice("0123456789") for _ in range(6))
    expires_at = _utc_now() + timedelta(minutes=EMAIL_2FA_CODE_EXPIRE_MINUTES)

    # SQLite: delete + add in same transaction. MySQL: same behavior.
    db.query(Email2FACode).filter(Email2FACode.user_id == user.id).delete()
    db.add(Email2FACode(user_id=user.id, code=code, expires_at=expires_at))
    db.commit()

    try:
        send_2fa_code_email(to=str(user.email), name=str(user.name), code=code)
    except Exception:
        logger.exception("Failed to send email 2FA code")

    return {"message": "Verification code sent to your email."}


# ── Login with 2FA code (after password login returned 2fa_pending) ───────────
# Accepts TOTP code (authenticator app) or email code. Tries TOTP first if enabled.
# MySQL: same; use DATETIME for expires_at (MySQL returns naive by default).

@router.post("/login/2fa", response_model=TokenResponse)
def login_2fa(body: Login2FARequest, db: Session = Depends(get_db)) -> TokenResponse:
    try:
        payload = decode_2fa_pending_token(body.pending_2fa_token)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired 2FA request. Please log in again.")

    user_id = int(payload["sub"])
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="2FA not enabled for this account.")
    if not user.totp_enabled and not user.email_2fa_enabled:
        raise HTTPException(status_code=400, detail="2FA not enabled for this account.")

    code = body.code.strip()
    verified = False

    # Try authenticator app (TOTP) first
    if user.totp_enabled and user.totp_secret and verify_totp(user.totp_secret, code):
        verified = True

    # Try email code if not verified by TOTP
    if not verified and user.email_2fa_enabled:
        now = _utc_now()
        # Compare with normalized UTC. SQLite returns naive; MySQL same.
        row = (
            db.query(Email2FACode)
            .filter(
                Email2FACode.user_id == user.id,
                Email2FACode.code == code,
                Email2FACode.expires_at > now,
            )
            .first()
        )
        if row:
            db.delete(row)
            verified = True

    if not verified:
        raise HTTPException(status_code=401, detail="Invalid or expired code.")

    access_token = create_access_token(int(user.id), str(user.email))
    raw_refresh = generate_refresh_token()
    db.add(RefreshToken(
        user_id=user.id,
        token_hash=hash_refresh_token(raw_refresh),
        expires_at=refresh_token_expiry(),
    ))
    user.last_login = _utc_now()
    db.commit()

    return TokenResponse(access_token=access_token, refresh_token=raw_refresh)


# ── Refresh ───────────────────────────────────────────────────────────────────

@router.post("/refresh", response_model=TokenResponse)
def refresh_access_token(body: RefreshRequest, db: Session = Depends(get_db)) -> TokenResponse:
    token_hash = hash_refresh_token(body.refresh_token)
    row = (
        db.query(RefreshToken)
        .filter(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked    == False,
        )
        .first()
    )

    if not row or _ensure_utc(row.expires_at) < _utc_now():
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    user = row.user
    if not bool(user.is_active) or not bool(user.is_verified):
        raise HTTPException(status_code=401, detail="Account is not accessible")

    row.revoked     = True
    new_access      = create_access_token(int(user.id), str(user.email))
    new_raw_refresh = generate_refresh_token()

    db.add(RefreshToken(
        user_id    = user.id,
        token_hash = hash_refresh_token(new_raw_refresh),
        expires_at = refresh_token_expiry(),
    ))
    db.commit()

    return TokenResponse(access_token=new_access, refresh_token=new_raw_refresh)


# ── Logout ────────────────────────────────────────────────────────────────────

@router.post("/logout")
def logout(body: RefreshRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    token_hash = hash_refresh_token(body.refresh_token)
    row = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).first()
    if row:
        row.revoked = True
        db.commit()
    return {"message": "Logged out successfully"}


# ── Resend verification ───────────────────────────────────────────────────────

@router.post("/resend-verification")
def resend_verification(email: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    email = email.lower().strip()
    user  = db.query(User).filter(User.email == email).first()

    if user and not bool(user.is_verified):
        db.query(EmailVerificationToken).filter(
            EmailVerificationToken.user_id == user.id
        ).delete()

        raw_token = generate_verification_token()
        db.add(EmailVerificationToken(
            user_id    = user.id,
            token      = raw_token,
            expires_at = _utc_now() + timedelta(hours=VERIFICATION_TOKEN_EXPIRE_HOURS),
        ))
        db.commit()

        try:
            send_verification_email(to=email, name=str(user.name), token=raw_token)
        except Exception:
            logger.exception("Failed to send verification email (resend)")

    return {"message": "If that email is registered and unverified, a new link has been sent."}


# ── 2FA setup (authenticated) ───────────────────────────────────────────────
# TOTP: setup generates secret, user scans QR, verify enables. Email 2FA: enable
# without code; code sent at login. MySQL: totp_secret VARCHAR(32), same schema.

@router.get("/2fa/status")
def get_2fa_status(user: User = Depends(get_current_user)) -> dict[str, Any]:
    return {
        "totp_enabled": bool(user.totp_enabled),
        "email_2fa_enabled": bool(user.email_2fa_enabled),
    }


@router.post("/2fa/setup")
def setup_2fa(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if user.totp_enabled:
        raise HTTPException(status_code=400, detail="2FA is already enabled.")
    secret = generate_totp_secret()
    user.totp_secret = secret
    user.totp_enabled = False  # enable only after verify
    db.commit()
    uri = get_totp_uri(secret, str(user.email))
    # QR code as base64 PNG for authenticator apps
    qr = qrcode.make(uri)
    buf = io.BytesIO()
    qr.save(buf, format="PNG")
    qr_base64 = base64.b64encode(buf.getvalue()).decode()
    return {"secret": secret, "provisioning_uri": uri, "qr_base64": qr_base64}


@router.post("/2fa/verify")
def verify_2fa(
    body: TwoFAVerifyRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if not user.totp_secret:
        raise HTTPException(status_code=400, detail="Start 2FA setup first.")
    if user.totp_enabled:
        raise HTTPException(status_code=400, detail="2FA is already enabled.")
    if not verify_totp(user.totp_secret, body.code.strip()):
        raise HTTPException(status_code=400, detail="Invalid or expired code.")
    user.totp_enabled = True
    db.commit()
    return {"message": "2FA is now enabled."}


@router.post("/2fa/disable")
def disable_2fa(
    body: TwoFAVerifyRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if not user.totp_enabled or not user.totp_secret:
        raise HTTPException(status_code=400, detail="Authenticator 2FA is not enabled.")
    if not verify_totp(user.totp_secret, body.code.strip()):
        raise HTTPException(status_code=400, detail="Invalid or expired code.")
    user.totp_secret = None
    user.totp_enabled = False
    db.commit()
    return {"message": "Authenticator 2FA has been disabled."}


@router.post("/2fa/enable-email")
def enable_email_2fa(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if user.email_2fa_enabled:
        raise HTTPException(status_code=400, detail="Email 2FA is already enabled.")
    user.email_2fa_enabled = True
    db.commit()
    return {"message": "Email 2FA is now enabled. You can request a code at login."}


@router.post("/2fa/disable-email")
def disable_email_2fa(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if not user.email_2fa_enabled:
        raise HTTPException(status_code=400, detail="Email 2FA is not enabled.")
    user.email_2fa_enabled = False
    db.query(Email2FACode).filter(Email2FACode.user_id == user.id).delete()
    db.commit()
    return {"message": "Email 2FA has been disabled."}


# ── Forgot password ───────────────────────────────────────────────────────────

class ForgotPasswordRequest(BaseModel):
    email: EmailStr


@router.post("/forgot-password")
def forgot_password(body: ForgotPasswordRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    """
    Always returns the same success message regardless of whether the email
    exists — this prevents user enumeration (attackers can't probe which
    accounts exist by watching different responses).
    """
    email = str(body.email).lower().strip()
    user  = db.query(User).filter(User.email == email).first()

    if user and bool(user.is_active):
        # Invalidate any existing unused reset tokens for this user
        db.query(PasswordResetToken).filter(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used    == False,
        ).delete()

        raw_token = generate_verification_token()
        db.add(PasswordResetToken(
            user_id    = user.id,
            token      = raw_token,
            expires_at = datetime.now(timezone.utc) + timedelta(hours=PASSWORD_RESET_TOKEN_EXPIRE_HOURS),
        ))
        db.commit()

        try:
            send_password_reset_email(to=email, name=str(user.name), token=raw_token)
        except Exception:
            logger.exception("Failed to send password reset email")

    return {"message": "If that email is registered, a password reset link has been sent."}


# ── Reset password ────────────────────────────────────────────────────────────

class ResetPasswordRequest(BaseModel):
    token:    str
    password: str

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < MIN_PASSWORD_LENGTH:
            raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one number")
        return v


@router.post("/reset-password")
def reset_password(body: ResetPasswordRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    token_row = (
        db.query(PasswordResetToken)
        .filter(
            PasswordResetToken.token == body.token,
            PasswordResetToken.used  == False,
        )
        .first()
    )

    if not token_row:
        raise HTTPException(status_code=400, detail="Invalid or already used reset link.")

    # Compare naive datetimes (DB stores naive UTC)
    expires = token_row.expires_at
    now     = datetime.now(timezone.utc).replace(tzinfo=None)
    if expires < now:
        db.delete(token_row)
        db.commit()
        raise HTTPException(status_code=400, detail="Reset link has expired. Please request a new one.")

    user = token_row.user
    user.password_hash = hash_password(body.password)

    # Mark token used and revoke all refresh tokens (force re-login everywhere)
    token_row.used = True
    db.query(RefreshToken).filter(RefreshToken.user_id == user.id).update({"revoked": True})

    db.commit()
    return {"message": "Password reset successfully. You can now log in with your new password."}


# ── Change password (authenticated) ──────────────────────────────────────────

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < MIN_PASSWORD_LENGTH:
            raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one number")
        return v


@router.post("/change-password")
def change_password(
    body: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Change password for the currently authenticated user."""
    if not verify_password(body.current_password, str(current_user.password_hash)):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")

    current_user.password_hash = hash_password(body.new_password)

    # Revoke all refresh tokens so other sessions are logged out
    db.query(RefreshToken).filter(
        RefreshToken.user_id == current_user.id
    ).update({"revoked": True})

    db.commit()
    return {"message": "Password changed successfully."}