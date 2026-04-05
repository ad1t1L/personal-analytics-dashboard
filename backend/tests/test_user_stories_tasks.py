"""
#7 Create tasks with details
#9 Edit existing tasks
#10 Delete tasks
#11 Mark tasks complete
#12 Set and update priority levels (importance 1–5)
"""

from __future__ import annotations

import bootstrap_sys_path  # noqa: F401

import pytest

from backend.tests.helpers import auth_headers, login_form, register_verified_user


@pytest.fixture
def token(client):
    register_verified_user(
        client, email="tasks@example.com", password="TaskUser1", name="Task User"
    )
    r = login_form(client, "tasks@example.com", "TaskUser1")
    assert r.status_code == 200
    return r.json()["access_token"]


class TestUserStory7CreateTasks:
    def test_create_task_with_defaults(self, client, token):
        r = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "Buy milk"},
        )
        assert r.status_code == 201
        task = r.json()["task"]
        assert task["title"] == "Buy milk"
        assert task["importance"] == 3
        assert task["task_type"] == "flexible"

    def test_create_task_with_details(self, client, token):
        r = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={
                "title": "Deep work",
                "duration_minutes": 90,
                "importance": 5,
                "deadline": "2030-01-15",
                "energy_level": "high",
                "preferred_time": "morning",
                "task_type": "semi",
            },
        )
        assert r.status_code == 201
        t = r.json()["task"]
        assert t["duration_minutes"] == 90
        assert t["importance"] == 5
        assert t["energy_level"] == "high"

    def test_create_fixed_task_requires_times(self, client, token):
        r = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={
                "title": "Dentist",
                "task_type": "fixed",
                "deadline": "2030-06-01",
            },
        )
        assert r.status_code == 422

    def test_create_fixed_task_with_valid_times_succeeds(self, client, token):
        r = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={
                "title": "Dentist",
                "task_type": "fixed",
                "deadline": "2030-06-01",
                "fixed_start": "09:00",
                "fixed_end": "10:00",
            },
        )
        assert r.status_code == 201
        t = r.json()["task"]
        assert t["fixed_start"] == "09:00"
        assert t["fixed_end"] == "10:00"

    def test_create_rejects_empty_title(self, client, token):
        r = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "   "},
        )
        assert r.status_code == 422

    def test_create_weekly_recurrence_requires_days(self, client, token):
        r = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "Weekly chore", "recurrence": "weekly"},
        )
        assert r.status_code == 422

    def test_create_weekly_recurrence_with_days_succeeds(self, client, token):
        r = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "Mon/Wed/Fri", "recurrence": "weekly", "recurrence_days": "0,2,4"},
        )
        assert r.status_code == 201
        assert r.json()["task"]["recurrence_days"] == "0,2,4"

    def test_validation_rejects_invalid_importance(self, client, token):
        r = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "x", "importance": 99},
        )
        assert r.status_code == 422

    def test_validation_rejects_invalid_task_type(self, client, token):
        r = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "Bad type", "task_type": "random"},
        )
        assert r.status_code == 422

    def test_validation_rejects_invalid_energy_level(self, client, token):
        r = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "Bad energy", "energy_level": "extreme"},
        )
        assert r.status_code == 422

    def test_validation_rejects_invalid_time_format(self, client, token):
        r = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={
                "title": "Bad time",
                "task_type": "fixed",
                "fixed_start": "9am",
                "fixed_end": "10am",
            },
        )
        assert r.status_code == 422


class TestUserStory9EditTasks:
    def test_put_updates_title_and_deadline(self, client, token):
        tid = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "Original"},
        ).json()["task"]["id"]

        r = client.put(
            f"/tasks/{tid}",
            headers=auth_headers(token),
            json={"title": "Updated title", "deadline": "2030-02-01"},
        )
        assert r.status_code == 200
        assert r.json()["task"]["title"] == "Updated title"
        assert r.json()["task"]["deadline"] == "2030-02-01"

    def test_put_updates_energy_level_and_preferred_time(self, client, token):
        tid = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "Energy task", "energy_level": "low"},
        ).json()["task"]["id"]

        r = client.put(
            f"/tasks/{tid}",
            headers=auth_headers(token),
            json={"energy_level": "high", "preferred_time": "morning"},
        )
        assert r.status_code == 200
        assert r.json()["task"]["energy_level"] == "high"
        assert r.json()["task"]["preferred_time"] == "morning"

    def test_patch_locks_preferred_time(self, client, token):
        tid = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "Lock me"},
        ).json()["task"]["id"]

        r = client.patch(
            f"/tasks/{tid}",
            headers=auth_headers(token),
            json={"preferred_time": "evening", "preferred_time_locked": True},
        )
        assert r.status_code == 200
        assert r.json()["task"]["preferred_time_locked"] is True
        assert r.json()["task"]["preferred_time"] == "evening"

    def test_edit_nonexistent_task_returns_404(self, client, token):
        r = client.put(
            "/tasks/99999",
            headers=auth_headers(token),
            json={"title": "Ghost"},
        )
        assert r.status_code == 404

    def test_cannot_edit_other_users_task(self, client, token):
        tid = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "Mine"},
        ).json()["task"]["id"]

        register_verified_user(
            client, email="other@example.com", password="OtherUser1", name="Other"
        )
        r2 = login_form(client, "other@example.com", "OtherUser1")
        other_tok = r2.json()["access_token"]

        r = client.put(
            f"/tasks/{tid}",
            headers=auth_headers(other_tok),
            json={"title": "Hacked"},
        )
        assert r.status_code == 404


class TestUserStory10DeleteTasks:
    def test_delete_removes_task(self, client, token):
        tid = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "To delete"},
        ).json()["task"]["id"]

        r = client.delete(f"/tasks/{tid}", headers=auth_headers(token))
        assert r.status_code == 200
        assert client.get(f"/tasks/{tid}", headers=auth_headers(token)).status_code == 404

    def test_delete_nonexistent_task_returns_404(self, client, token):
        r = client.delete("/tasks/99999", headers=auth_headers(token))
        assert r.status_code == 404

    def test_cannot_delete_other_users_task(self, client, token):
        tid = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "Not yours"},
        ).json()["task"]["id"]

        register_verified_user(
            client, email="delother@example.com", password="DelOther1", name="Delother"
        )
        other_tok = login_form(client, "delother@example.com", "DelOther1").json()["access_token"]

        r = client.delete(f"/tasks/{tid}", headers=auth_headers(other_tok))
        assert r.status_code == 404


class TestUserStory11CompleteTasks:
    def test_patch_marks_complete(self, client, token):
        tid = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "Finish me"},
        ).json()["task"]["id"]

        r = client.patch(
            f"/tasks/{tid}",
            headers=auth_headers(token),
            json={"completed": True},
        )
        assert r.status_code == 200
        assert r.json()["task"]["completed"] is True

    def test_quick_complete_post(self, client, token):
        tid = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "Quick"},
        ).json()["task"]["id"]

        r = client.post(f"/tasks/{tid}/complete", headers=auth_headers(token))
        assert r.status_code == 200
        assert r.json()["completed"] is True

    def test_completed_at_timestamp_is_set(self, client, token):
        tid = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "Timestamped"},
        ).json()["task"]["id"]

        r = client.post(f"/tasks/{tid}/complete", headers=auth_headers(token))
        assert r.json()["task"]["completed_at"] is not None

    def test_complete_nonexistent_task_returns_404(self, client, token):
        r = client.post("/tasks/99999/complete", headers=auth_headers(token))
        assert r.status_code == 404


class TestUserStory12PriorityLevels:
    def test_create_with_importance(self, client, token):
        r = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "P1", "importance": 1},
        )
        assert r.json()["task"]["importance"] == 1

    def test_all_five_importance_levels_valid(self, client, token):
        for level in range(1, 6):
            r = client.post(
                "/tasks/",
                headers=auth_headers(token),
                json={"title": f"Level {level}", "importance": level},
            )
            assert r.status_code == 201, f"importance={level} should be valid"
            assert r.json()["task"]["importance"] == level

    def test_patch_updates_importance(self, client, token):
        tid = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "Adjust me", "importance": 2},
        ).json()["task"]["id"]

        r = client.patch(
            f"/tasks/{tid}",
            headers=auth_headers(token),
            json={"importance": 5},
        )
        assert r.status_code == 200
        assert r.json()["task"]["importance"] == 5

    def test_put_rejects_importance_out_of_range(self, client, token):
        tid = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "x"},
        ).json()["task"]["id"]

        r = client.put(
            f"/tasks/{tid}",
            headers=auth_headers(token),
            json={"importance": 10},
        )
        assert r.status_code == 422

    def test_patch_rejects_importance_below_one(self, client, token):
        tid = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "x"},
        ).json()["task"]["id"]

        r = client.patch(
            f"/tasks/{tid}",
            headers=auth_headers(token),
            json={"importance": 0},
        )
        assert r.status_code == 422
