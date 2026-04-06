"""Helpers for API tests (not fixtures — safe to import from test modules)."""

from __future__ import annotations

import bootstrap_sys_path  # noqa: F401 — ensures repo root is on sys.path when run directly

import backend.config as cfg


def register_verified_user(client, *, name="Test User", email="user@example.com", password="Testpass1"):
    """POST /auth/register; forces verified user when SMTP is disabled."""
    prev = cfg.DISABLE_SMTP_SENDING
    cfg.DISABLE_SMTP_SENDING = True
    try:
        return client.post(
            "/auth/register",
            json={"name": name, "email": email, "password": password},
        )
    finally:
        cfg.DISABLE_SMTP_SENDING = prev


def login_form(client, email: str, password: str):
    return client.post(
        "/auth/login",
        data={"username": email, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )


def auth_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}
