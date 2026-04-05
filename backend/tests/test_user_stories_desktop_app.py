"""
#45 Use the app without logging in on the website — native/Tauri uses stored tokens + API.
#42 Secure app login — same /auth/login + HTTPS in production (covered by auth tests + manual).
#21 App home routes to other pages — UI/E2E concern; smoke-check that web SPA exposes login + dashboard paths.

These tests document scope; automated coverage for #42/#21 is primarily frontend/E2E.
Backend contract: authenticated /tasks and /schedules work from any client with a valid JWT.
"""

from __future__ import annotations

import bootstrap_sys_path  # noqa: F401

from backend.tests.helpers import auth_headers, login_form, register_verified_user


class TestDesktopAppBackendContract:
    """Same API serves the website and the desktop shell — token auth is client-agnostic."""

    def test_api_accepts_bearer_from_login(self, client):
        register_verified_user(
            client, email="desktop@example.com", password="Desktop1", name="Desktop"
        )
        r = login_form(client, "desktop@example.com", "Desktop1")
        assert r.status_code == 200
        token = r.json()["access_token"]
        tasks = client.get("/tasks/", headers=auth_headers(token))
        sched = client.get("/schedules/today", headers=auth_headers(token))
        assert tasks.status_code == 200
        assert sched.status_code == 200
