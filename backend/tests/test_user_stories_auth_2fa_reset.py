"""
Auth flows not covered by test_user_stories_auth.py:

  - Email verification token flow
  - Disabled account rejection
  - Forgot/reset password flow
  - TOTP 2FA: setup, verify (enable), disable, login
  - Email 2FA: enable, disable, send-code, full login flow
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta

import pyotp
import pytest

from backend.tests.helpers import auth_headers, login_form, register_verified_user


# ── Email verification ─────────────────────────────────────────────────────────

class TestEmailVerification:

    def test_valid_token_verifies_user(self, client, db_session):
        from backend.models import User, EmailVerificationToken
        from backend.security import hash_password

        user = User(
            name="Verify", email="verify@example.com",
            password_hash=hash_password("Verify1"),
            is_verified=False, is_active=True,
        )
        db_session.add(user)
        db_session.flush()

        raw_token = "valid_verify_token"
        db_session.add(EmailVerificationToken(
            user_id=user.id, token=raw_token,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
        ))
        db_session.commit()

        r = client.get(f"/auth/verify?token={raw_token}")
        assert r.status_code == 200
        assert "verified" in r.json()["message"].lower()

    def test_expired_token_returns_400(self, client, db_session):
        from backend.models import User, EmailVerificationToken
        from backend.security import hash_password

        user = User(
            name="Expired", email="expired@example.com",
            password_hash=hash_password("Expire1"),
            is_verified=False, is_active=True,
        )
        db_session.add(user)
        db_session.flush()

        db_session.add(EmailVerificationToken(
            user_id=user.id, token="expired_verify_token",
            expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
        ))
        db_session.commit()

        r = client.get("/auth/verify?token=expired_verify_token")
        assert r.status_code == 400

    def test_invalid_token_returns_400(self, client):
        r = client.get("/auth/verify?token=completelyfaketoken")
        assert r.status_code == 400

    def test_verified_user_can_login(self, client, db_session):
        """After verification the user should be able to log in."""
        from backend.models import User, EmailVerificationToken
        from backend.security import hash_password

        user = User(
            name="PostVerify", email="postverify@example.com",
            password_hash=hash_password("PostVerify1"),
            is_verified=False, is_active=True,
        )
        db_session.add(user)
        db_session.flush()

        raw_token = "postverify_token"
        db_session.add(EmailVerificationToken(
            user_id=user.id, token=raw_token,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
        ))
        db_session.commit()

        client.get(f"/auth/verify?token={raw_token}")
        r = login_form(client, "postverify@example.com", "PostVerify1")
        assert r.status_code == 200


# ── Disabled account ───────────────────────────────────────────────────────────

class TestDisabledAccount:

    def test_inactive_account_cannot_login(self, client, db_session):
        from backend.models import User
        from backend.security import hash_password

        db_session.add(User(
            name="Disabled", email="disabled@example.com",
            password_hash=hash_password("Disable1"),
            is_verified=True, is_active=False,
        ))
        db_session.commit()

        r = login_form(client, "disabled@example.com", "Disable1")
        assert r.status_code == 400


# ── Password reset flow ────────────────────────────────────────────────────────

class TestPasswordReset:

    def test_forgot_password_always_returns_200(self, client):
        r = client.post("/auth/forgot-password", json={"email": "nobody@example.com"})
        assert r.status_code == 200

    def test_forgot_password_for_real_user_also_returns_200(self, client):
        register_verified_user(client, email="fp@example.com", password="ForgotPw1")
        r = client.post("/auth/forgot-password", json={"email": "fp@example.com"})
        assert r.status_code == 200

    def test_reset_with_valid_token_changes_password(self, client, db_session):
        from backend.models import User, PasswordResetToken
        from backend.security import hash_password

        user = User(
            name="Reset", email="reset@example.com",
            password_hash=hash_password("OldPass1"),
            is_verified=True, is_active=True,
        )
        db_session.add(user)
        db_session.flush()

        raw_token = "valid_reset_token"
        db_session.add(PasswordResetToken(
            user_id=user.id, token=raw_token,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            used=False,
        ))
        db_session.commit()

        r = client.post("/auth/reset-password", json={"token": raw_token, "password": "NewPass1"})
        assert r.status_code == 200

        r2 = login_form(client, "reset@example.com", "NewPass1")
        assert r2.status_code == 200

    def test_reset_token_cannot_be_reused(self, client, db_session):
        from backend.models import User, PasswordResetToken
        from backend.security import hash_password

        user = User(
            name="Reuse", email="reuse@example.com",
            password_hash=hash_password("OldPass1"),
            is_verified=True, is_active=True,
        )
        db_session.add(user)
        db_session.flush()

        raw_token = "single_use_token"
        db_session.add(PasswordResetToken(
            user_id=user.id, token=raw_token,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            used=False,
        ))
        db_session.commit()

        client.post("/auth/reset-password", json={"token": raw_token, "password": "NewPass1"})
        r2 = client.post("/auth/reset-password", json={"token": raw_token, "password": "AnotherPass1"})
        assert r2.status_code == 400

    def test_reset_with_invalid_token_returns_400(self, client):
        r = client.post("/auth/reset-password", json={"token": "bogustoken", "password": "NewPass1"})
        assert r.status_code == 400

    def test_reset_with_expired_token_returns_400(self, client, db_session):
        from backend.models import User, PasswordResetToken
        from backend.security import hash_password

        user = User(
            name="Expired2", email="expired2@example.com",
            password_hash=hash_password("OldPass1"),
            is_verified=True, is_active=True,
        )
        db_session.add(user)
        db_session.flush()

        db_session.add(PasswordResetToken(
            user_id=user.id, token="expired_reset_token",
            expires_at=datetime.now(timezone.utc) - timedelta(hours=2),
            used=False,
        ))
        db_session.commit()

        r = client.post("/auth/reset-password", json={"token": "expired_reset_token", "password": "NewPass1"})
        assert r.status_code == 400

    def test_reset_with_already_used_token_returns_400(self, client, db_session):
        from backend.models import User, PasswordResetToken
        from backend.security import hash_password

        user = User(
            name="UsedToken", email="usedtoken@example.com",
            password_hash=hash_password("OldPass1"),
            is_verified=True, is_active=True,
        )
        db_session.add(user)
        db_session.flush()

        db_session.add(PasswordResetToken(
            user_id=user.id, token="already_used_token",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            used=True,
        ))
        db_session.commit()

        r = client.post("/auth/reset-password", json={"token": "already_used_token", "password": "NewPass1"})
        assert r.status_code == 400

    def test_reset_with_weak_password_rejected(self, client, db_session):
        from backend.models import User, PasswordResetToken
        from backend.security import hash_password

        user = User(
            name="WeakPw", email="weakpw@example.com",
            password_hash=hash_password("OldPass1"),
            is_verified=True, is_active=True,
        )
        db_session.add(user)
        db_session.flush()

        db_session.add(PasswordResetToken(
            user_id=user.id, token="weakpw_reset_token",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            used=False,
        ))
        db_session.commit()

        r = client.post("/auth/reset-password", json={"token": "weakpw_reset_token", "password": "weak"})
        assert r.status_code == 422


# ── TOTP 2FA ───────────────────────────────────────────────────────────────────

@pytest.fixture
def totp_auth_token(client):
    register_verified_user(client, email="totp@example.com", password="TotpUser1", name="Totp")
    r = login_form(client, "totp@example.com", "TotpUser1")
    return r.json()["access_token"]


class TestTOTP2FA:

    def test_setup_returns_secret_qr_and_uri(self, client, totp_auth_token):
        r = client.post("/auth/2fa/setup", headers=auth_headers(totp_auth_token))
        assert r.status_code == 200
        data = r.json()
        assert "secret" in data
        assert "qr_base64" in data
        assert "provisioning_uri" in data

    def test_setup_then_verify_enables_totp(self, client, totp_auth_token):
        r = client.post("/auth/2fa/setup", headers=auth_headers(totp_auth_token))
        secret = r.json()["secret"]
        code = pyotp.TOTP(secret).now()

        r2 = client.post("/auth/2fa/verify", headers=auth_headers(totp_auth_token), json={"code": code})
        assert r2.status_code == 200

        status = client.get("/auth/2fa/status", headers=auth_headers(totp_auth_token)).json()
        assert status["totp_enabled"] is True

    def test_verify_rejects_wrong_code(self, client, totp_auth_token):
        client.post("/auth/2fa/setup", headers=auth_headers(totp_auth_token))
        r = client.post("/auth/2fa/verify", headers=auth_headers(totp_auth_token), json={"code": "000000"})
        assert r.status_code == 400

    def test_verify_without_setup_first_returns_400(self, client, totp_auth_token):
        r = client.post("/auth/2fa/verify", headers=auth_headers(totp_auth_token), json={"code": "123456"})
        assert r.status_code == 400

    def test_setup_when_already_enabled_returns_400(self, client, totp_auth_token):
        r = client.post("/auth/2fa/setup", headers=auth_headers(totp_auth_token))
        secret = r.json()["secret"]
        code = pyotp.TOTP(secret).now()
        client.post("/auth/2fa/verify", headers=auth_headers(totp_auth_token), json={"code": code})

        r2 = client.post("/auth/2fa/setup", headers=auth_headers(totp_auth_token))
        assert r2.status_code == 400

    def test_disable_totp_with_valid_code(self, client, totp_auth_token):
        r = client.post("/auth/2fa/setup", headers=auth_headers(totp_auth_token))
        secret = r.json()["secret"]
        code = pyotp.TOTP(secret).now()
        client.post("/auth/2fa/verify", headers=auth_headers(totp_auth_token), json={"code": code})

        disable_code = pyotp.TOTP(secret).now()
        r2 = client.post("/auth/2fa/disable", headers=auth_headers(totp_auth_token), json={"code": disable_code})
        assert r2.status_code == 200

        status = client.get("/auth/2fa/status", headers=auth_headers(totp_auth_token)).json()
        assert status["totp_enabled"] is False

    def test_disable_totp_when_not_enabled_returns_400(self, client, totp_auth_token):
        r = client.post("/auth/2fa/disable", headers=auth_headers(totp_auth_token), json={"code": "000000"})
        assert r.status_code == 400

    def test_login_with_totp_enabled_returns_2fa_pending(self, client, totp_auth_token):
        r = client.post("/auth/2fa/setup", headers=auth_headers(totp_auth_token))
        secret = r.json()["secret"]
        code = pyotp.TOTP(secret).now()
        client.post("/auth/2fa/verify", headers=auth_headers(totp_auth_token), json={"code": code})

        r2 = login_form(client, "totp@example.com", "TotpUser1")
        assert r2.json()["token_type"] == "2fa_pending"

    def test_login_2fa_with_valid_totp_code_returns_bearer_tokens(self, client, totp_auth_token):
        r = client.post("/auth/2fa/setup", headers=auth_headers(totp_auth_token))
        secret = r.json()["secret"]
        code = pyotp.TOTP(secret).now()
        client.post("/auth/2fa/verify", headers=auth_headers(totp_auth_token), json={"code": code})

        r2 = login_form(client, "totp@example.com", "TotpUser1")
        pending_token = r2.json()["refresh_token"]

        totp_code = pyotp.TOTP(secret).now()
        r3 = client.post("/auth/login/2fa", json={"pending_2fa_token": pending_token, "code": totp_code})
        assert r3.status_code == 200
        assert r3.json()["token_type"] == "bearer"
        assert r3.json()["access_token"]

    def test_login_2fa_with_wrong_code_returns_401(self, client, totp_auth_token):
        r = client.post("/auth/2fa/setup", headers=auth_headers(totp_auth_token))
        secret = r.json()["secret"]
        code = pyotp.TOTP(secret).now()
        client.post("/auth/2fa/verify", headers=auth_headers(totp_auth_token), json={"code": code})

        r2 = login_form(client, "totp@example.com", "TotpUser1")
        pending_token = r2.json()["refresh_token"]

        r3 = client.post("/auth/login/2fa", json={"pending_2fa_token": pending_token, "code": "000000"})
        assert r3.status_code == 401

    def test_login_2fa_with_invalid_pending_token_returns_400(self, client):
        r = client.post("/auth/login/2fa", json={"pending_2fa_token": "bogus", "code": "123456"})
        assert r.status_code == 400


# ── Email 2FA ──────────────────────────────────────────────────────────────────

@pytest.fixture
def email2fa_token(client):
    register_verified_user(client, email="e2fa@example.com", password="Email2fa1", name="Email2FA")
    r = login_form(client, "e2fa@example.com", "Email2fa1")
    return r.json()["access_token"]


class TestEmail2FA:

    def test_enable_email_2fa(self, client, email2fa_token):
        r = client.post("/auth/2fa/enable-email", headers=auth_headers(email2fa_token))
        assert r.status_code == 200

        status = client.get("/auth/2fa/status", headers=auth_headers(email2fa_token)).json()
        assert status["email_2fa_enabled"] is True

    def test_enable_email_2fa_when_already_enabled_returns_400(self, client, email2fa_token):
        client.post("/auth/2fa/enable-email", headers=auth_headers(email2fa_token))
        r = client.post("/auth/2fa/enable-email", headers=auth_headers(email2fa_token))
        assert r.status_code == 400

    def test_disable_email_2fa(self, client, email2fa_token):
        client.post("/auth/2fa/enable-email", headers=auth_headers(email2fa_token))
        r = client.post("/auth/2fa/disable-email", headers=auth_headers(email2fa_token))
        assert r.status_code == 200

        status = client.get("/auth/2fa/status", headers=auth_headers(email2fa_token)).json()
        assert status["email_2fa_enabled"] is False

    def test_disable_email_2fa_when_not_enabled_returns_400(self, client, email2fa_token):
        r = client.post("/auth/2fa/disable-email", headers=auth_headers(email2fa_token))
        assert r.status_code == 400

    def test_login_with_email_2fa_enabled_returns_2fa_pending(self, client, email2fa_token):
        client.post("/auth/2fa/enable-email", headers=auth_headers(email2fa_token))
        r = login_form(client, "e2fa@example.com", "Email2fa1")
        assert r.json()["token_type"] == "2fa_pending"

    def test_full_email_2fa_login_flow(self, client, email2fa_token, db_session):
        client.post("/auth/2fa/enable-email", headers=auth_headers(email2fa_token))
        r = login_form(client, "e2fa@example.com", "Email2fa1")
        pending_token = r.json()["refresh_token"]

        # Read the code stored in the DB by the login endpoint
        from backend.models import Email2FACode, User
        db_session.expire_all()
        user = db_session.query(User).filter(User.email == "e2fa@example.com").first()
        code_row = db_session.query(Email2FACode).filter(Email2FACode.user_id == user.id).first()
        assert code_row is not None
        code = code_row.code

        r2 = client.post("/auth/login/2fa", json={"pending_2fa_token": pending_token, "code": code})
        assert r2.status_code == 200
        assert r2.json()["token_type"] == "bearer"
        assert r2.json()["access_token"]

    def test_send_email_2fa_code_with_valid_pending_token(self, client, email2fa_token):
        client.post("/auth/2fa/enable-email", headers=auth_headers(email2fa_token))
        r = login_form(client, "e2fa@example.com", "Email2fa1")
        pending_token = r.json()["refresh_token"]

        r2 = client.post("/auth/2fa/send-email-code", json={"pending_2fa_token": pending_token})
        assert r2.status_code == 200

    def test_send_email_2fa_code_with_invalid_token_returns_400(self, client):
        r = client.post("/auth/2fa/send-email-code", json={"pending_2fa_token": "bogus"})
        assert r.status_code == 400

    def test_email_2fa_wrong_code_returns_401(self, client, email2fa_token):
        client.post("/auth/2fa/enable-email", headers=auth_headers(email2fa_token))
        r = login_form(client, "e2fa@example.com", "Email2fa1")
        pending_token = r.json()["refresh_token"]

        r2 = client.post("/auth/login/2fa", json={"pending_2fa_token": pending_token, "code": "000000"})
        assert r2.status_code == 401
