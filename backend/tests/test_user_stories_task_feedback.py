"""
Task-level feedback API — not covered by other test files.

POST /feedback/task      — save per-task outcome
GET  /feedback/task/{id} — retrieve feedback history for a task
"""

from __future__ import annotations

from datetime import date

import pytest

from backend.tests.helpers import auth_headers, login_form, register_verified_user


@pytest.fixture
def token(client):
    register_verified_user(
        client, email="tfb@example.com", password="Feedback1", name="Feedback User"
    )
    r = login_form(client, "tfb@example.com", "Feedback1")
    return r.json()["access_token"]


@pytest.fixture
def task_id(client, token):
    r = client.post(
        "/tasks/",
        headers=auth_headers(token),
        json={"title": "Feedback task", "duration_minutes": 30},
    )
    return r.json()["task"]["id"]


class TestTaskFeedbackSubmit:

    def test_submit_minimal_feedback(self, client, token, task_id):
        r = client.post(
            "/feedback/task",
            headers=auth_headers(token),
            json={"task_id": task_id, "date": date.today().isoformat()},
        )
        assert r.status_code == 200
        assert r.json()["saved"] is True
        assert r.json()["task_id"] == task_id
        assert "feedback_id" in r.json()

    def test_submit_full_feedback(self, client, token, task_id):
        r = client.post(
            "/feedback/task",
            headers=auth_headers(token),
            json={
                "task_id": task_id,
                "date": date.today().isoformat(),
                "actual_duration": 45,
                "feeling": "energized",
                "satisfaction": 4,
                "would_move": False,
            },
        )
        assert r.status_code == 200
        assert r.json()["saved"] is True

    def test_submit_marks_task_completed(self, client, token, task_id):
        client.post(
            "/feedback/task",
            headers=auth_headers(token),
            json={"task_id": task_id, "date": date.today().isoformat()},
        )
        task = client.get(f"/tasks/{task_id}", headers=auth_headers(token)).json()
        assert task["completed"] is True
        assert task["completed_at"] is not None

    def test_would_move_updates_preferred_time(self, client, token, task_id):
        client.post(
            "/feedback/task",
            headers=auth_headers(token),
            json={
                "task_id": task_id,
                "date": date.today().isoformat(),
                "would_move": True,
                "preferred_time_given": "morning",
            },
        )
        task = client.get(f"/tasks/{task_id}", headers=auth_headers(token)).json()
        assert task["preferred_time"] == "morning"

    def test_would_move_on_locked_task_does_not_update_preferred_time(self, client, token):
        r = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "Locked pref", "preferred_time": "evening"},
        )
        tid = r.json()["task"]["id"]
        client.patch(
            f"/tasks/{tid}",
            headers=auth_headers(token),
            json={"preferred_time_locked": True},
        )

        client.post(
            "/feedback/task",
            headers=auth_headers(token),
            json={
                "task_id": tid,
                "date": date.today().isoformat(),
                "would_move": True,
                "preferred_time_given": "morning",
            },
        )

        task = client.get(f"/tasks/{tid}", headers=auth_headers(token)).json()
        assert task["preferred_time"] == "evening"  # unchanged

    def test_actual_duration_saved_on_task(self, client, token, task_id):
        client.post(
            "/feedback/task",
            headers=auth_headers(token),
            json={
                "task_id": task_id,
                "date": date.today().isoformat(),
                "actual_duration": 55,
            },
        )
        task = client.get(f"/tasks/{task_id}", headers=auth_headers(token)).json()
        assert task["actual_duration"] == 55

    def test_nonexistent_task_returns_404(self, client, token):
        r = client.post(
            "/feedback/task",
            headers=auth_headers(token),
            json={"task_id": 99999, "date": date.today().isoformat()},
        )
        assert r.status_code == 404

    def test_other_users_task_returns_404(self, client, token, task_id):
        register_verified_user(
            client, email="other4@example.com", password="Other4fb1", name="Other4"
        )
        other_tok = login_form(client, "other4@example.com", "Other4fb1").json()["access_token"]

        r = client.post(
            "/feedback/task",
            headers=auth_headers(other_tok),
            json={"task_id": task_id, "date": date.today().isoformat()},
        )
        assert r.status_code == 404

    def test_invalid_feeling_rejected(self, client, token, task_id):
        r = client.post(
            "/feedback/task",
            headers=auth_headers(token),
            json={"task_id": task_id, "date": date.today().isoformat(), "feeling": "happy"},
        )
        assert r.status_code == 422

    def test_satisfaction_above_5_rejected(self, client, token, task_id):
        r = client.post(
            "/feedback/task",
            headers=auth_headers(token),
            json={"task_id": task_id, "date": date.today().isoformat(), "satisfaction": 6},
        )
        assert r.status_code == 422

    def test_satisfaction_below_1_rejected(self, client, token, task_id):
        r = client.post(
            "/feedback/task",
            headers=auth_headers(token),
            json={"task_id": task_id, "date": date.today().isoformat(), "satisfaction": 0},
        )
        assert r.status_code == 422

    def test_all_five_valid_satisfaction_levels(self, client, token):
        for level in range(1, 6):
            r_task = client.post(
                "/tasks/",
                headers=auth_headers(token),
                json={"title": f"Sat task {level}"},
            )
            tid = r_task.json()["task"]["id"]
            r = client.post(
                "/feedback/task",
                headers=auth_headers(token),
                json={"task_id": tid, "date": date.today().isoformat(), "satisfaction": level},
            )
            assert r.status_code == 200, f"satisfaction={level} should be valid"

    def test_feedback_requires_auth(self, client, task_id):
        r = client.post(
            "/feedback/task",
            json={"task_id": task_id, "date": date.today().isoformat()},
        )
        assert r.status_code == 401


class TestTaskFeedbackHistory:

    def test_history_empty_for_new_task(self, client, token, task_id):
        r = client.get(f"/feedback/task/{task_id}", headers=auth_headers(token))
        assert r.status_code == 200
        data = r.json()
        assert data["task_id"] == task_id
        assert data["feedback_count"] == 0
        assert data["entries"] == []

    def test_history_reflects_submitted_entry(self, client, token, task_id):
        today = date.today().isoformat()
        client.post(
            "/feedback/task",
            headers=auth_headers(token),
            json={
                "task_id": task_id, "date": today,
                "feeling": "neutral", "satisfaction": 3,
            },
        )

        r = client.get(f"/feedback/task/{task_id}", headers=auth_headers(token))
        data = r.json()
        assert data["feedback_count"] == 1
        entry = data["entries"][0]
        assert entry["feeling"] == "neutral"
        assert entry["satisfaction"] == 3
        assert entry["date"] == today

    def test_history_includes_title(self, client, token, task_id):
        r = client.get(f"/feedback/task/{task_id}", headers=auth_headers(token))
        assert r.json()["task_title"] == "Feedback task"

    def test_history_for_nonexistent_task_returns_404(self, client, token):
        r = client.get("/feedback/task/99999", headers=auth_headers(token))
        assert r.status_code == 404

    def test_history_for_other_users_task_returns_404(self, client, token, task_id):
        register_verified_user(
            client, email="other5@example.com", password="Other5fb1", name="Other5"
        )
        other_tok = login_form(client, "other5@example.com", "Other5fb1").json()["access_token"]

        r = client.get(f"/feedback/task/{task_id}", headers=auth_headers(other_tok))
        assert r.status_code == 404

    def test_history_requires_auth(self, client, task_id):
        r = client.get(f"/feedback/task/{task_id}")
        assert r.status_code == 401
