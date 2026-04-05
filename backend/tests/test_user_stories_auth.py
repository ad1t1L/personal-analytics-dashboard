"""
User stories: #1 secure login, #14 create account, #24 validation on register/profile-related API.

Backend coverage for auth flows; UI-only flows are noted in docstrings.
"""

from __future__ import annotations

import bootstrap_sys_path  # noqa: F401

import pytest

from backend.tests.helpers import auth_headers, login_form, register_verified_user


@pytest.fixture
def verified_user(client):
    """#14 — account created; user verified when SMTP is disabled in tests."""
    email = "newuser@example.com"
    password = "SecurePass1"
    r = register_verified_user(client, email=email, password=password)
    assert r.status_code == 201, r.text
    return {"email": email, "password": password, "name": "New User"}


class TestUserStory1SecureLogin:
    """#1 As a user, I want to log in securely so my information stays safe."""

    def test_login_returns_bearer_tokens(self, client, verified_user):
        r = login_form(client, verified_user["email"], verified_user["password"])
        assert r.status_code == 200
        data = r.json()
        assert data.get("token_type") == "bearer"
        assert data.get("access_token")
        assert data.get("refresh_token")

    def test_login_rejects_wrong_password(self, client, verified_user):
        r = login_form(client, verified_user["email"], "Wrongpass1")
        assert r.status_code == 401

    def test_protected_route_requires_valid_token(self, client, verified_user):
        r = login_form(client, verified_user["email"], verified_user["password"])
        token = r.json()["access_token"]
        tasks = client.get("/tasks/", headers=auth_headers(token))
        assert tasks.status_code == 200

    def test_protected_route_rejects_missing_token(self, client):
        assert client.get("/tasks/").status_code == 401


class TestUserStory14CreateAccount:
    """#14 As a user, I want to create an account so data is saved in one place."""

    def test_register_creates_account(self, client):
        r = register_verified_user(
            client, name="Alice", email="alice@example.com", password="AlicePass1"
        )
        assert r.status_code == 201

    def test_register_rejects_duplicate_email(self, client, verified_user):
        r = register_verified_user(
            client, email=verified_user["email"], password="AnotherPass1"
        )
        assert r.status_code == 400
        assert "already exists" in r.json()["detail"].lower()


class TestUserStory24Validation:
    """#24 Validation errors during account creation (API mirrors profile password rules)."""

    def test_register_rejects_short_password(self, client):
        import backend.config as cfg

        prev = cfg.DISABLE_SMTP_SENDING
        cfg.DISABLE_SMTP_SENDING = True
        try:
            r = client.post(
                "/auth/register",
                json={
                    "name": "Bob",
                    "email": "bob@example.com",
                    "password": "Short1",
                },
            )
        finally:
            cfg.DISABLE_SMTP_SENDING = prev
        assert r.status_code == 422

    def test_register_rejects_password_without_uppercase(self, client):
        import backend.config as cfg

        prev = cfg.DISABLE_SMTP_SENDING
        cfg.DISABLE_SMTP_SENDING = True
        try:
            r = client.post(
                "/auth/register",
                json={
                    "name": "Bob",
                    "email": "bob2@example.com",
                    "password": "lowercase1",
                },
            )
        finally:
            cfg.DISABLE_SMTP_SENDING = prev
        assert r.status_code == 422

    def test_register_rejects_empty_name(self, client):
        import backend.config as cfg

        prev = cfg.DISABLE_SMTP_SENDING
        cfg.DISABLE_SMTP_SENDING = True
        try:
            r = client.post(
                "/auth/register",
                json={
                    "name": "   ",
                    "email": "bob3@example.com",
                    "password": "ValidPass1",
                },
            )
        finally:
            cfg.DISABLE_SMTP_SENDING = prev
        assert r.status_code == 422

    def test_change_password_validates_new_password_strength(self, client, verified_user):
        r = login_form(client, verified_user["email"], verified_user["password"])
        token = r.json()["access_token"]
        r2 = client.post(
            "/auth/change-password",
            headers=auth_headers(token),
            json={"current_password": verified_user["password"], "new_password": "weak"},
        )
        assert r2.status_code == 422


class TestUserStory4ProfileBackend:
    """
    #4 View/update profile — the web Account page uses localStorage for name/email;
    password change and 2FA are backed by these endpoints.
    """

    def test_change_password_with_correct_current_succeeds(self, client, verified_user):
        r = login_form(client, verified_user["email"], verified_user["password"])
        token = r.json()["access_token"]
        r2 = client.post(
            "/auth/change-password",
            headers=auth_headers(token),
            json={
                "current_password": verified_user["password"],
                "new_password": "NewerPass1",
            },
        )
        assert r2.status_code == 200
        r3 = login_form(client, verified_user["email"], "NewerPass1")
        assert r3.status_code == 200

    def test_change_password_rejects_wrong_current_password(self, client, verified_user):
        r = login_form(client, verified_user["email"], verified_user["password"])
        token = r.json()["access_token"]
        r2 = client.post(
            "/auth/change-password",
            headers=auth_headers(token),
            json={"current_password": "WrongOldPw1", "new_password": "NewerPass1"},
        )
        assert r2.status_code == 400

    def test_2fa_status_returns_expected_structure(self, client, verified_user):
        r = login_form(client, verified_user["email"], verified_user["password"])
        token = r.json()["access_token"]
        r2 = client.get("/auth/2fa/status", headers=auth_headers(token))
        assert r2.status_code == 200
        data = r2.json()
        assert "totp_enabled" in data
        assert "email_2fa_enabled" in data
        assert data["totp_enabled"] is False


class TestUserStory1ExtendedLogin:
    """#1 Additional login security tests."""

    def test_unverified_user_cannot_login(self, client, db_session):
        from backend.models import User
        from backend.security import hash_password

        user = User(
            name="Unverified",
            email="unverified@example.com",
            password_hash=hash_password("Unverify1"),
            is_verified=False,
            is_active=True,
        )
        db_session.add(user)
        db_session.commit()

        r = login_form(client, "unverified@example.com", "Unverify1")
        assert r.status_code == 403

    def test_nonexistent_email_returns_401_not_404(self, client):
        r = login_form(client, "ghost@example.com", "AnyPass1")
        assert r.status_code == 401

    def test_refresh_token_returns_new_access_token(self, client, verified_user):
        r = login_form(client, verified_user["email"], verified_user["password"])
        refresh_tok = r.json()["refresh_token"]
        r2 = client.post("/auth/refresh", json={"refresh_token": refresh_tok})
        assert r2.status_code == 200
        assert r2.json()["access_token"]

    def test_logout_invalidates_refresh_token(self, client, verified_user):
        r = login_form(client, verified_user["email"], verified_user["password"])
        refresh_tok = r.json()["refresh_token"]
        client.post("/auth/logout", json={"refresh_token": refresh_tok})
        r2 = client.post("/auth/refresh", json={"refresh_token": refresh_tok})
        assert r2.status_code == 401

    def test_invalid_access_token_rejected(self, client):
        r = client.get("/tasks/", headers={"Authorization": "Bearer totallyfaketoken"})
        assert r.status_code == 401


class TestUserStory14ExtendedCreateAccount:
    """#14 Additional account creation validation."""

    def test_register_rejects_password_without_digit(self, client):
        import backend.config as cfg

        prev = cfg.DISABLE_SMTP_SENDING
        cfg.DISABLE_SMTP_SENDING = True
        try:
            r = client.post(
                "/auth/register",
                json={
                    "name": "Digit",
                    "email": "digit@example.com",
                    "password": "NoDigitsHere",
                },
            )
        finally:
            cfg.DISABLE_SMTP_SENDING = prev
        assert r.status_code == 422
