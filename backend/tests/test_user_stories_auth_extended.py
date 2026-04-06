"""
Auth: password reset flow, email verification, 2FA (TOTP + email 2FA).

Covers the untested 54% of backend/routes/auth.py:
  GET  /auth/verify                  — email token (valid, expired, invalid)
  POST /auth/resend-verification     — resend email for unverified account
  POST /auth/forgot-password         — always returns same message (enum-safe)
  POST /auth/reset-password          — valid, expired, invalid, weak password
  POST /auth/2fa/setup               — generate secret + QR
  POST /auth/2fa/verify              — enable with correct / wrong TOTP code
  POST /auth/2fa/disable             — disable TOTP 2FA
  POST /auth/2fa/enable-email        — enable email 2FA flag
  POST /auth/2fa/disable-email       — disable email 2FA flag
  POST /auth/2fa/send-email-code     — inject code and call the endpoint
  POST /auth/login/2fa               — complete login with email code
  POST /auth/login                   — triggers 2fa_pending path when 2FA on
"""

from __future__ import annotations

import bootstrap_sys_path  # noqa: F401

from datetime import datetime, timedelta, timezone

import pyotp
import pytest

from backend.models import (
    Email2FACode,
    EmailVerificationToken,
    PasswordResetToken,
    User,
)
from backend.security import hash_password
from backend.tests.helpers import auth_headers, login_form, register_verified_user


# ── Helpers ───────────────────────────────────────────────────────────────────

def _utcnow():
    return datetime.now(timezone.utc)


def _register_unverified(client, db_session, *, email="unv@example.com", password="Unverif1"):
    """Insert an unverified user directly into the test DB."""
    user = User(
        name="Unverified",
        email=email,
        password_hash=hash_password(password),
        is_verified=False,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    return user


# ── Email verification ────────────────────────────────────────────────────────

class TestEmailVerification:
    def test_valid_token_verifies_user(self, client, db_session):
        user = _register_unverified(client, db_session, email="verify1@example.com")
        raw = "validtoken123"
        db_session.add(EmailVerificationToken(
            user_id=user.id,
            token=raw,
            expires_at=_utcnow() + timedelta(hours=24),
        ))
        db_session.commit()

        r = client.get(f"/auth/verify?token={raw}")
        assert r.status_code == 200
        assert "verified" in r.json()["message"].lower()

        db_session.refresh(user)
        assert user.is_verified is True

    def test_expired_token_returns_400(self, client, db_session):
        user = _register_unverified(client, db_session, email="verify2@example.com")
        raw = "expiredtoken456"
        db_session.add(EmailVerificationToken(
            user_id=user.id,
            token=raw,
            expires_at=_utcnow() - timedelta(hours=1),
        ))
        db_session.commit()

        r = client.get(f"/auth/verify?token={raw}")
        assert r.status_code == 400
        assert "expired" in r.json()["detail"].lower()

    def test_invalid_token_returns_400(self, client):
        r = client.get("/auth/verify?token=doesnotexist")
        assert r.status_code == 400

    def test_token_deleted_after_use(self, client, db_session):
        user = _register_unverified(client, db_session, email="verify3@example.com")
        raw = "onceonly789"
        db_session.add(EmailVerificationToken(
            user_id=user.id,
            token=raw,
            expires_at=_utcnow() + timedelta(hours=24),
        ))
        db_session.commit()

        client.get(f"/auth/verify?token={raw}")
        row = db_session.query(EmailVerificationToken).filter_by(token=raw).first()
        assert row is None


class TestResendVerification:
    def test_resend_for_unverified_email_returns_200(self, client, db_session):
        _register_unverified(client, db_session, email="resend@example.com")
        r = client.post("/auth/resend-verification?email=resend@example.com")
        assert r.status_code == 200

    def test_resend_for_unknown_email_still_returns_200(self, client):
        r = client.post("/auth/resend-verification?email=ghost@example.com")
        assert r.status_code == 200


# ── Password reset ────────────────────────────────────────────────────────────

class TestForgotPassword:
    def test_always_returns_200_and_same_message(self, client):
        for email in ("exists@example.com", "ghost2@example.com"):
            r = client.post("/auth/forgot-password", json={"email": email})
            assert r.status_code == 200
            assert "reset link" in r.json()["message"].lower()

    def test_invalid_email_format_returns_422(self, client):
        r = client.post("/auth/forgot-password", json={"email": "not-an-email"})
        assert r.status_code == 422


class TestResetPassword:
    def _make_reset_token(self, db_session, user: User, raw: str, expired: bool = False):
        now = datetime.now(timezone.utc)
        expires = (now - timedelta(hours=1)) if expired else (now + timedelta(hours=1))
        db_session.add(PasswordResetToken(
            user_id=user.id,
            token=raw,
            expires_at=expires.replace(tzinfo=None),
        ))
        db_session.commit()

    def test_valid_token_resets_password(self, client, db_session):
        user = _register_unverified(client, db_session,
                                    email="reset1@example.com", password="OldPass11")
        user.is_verified = True
        db_session.commit()
        self._make_reset_token(db_session, user, "goodtoken1")

        r = client.post("/auth/reset-password",
                        json={"token": "goodtoken1", "password": "NewPass11"})
        assert r.status_code == 200
        assert login_form(client, "reset1@example.com", "NewPass11").status_code == 200

    def test_invalid_token_returns_400(self, client):
        r = client.post("/auth/reset-password",
                        json={"token": "badtoken", "password": "NewPass11"})
        assert r.status_code == 400

    def test_expired_token_returns_400(self, client, db_session):
        user = _register_unverified(client, db_session, email="reset2@example.com")
        self._make_reset_token(db_session, user, "expiredtok", expired=True)
        r = client.post("/auth/reset-password",
                        json={"token": "expiredtok", "password": "NewPass11"})
        assert r.status_code == 400
        assert "expired" in r.json()["detail"].lower()

    def test_weak_password_returns_422(self, client, db_session):
        user = _register_unverified(client, db_session, email="reset3@example.com")
        self._make_reset_token(db_session, user, "weaktoken1")
        r = client.post("/auth/reset-password",
                        json={"token": "weaktoken1", "password": "weak"})
        assert r.status_code == 422

    def test_used_token_cannot_be_reused(self, client, db_session):
        user = _register_unverified(client, db_session,
                                    email="reset4@example.com", password="OldPass11")
        user.is_verified = True
        db_session.commit()
        self._make_reset_token(db_session, user, "oncetoken1")

        client.post("/auth/reset-password",
                    json={"token": "oncetoken1", "password": "NewPass11"})
        r = client.post("/auth/reset-password",
                        json={"token": "oncetoken1", "password": "AnotherP1"})
        assert r.status_code == 400


# ── TOTP 2FA ──────────────────────────────────────────────────────────────────

@pytest.fixture
def verified_user_token(client):
    register_verified_user(client, email="totp@example.com",
                           password="TotpUser1", name="TOTP User")
    r = login_form(client, "totp@example.com", "TotpUser1")
    return r.json()["access_token"]


class TestTOTP2FA:
    def test_setup_returns_secret_and_qr(self, client, verified_user_token):
        r = client.post("/auth/2fa/setup", headers=auth_headers(verified_user_token))
        assert r.status_code == 200
        data = r.json()
        assert "secret" in data
        assert "qr_base64" in data
        assert "provisioning_uri" in data

    def test_setup_twice_raises_400(self, client, verified_user_token, db_session):
        # Enable TOTP directly in DB
        user = db_session.query(User).filter_by(email="totp@example.com").first()
        user.totp_enabled = True
        db_session.commit()
        r = client.post("/auth/2fa/setup", headers=auth_headers(verified_user_token))
        assert r.status_code == 400

    def test_verify_with_correct_code_enables_totp(self, client, verified_user_token, db_session):
        setup_r = client.post("/auth/2fa/setup", headers=auth_headers(verified_user_token))
        secret = setup_r.json()["secret"]
        code = pyotp.TOTP(secret).now()

        r = client.post("/auth/2fa/verify",
                        headers=auth_headers(verified_user_token),
                        json={"code": code})
        assert r.status_code == 200
        user = db_session.query(User).filter_by(email="totp@example.com").first()
        db_session.refresh(user)
        assert user.totp_enabled is True

    def test_verify_with_wrong_code_returns_400(self, client, verified_user_token):
        client.post("/auth/2fa/setup", headers=auth_headers(verified_user_token))
        r = client.post("/auth/2fa/verify",
                        headers=auth_headers(verified_user_token),
                        json={"code": "000000"})
        assert r.status_code == 400

    def test_disable_totp_with_correct_code(self, client, verified_user_token, db_session):
        setup_r = client.post("/auth/2fa/setup", headers=auth_headers(verified_user_token))
        secret = setup_r.json()["secret"]
        code = pyotp.TOTP(secret).now()
        client.post("/auth/2fa/verify",
                    headers=auth_headers(verified_user_token),
                    json={"code": code})

        code2 = pyotp.TOTP(secret).now()
        r = client.post("/auth/2fa/disable",
                        headers=auth_headers(verified_user_token),
                        json={"code": code2})
        assert r.status_code == 200
        user = db_session.query(User).filter_by(email="totp@example.com").first()
        db_session.refresh(user)
        assert user.totp_enabled is False

    def test_disable_totp_with_wrong_code_returns_400(self, client, verified_user_token, db_session):
        setup_r = client.post("/auth/2fa/setup", headers=auth_headers(verified_user_token))
        secret = setup_r.json()["secret"]
        code = pyotp.TOTP(secret).now()
        client.post("/auth/2fa/verify",
                    headers=auth_headers(verified_user_token),
                    json={"code": code})
        r = client.post("/auth/2fa/disable",
                        headers=auth_headers(verified_user_token),
                        json={"code": "000000"})
        assert r.status_code == 400


# ── Email 2FA ─────────────────────────────────────────────────────────────────

@pytest.fixture
def email2fa_token(client):
    register_verified_user(client, email="e2fa@example.com",
                           password="E2faPass1", name="Email2FA User")
    r = login_form(client, "e2fa@example.com", "E2faPass1")
    return r.json()["access_token"]


class TestEmail2FA:
    def test_enable_email_2fa(self, client, email2fa_token, db_session):
        r = client.post("/auth/2fa/enable-email",
                        headers=auth_headers(email2fa_token))
        assert r.status_code == 200
        user = db_session.query(User).filter_by(email="e2fa@example.com").first()
        db_session.refresh(user)
        assert user.email_2fa_enabled is True

    def test_enable_email_2fa_twice_returns_400(self, client, email2fa_token, db_session):
        client.post("/auth/2fa/enable-email", headers=auth_headers(email2fa_token))
        r = client.post("/auth/2fa/enable-email", headers=auth_headers(email2fa_token))
        assert r.status_code == 400

    def test_disable_email_2fa(self, client, email2fa_token, db_session):
        client.post("/auth/2fa/enable-email", headers=auth_headers(email2fa_token))
        r = client.post("/auth/2fa/disable-email", headers=auth_headers(email2fa_token))
        assert r.status_code == 200
        user = db_session.query(User).filter_by(email="e2fa@example.com").first()
        db_session.refresh(user)
        assert user.email_2fa_enabled is False

    def test_disable_email_2fa_when_not_enabled_returns_400(self, client, email2fa_token):
        r = client.post("/auth/2fa/disable-email", headers=auth_headers(email2fa_token))
        assert r.status_code == 400

    def test_login_returns_2fa_pending_when_email_2fa_enabled(
        self, client, email2fa_token, db_session
    ):
        client.post("/auth/2fa/enable-email", headers=auth_headers(email2fa_token))
        r = login_form(client, "e2fa@example.com", "E2faPass1")
        assert r.status_code == 200
        assert r.json()["token_type"] == "2fa_pending"

    def test_login_2fa_with_injected_code_succeeds(
        self, client, email2fa_token, db_session
    ):
        client.post("/auth/2fa/enable-email", headers=auth_headers(email2fa_token))
        login_r = login_form(client, "e2fa@example.com", "E2faPass1")
        pending_token = login_r.json()["refresh_token"]

        # Inject a known code directly into the DB
        user = db_session.query(User).filter_by(email="e2fa@example.com").first()
        code = "123456"
        expires = _utcnow() + timedelta(minutes=10)
        db_session.query(Email2FACode).filter_by(user_id=user.id).delete()
        db_session.add(Email2FACode(
            user_id=user.id, code=code, expires_at=expires
        ))
        db_session.commit()

        r = client.post("/auth/login/2fa",
                        json={"pending_2fa_token": pending_token, "code": code})
        assert r.status_code == 200
        assert r.json()["token_type"] == "bearer"
        assert r.json()["access_token"]

    def test_login_2fa_with_wrong_code_returns_401(
        self, client, email2fa_token, db_session
    ):
        client.post("/auth/2fa/enable-email", headers=auth_headers(email2fa_token))
        login_r = login_form(client, "e2fa@example.com", "E2faPass1")
        pending_token = login_r.json()["refresh_token"]

        r = client.post("/auth/login/2fa",
                        json={"pending_2fa_token": pending_token, "code": "000000"})
        assert r.status_code == 401

    def test_send_email_code_endpoint(self, client, email2fa_token, db_session):
        client.post("/auth/2fa/enable-email", headers=auth_headers(email2fa_token))
        login_r = login_form(client, "e2fa@example.com", "E2faPass1")
        pending_token = login_r.json()["refresh_token"]

        r = client.post("/auth/2fa/send-email-code",
                        json={"pending_2fa_token": pending_token})
        assert r.status_code == 200
        assert "sent" in r.json()["message"].lower()

    def test_send_email_code_with_invalid_token_returns_400(self, client):
        r = client.post("/auth/2fa/send-email-code",
                        json={"pending_2fa_token": "notvalid"})
        assert r.status_code == 400
