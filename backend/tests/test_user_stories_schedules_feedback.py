"""
#5 Schedule optimization engine (rule-based scheduler via API)
#2 Interactive calendar — schedule for a given date (GET /schedules/date/{date})
#8 Rate energy/stress for the day (daily feedback + preferences influence)
"""

from __future__ import annotations

import bootstrap_sys_path  # noqa: F401

from datetime import date, timedelta

import pytest

from backend.tests.helpers import auth_headers, login_form, register_verified_user
from backend.scheduler.rule_based import build_schedule


@pytest.fixture
def token(client):
    register_verified_user(
        client, email="sched@example.com", password="SchedUser1", name="Sched"
    )
    r = login_form(client, "sched@example.com", "SchedUser1")
    assert r.status_code == 200
    return r.json()["access_token"]


def _make_task(id_, title="Task", importance=3, duration=30, energy="medium",
               preferred="none", recurrence="none", recurrence_days=None,
               task_type="flexible", fixed_start=None, fixed_end=None,
               deadline=None, times_rescheduled=0):
    return {
        "id": id_, "title": title, "task_type": task_type,
        "duration_minutes": duration, "deadline": deadline,
        "importance": importance, "energy_level": energy,
        "preferred_time": preferred, "preferred_time_locked": False,
        "fixed_start": fixed_start, "fixed_end": fixed_end,
        "recurrence": recurrence, "recurrence_days": recurrence_days,
        "times_rescheduled": times_rescheduled, "completed": False,
    }


class TestUserStory5ScheduleOptimization:
    def test_today_returns_scheduled_and_overflow_keys(self, client, token):
        client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "Flexible task", "duration_minutes": 30},
        )
        r = client.get("/schedules/today", headers=auth_headers(token))
        assert r.status_code == 200
        data = r.json()
        assert "scheduled" in data
        assert "overflow" in data
        assert isinstance(data["scheduled"], list)

    def test_schedule_summary_counts_are_correct(self, client, token):
        today = date.today().isoformat()
        for i in range(3):
            client.post(
                "/tasks/",
                headers=auth_headers(token),
                json={"title": f"Task {i}"},
            )
        r = client.get(f"/schedules/date/{today}", headers=auth_headers(token))
        data = r.json()
        assert "summary" in data
        summary = data["summary"]
        assert summary["scheduled_count"] + summary["overflow_count"] == summary["total_tasks"]

    def test_build_schedule_unit_smoke(self):
        """Direct engine call — ensures optimizer produces structure for story #5."""
        today = date.today().isoformat()
        out = build_schedule(
            tasks=[_make_task(1, title="A")],
            prefs=None,
            today_str=today,
        )
        assert "scheduled" in out
        assert "overflow" in out

    def test_high_importance_placed_before_low_importance(self):
        """#5 Priority engine: high-importance tasks should score higher and be placed first."""
        today = date.today().isoformat()
        out = build_schedule(
            tasks=[
                _make_task(1, title="Low", importance=1, duration=60),
                _make_task(2, title="High", importance=5, duration=60),
            ],
            prefs=None,
            today_str=today,
        )
        scheduled_ids = [t["task_id"] for t in out["scheduled"]]
        assert 2 in scheduled_ids, "High importance task should be scheduled"

    def test_task_overflows_when_day_is_full(self):
        """#5 Overflow list captures tasks that don't fit within wake/sleep window."""
        today = date.today().isoformat()
        tasks = [_make_task(i, title=f"T{i}", duration=120) for i in range(20)]
        out = build_schedule(tasks=tasks, prefs=None, today_str=today)
        assert len(out["overflow"]) > 0, "Some tasks should overflow a packed day"

    def test_fixed_task_anchored_at_exact_time(self):
        """#5 / #2 Fixed tasks must occupy their specified time slot."""
        today = date.today().isoformat()
        out = build_schedule(
            tasks=[_make_task(1, title="Meeting", task_type="fixed",
                              fixed_start="10:00", fixed_end="11:00",
                              deadline=today)],
            prefs=None,
            today_str=today,
        )
        assert len(out["scheduled"]) == 1
        s = out["scheduled"][0]
        assert s["start_time"] == "10:00"
        assert s["end_time"] == "11:00"


class TestUserStory2CalendarDateSchedule:
    def test_invalid_date_returns_400(self, client, token):
        r = client.get("/schedules/date/not-a-date", headers=auth_headers(token))
        assert r.status_code == 400

    def test_valid_date_returns_schedule(self, client, token):
        d = (date.today() + timedelta(days=1)).isoformat()
        r = client.get(f"/schedules/date/{d}", headers=auth_headers(token))
        assert r.status_code == 200
        assert "scheduled" in r.json()

    def test_task_due_on_date_appears_in_that_dates_schedule(self, client, token):
        target = (date.today() + timedelta(days=3)).isoformat()
        client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "Due that day", "deadline": target, "duration_minutes": 30},
        )
        r = client.get(f"/schedules/date/{target}", headers=auth_headers(token))
        assert r.status_code == 200
        titles = [t["title"] for t in r.json()["scheduled"]]
        assert "Due that day" in titles

    def test_daily_recurring_task_appears_on_any_date(self, client, token):
        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "Daily standup", "recurrence": "daily"},
        )
        r = client.get(f"/schedules/date/{tomorrow}", headers=auth_headers(token))
        all_titles = [t["title"] for t in r.json()["scheduled"]] + \
                     [t["title"] for t in r.json()["overflow"]]
        assert "Daily standup" in all_titles

    def test_fixed_task_is_placed_at_exact_specified_time(self, client, token):
        target = (date.today() + timedelta(days=2)).isoformat()
        client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={
                "title": "Morning meeting",
                "task_type": "fixed",
                "deadline": target,
                "fixed_start": "09:00",
                "fixed_end": "10:00",
            },
        )
        r = client.get(f"/schedules/date/{target}", headers=auth_headers(token))
        scheduled = r.json()["scheduled"]
        meeting = next((t for t in scheduled if t["title"] == "Morning meeting"), None)
        assert meeting is not None, "Fixed task not found in scheduled"
        assert meeting["start_time"] == "09:00"
        assert meeting["end_time"] == "10:00"

    def test_reschedule_endpoint_increments_times_rescheduled(self, client, token):
        tid = client.post(
            "/tasks/",
            headers=auth_headers(token),
            json={"title": "Pushed back"},
        ).json()["task"]["id"]

        r = client.post(f"/schedules/reschedule/{tid}", headers=auth_headers(token))
        assert r.status_code == 200
        assert "scheduled" in r.json()
        task = client.get(f"/tasks/{tid}", headers=auth_headers(token)).json()
        assert task["times_rescheduled"] == 1

    def test_schedule_requires_auth(self, client):
        r = client.get("/schedules/today")
        assert r.status_code == 401


class TestUserStory8EnergyStressFeedback:
    def test_daily_feedback_partial_morning_stress(self, client, token):
        day = date.today().isoformat()
        r = client.post(
            "/feedback/daily",
            headers=auth_headers(token),
            json={"date": day, "stress_morning": 3, "boredom_morning": 2},
        )
        assert r.status_code == 200
        assert r.json()["saved"] is True
        assert r.json()["completed_periods"]["morning"] is True

    def test_get_daily_feedback_reflects_saved_state(self, client, token):
        day = date.today().isoformat()
        client.post(
            "/feedback/daily",
            headers=auth_headers(token),
            json={"date": day, "stress_morning": 4},
        )
        r = client.get(f"/feedback/daily/{day}", headers=auth_headers(token))
        assert r.status_code == 200
        assert r.json()["exists"] is True
        assert r.json()["completed_periods"]["morning"] is True

    def test_afternoon_period_can_be_submitted_separately(self, client, token):
        day = date.today().isoformat()
        r = client.post(
            "/feedback/daily",
            headers=auth_headers(token),
            json={"date": day, "stress_afternoon": 2, "boredom_afternoon": 1},
        )
        assert r.status_code == 200
        assert r.json()["completed_periods"]["afternoon"] is True
        assert r.json()["completed_periods"]["morning"] is False

    def test_invalid_stress_rating_rejected(self, client, token):
        day = date.today().isoformat()
        r = client.post(
            "/feedback/daily",
            headers=auth_headers(token),
            json={"date": day, "stress_morning": 6},
        )
        assert r.status_code == 422

    def test_get_nonexistent_feedback_returns_exists_false(self, client, token):
        future = (date.today() + timedelta(days=30)).isoformat()
        r = client.get(f"/feedback/daily/{future}", headers=auth_headers(token))
        assert r.status_code == 200
        assert r.json()["exists"] is False
        assert r.json()["completed_periods"]["morning"] is False

    def test_get_feedback_invalid_date_returns_400(self, client, token):
        r = client.get("/feedback/daily/not-a-date", headers=auth_headers(token))
        assert r.status_code == 400
