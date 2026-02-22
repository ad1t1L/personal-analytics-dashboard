from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy.orm import Session

from backend.dependencies import get_db
from backend.models import User, EmailVerificationToken, RefreshToken, PasswordResetToken
from backend.security import (
    hash_password, verify_password,
    create_access_token,
    generate_refresh_token, hash_refresh_token, refresh_token_expiry,
    generate_verification_token,
)
from backend.email_utils import send_verification_email, send_password_reset_email
from backend.config import MIN_PASSWORD_LENGTH, VERIFICATION_TOKEN_EXPIRE_HOURS, PASSWORD_RESET_TOKEN_EXPIRE_HOURS

router = APIRouter(prefix="/auth", tags=["auth"])


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
    access_token:  str
    refresh_token: str
    token_type:    str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


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
        is_verified   = False,
        is_active     = True,
    )
    db.add(user)
    db.flush()

    raw_token = generate_verification_token()
    token_row = EmailVerificationToken(
        user_id    = user.id,
        token      = raw_token,
        expires_at = datetime.now(timezone.utc) + timedelta(hours=VERIFICATION_TOKEN_EXPIRE_HOURS),
    )
    db.add(token_row)
    db.commit()

    try:
        send_verification_email(to=email, name=str(user.name), token=raw_token)
    except Exception:
        pass

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

    if token_row.expires_at < datetime.now(timezone.utc).replace(tzinfo=None):
        db.delete(token_row)
        db.commit()
        raise HTTPException(status_code=400, detail="Verification link has expired. Please request a new one.")

    user = token_row.user
    user.is_verified = True
    db.delete(token_row)
    db.commit()

    return {"message": "Email verified. You can now log in."}


# ── Login ─────────────────────────────────────────────────────────────────────

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

    access_token = create_access_token(int(user.id), str(user.email))
    raw_refresh  = generate_refresh_token()

    db.add(RefreshToken(
        user_id    = user.id,
        token_hash = hash_refresh_token(raw_refresh),
        expires_at = refresh_token_expiry(),
    ))

    user.last_login = datetime.now(timezone.utc)
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

    if not row or row.expires_at < datetime.now(timezone.utc):
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
            expires_at = datetime.now(timezone.utc) + timedelta(hours=VERIFICATION_TOKEN_EXPIRE_HOURS),
        ))
        db.commit()

        try:
            send_verification_email(to=email, name=str(user.name), token=raw_token)
        except Exception:
            pass

    return {"message": "If that email is registered and unverified, a new link has been sent."}


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
            pass

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