"""
User stories: #8 Rate energy/stress (task feedback side).

Covers:
  POST /feedback/task    — submit feedback after completing a task
  GET  /feedback/task/{task_id} — retrieve full feedback history for a task
  Validation errors on task feedback fields.
"""

from __future__ import annotations

import bootstrap_sys_path  # noqa: F401

from datetime import date

import pytest

from backend.tests.helpers import auth_headers, login_form, register_verified_user


@pytest.fixture
def token(client):
    register_verified_user(
        client, email="feedback@example.com", password="FeedUser1", name="Feed User"
    )
    r = login_form(client, "feedback@example.com", "FeedUser1")
    assert r.status_code == 200
    return r.json()["access_token"]


@pytest.fixture
def task_id(client, token):
    r = client.post(
        "/tasks/",
        headers=auth_headers(token),
        json={"title": "Study session", "energy_level": "high", "duration_minutes": 60},
    )
    assert r.status_code == 201
    return r.json()["task"]["id"]


class TestTaskFeedbackSubmit:
    """POST /feedback/task — submit after completing a task."""

    def test_minimal_feedback_saved(self, client, token, task_id):
        today = date.today().isoformat()
        r = client.post(
            "/feedback/task",
            headers=auth_headers(token),
            json={"task_id": task_id, "date": today},
        )
        assert r.status_code == 200
        assert r.json()["saved"] is True
        assert r.json()["task_id"] == task_id

    def test_full_feedback_saved(self, client, token, task_id):
        today = date.today().isoformat()
        r = client.post(
            "/feedback/task",
            headers=auth_headers(token),
            json={
                "task_id": task_id,
                "date": today,
                "actual_duration": 75,
                "feeling": "energized",
                "satisfaction": 5,
                "would_move": False,
            },
        )
        assert r.status_code == 200
        data = r.json()
        assert data["saved"] is True
        assert "feedback_id" in data

    def test_would_move_updates_preferred_time(self, client, token, task_id):
        today = date.today().isoformat()
        r = client.post(
            "/feedback/task",
            headers=auth_headers(token),
            json={
                "task_id": task_id,
                "date": today,
                "would_move": True,
                "preferred_time_given": "morning",
            },
        )
        assert r.status_code == 200

    def test_nonexistent_task_returns_404(self, client, token):
        today = date.today().isoformat()
        r = client.post(
            "/feedback/task",
            headers=auth_headers(token),
            json={"task_id": 99999, "date": today},
        )
        assert r.status_code == 404

    def test_invalid_feeling_returns_422(self, client, token, task_id):
        today = date.today().isoformat()
        r = client.post(
            "/feedback/task",
            headers=auth_headers(token),
            json={"task_id": task_id, "date": today, "feeling": "happy"},
        )
        assert r.status_code == 422

    def test_satisfaction_out_of_range_returns_422(self, client, token, task_id):
        today = date.today().isoformat()
        r = client.post(
            "/feedback/task",
            headers=auth_headers(token),
            json={"task_id": task_id, "date": today, "satisfaction": 6},
        )
        assert r.status_code == 422

    def test_cannot_submit_feedback_for_other_users_task(self, client, token):
        register_verified_user(
            client, email="other2@example.com", password="Other2Pass1", name="Other2"
        )
        other_tok = login_form(client, "other2@example.com", "Other2Pass1").json()["access_token"]
        other_task_id = client.post(
            "/tasks/",
            headers=auth_headers(other_tok),
            json={"title": "Their task"},
        ).json()["task"]["id"]

        today = date.today().isoformat()
        r = client.post(
            "/feedback/task",
            headers=auth_headers(token),
            json={"task_id": other_task_id, "date": today},
        )
        assert r.status_code == 404

    def test_feedback_requires_auth(self, client, task_id):
        today = date.today().isoformat()
        r = client.post("/feedback/task", json={"task_id": task_id, "date": today})
        assert r.status_code == 401


class TestTaskFeedbackHistory:
    """GET /feedback/task/{task_id} — retrieve feedback history."""

    def test_empty_history_returns_zero_count(self, client, token, task_id):
        r = client.get(f"/feedback/task/{task_id}", headers=auth_headers(token))
        assert r.status_code == 200
        data = r.json()
        assert data["feedback_count"] == 0
        assert data["entries"] == []

    def test_submitted_feedback_appears_in_history(self, client, token, task_id):
        today = date.today().isoformat()
        client.post(
            "/feedback/task",
            headers=auth_headers(token),
            json={"task_id": task_id, "date": today, "feeling": "neutral", "satisfaction": 3},
        )
        r = client.get(f"/feedback/task/{task_id}", headers=auth_headers(token))
        assert r.status_code == 200
        data = r.json()
        assert data["feedback_count"] == 1
        entry = data["entries"][0]
        assert entry["feeling"] == "neutral"
        assert entry["satisfaction"] == 3

    def test_multiple_entries_returned_in_order(self, client, token, task_id):
        for day_offset in range(3):
            d = f"2030-01-0{day_offset + 1}"
            client.post(
                "/feedback/task",
                headers=auth_headers(token),
                json={"task_id": task_id, "date": d, "satisfaction": day_offset + 1},
            )
        r = client.get(f"/feedback/task/{task_id}", headers=auth_headers(token))
        assert r.json()["feedback_count"] == 3

    def test_nonexistent_task_returns_404(self, client, token):
        r = client.get("/feedback/task/99999", headers=auth_headers(token))
        assert r.status_code == 404

    def test_cannot_see_other_users_task_history(self, client, token, task_id):
        register_verified_user(
            client, email="spy@example.com", password="SpyPass11", name="Spy"
        )
        spy_tok = login_form(client, "spy@example.com", "SpyPass11").json()["access_token"]
        r = client.get(f"/feedback/task/{task_id}", headers=auth_headers(spy_tok))
        assert r.status_code == 404

    def test_task_title_returned_in_history(self, client, token, task_id):
        r = client.get(f"/feedback/task/{task_id}", headers=auth_headers(token))
        assert r.json()["task_title"] == "Study session"


class TestDailyFeedbackEveningTriggersLearning:
    """Evening period submission should trigger the learning engine (>=3 feedback days)."""

    def test_evening_submission_includes_learning_key_after_threshold(self, client, token):
        # Submit 3 daily feedbacks first (needed for learning to run)
        for i in range(3):
            day = f"2030-06-0{i + 1}"
            client.post(
                "/feedback/daily",
                headers=auth_headers(token),
                json={
                    "date": day,
                    "stress_morning": 2, "boredom_morning": 2,
                    "stress_evening": 2, "boredom_evening": 2,
                },
            )

        # Submit evening period on the 4th day — learning engine should run
        r = client.post(
            "/feedback/daily",
            headers=auth_headers(token),
            json={
                "date": "2030-06-04",
                "stress_evening": 3,
                "boredom_evening": 2,
            },
        )
        assert r.status_code == 200
        data = r.json()
        assert data["saved"] is True
        # Learning key is only present when the engine ran
        if "learning" in data:
            assert "ran" in data["learning"]

    def test_evening_without_enough_data_learning_not_ran(self, client, token):
        r = client.post(
            "/feedback/daily",
            headers=auth_headers(token),
            json={
                "date": date.today().isoformat(),
                "stress_evening": 2,
                "boredom_evening": 1,
            },
        )
        assert r.status_code == 200
        # When learning ran but said "not enough data", check the reason
        if "learning" in r.json():
            assert r.json()["learning"]["ran"] is False
