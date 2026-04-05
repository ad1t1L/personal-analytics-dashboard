"""
Targeted tests to close the remaining coverage gaps in pure-function modules.

Covers:
  security.py          — verify_totp edge cases, decode_2fa_pending_token wrong purpose
  constraints.py       — overlaps(), merged buffer intervals, fixed-task out-of-bounds
  priority_engine.py   — invalid deadline date, 3-7 day urgency, 7-14 day urgency
  rule_based.py        — build_schedule with no today_str, fixed task without times
  sqlite_migrations.py — non-sqlite engine, no tasks table, column add path
  email_utils.py       — _send with missing SMTP credentials
  dependencies.py      — get_current_user: no-sub token, deleted-user token,
                         disabled-account token, unverified-account token
  auth.py              — disabled account login, forgot-password with real user
  schedules.py         — reschedule nonexistent task → 404
  tasks.py             — PATCH /tasks/{id}/complete, PUT field branches, time format edge
"""

from __future__ import annotations

import bootstrap_sys_path  # noqa: F401

from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from backend.scheduler.constraints import (
    ScheduledTask,
    apply_constraints,
    find_free_slots,
    overlaps,
)
from backend.scheduler.priority_engine import deadline_urgency
from backend.scheduler.rule_based import build_schedule
from backend.security import (
    create_access_token,
    decode_2fa_pending_token,
    generate_totp_secret,
    verify_totp,
)
from backend.sqlite_migrations import apply_sqlite_migrations
from backend.tests.helpers import auth_headers, login_form, register_verified_user


# ── security.py ───────────────────────────────────────────────────────────────

class TestVerifyTotpEdgeCases:
    def test_short_code_rejected(self):
        secret = generate_totp_secret()
        assert verify_totp(secret, "12345") is False  # 5 digits

    def test_long_code_rejected(self):
        secret = generate_totp_secret()
        assert verify_totp(secret, "1234567") is False  # 7 digits

    def test_empty_code_rejected(self):
        secret = generate_totp_secret()
        assert verify_totp(secret, "") is False

    def test_empty_secret_rejected(self):
        assert verify_totp("", "123456") is False


class TestDecode2faPendingTokenEdgeCases:
    def test_regular_access_token_raises_value_error(self):
        token = create_access_token(1, "user@example.com")
        with pytest.raises((ValueError, Exception)):
            decode_2fa_pending_token(token)


# ── constraints.py ────────────────────────────────────────────────────────────

class TestOverlapsFunction:
    def test_non_overlapping_tasks_return_false(self):
        a = ScheduledTask(task_id=1, title="A", start_min=480, end_min=540,
                          energy_level="medium", task_type="flexible", times_rescheduled=0)
        b = ScheduledTask(task_id=2, title="B", start_min=600, end_min=660,
                          energy_level="medium", task_type="flexible", times_rescheduled=0)
        assert overlaps(a, b) is False

    def test_overlapping_tasks_return_true(self):
        a = ScheduledTask(task_id=1, title="A", start_min=480, end_min=600,
                          energy_level="medium", task_type="flexible", times_rescheduled=0)
        b = ScheduledTask(task_id=2, title="B", start_min=540, end_min=660,
                          energy_level="medium", task_type="flexible", times_rescheduled=0)
        assert overlaps(a, b) is True

    def test_adjacent_non_touching_tasks(self):
        a = ScheduledTask(task_id=1, title="A", start_min=480, end_min=540,
                          energy_level="medium", task_type="flexible", times_rescheduled=0)
        b = ScheduledTask(task_id=2, title="B", start_min=540, end_min=600,
                          energy_level="medium", task_type="flexible", times_rescheduled=0)
        # Touching but not strictly overlapping
        assert overlaps(a, b) is False


class TestFindFreeSlotsAdjacentTasks:
    def test_adjacent_fixed_tasks_buffers_merge(self):
        """Two fixed tasks close enough that their buffer zones overlap → single merged gap."""
        t1 = ScheduledTask(task_id=1, title="M1", start_min=480, end_min=540,
                           energy_level="medium", task_type="fixed", times_rescheduled=0)
        t2 = ScheduledTask(task_id=2, title="M2", start_min=545, end_min=605,
                           energy_level="medium", task_type="fixed", times_rescheduled=0)
        # With buffer=10: t1 blocked = 470-550, t2 blocked = 535-615 → overlap → merge
        slots = find_free_slots([t1, t2], 420, 1380, buffer_minutes=10)
        # One merged gap before both tasks and one after — NOT a gap between them
        for start, end in slots:
            assert not (540 <= start <= 545), "No free slot should exist between merged buffers"


class TestApplyConstraintsFixedOutOfBounds:
    def test_fixed_task_before_day_start_flagged(self):
        ft = ScheduledTask(task_id=1, title="Early", start_min=300, end_min=360,
                           energy_level="high", task_type="fixed", times_rescheduled=0)
        valid, overflow = apply_constraints([ft], day_start_min=420, day_end_min=1380)
        assert len(valid) == 1
        assert valid[0].get("out_of_bounds") is True
        assert len(overflow) == 0

    def test_fixed_task_after_day_end_flagged(self):
        ft = ScheduledTask(task_id=1, title="Late", start_min=1400, end_min=1430,
                           energy_level="low", task_type="fixed", times_rescheduled=0)
        valid, overflow = apply_constraints([ft], day_start_min=420, day_end_min=1380)
        assert valid[0].get("out_of_bounds") is True


# ── priority_engine.py ────────────────────────────────────────────────────────

class TestDeadlineUrgencyAllBranches:
    def test_invalid_date_string_returns_zero(self):
        assert deadline_urgency("not-a-date", "2030-01-01") == 0.0

    def test_3_to_7_days_returns_0_6(self):
        today = date.today().isoformat()
        five_days = (date.today() + timedelta(days=5)).isoformat()
        assert deadline_urgency(five_days, today) == 0.6

    def test_7_to_14_days_returns_0_3(self):
        today = date.today().isoformat()
        ten_days = (date.today() + timedelta(days=10)).isoformat()
        assert deadline_urgency(ten_days, today) == 0.3

    def test_more_than_14_days_returns_0_1(self):
        today = date.today().isoformat()
        far = (date.today() + timedelta(days=20)).isoformat()
        assert deadline_urgency(far, today) == 0.1

    def test_1_to_3_days_returns_0_85(self):
        today = date.today().isoformat()
        two_days = (date.today() + timedelta(days=2)).isoformat()
        assert deadline_urgency(two_days, today) == 0.85


# ── rule_based.py ─────────────────────────────────────────────────────────────

class TestBuildScheduleEdgeCases:
    def test_build_without_today_str_defaults_to_today(self):
        out = build_schedule(tasks=[], prefs=None, today_str=None)
        assert out["date"] == date.today().isoformat()

    def test_fixed_task_without_times_demoted_to_semi(self):
        """A fixed task with no fixed_start/fixed_end is treated as semi-flexible."""
        today = date.today().isoformat()
        out = build_schedule(
            tasks=[{
                "id": 1, "title": "No-time fixed", "task_type": "fixed",
                "duration_minutes": 30, "deadline": today,
                "importance": 3, "energy_level": "medium", "preferred_time": "none",
                "preferred_time_locked": False, "fixed_start": None, "fixed_end": None,
                "recurrence": "none", "recurrence_days": None,
                "times_rescheduled": 0, "completed": False,
            }],
            prefs=None,
            today_str=today,
        )
        # Should appear somewhere (scheduled or overflow), not silently dropped
        total = len(out["scheduled"]) + len(out["overflow"])
        assert total == 1


# ── sqlite_migrations.py ──────────────────────────────────────────────────────

class TestSQLiteMigrations:
    def test_non_sqlite_engine_skips_migration(self):
        """Engine whose URL does not start with 'sqlite' should return immediately."""
        from unittest.mock import MagicMock
        engine = MagicMock()
        engine.url = "postgresql://user:pass@localhost/db"
        apply_sqlite_migrations(engine)
        engine.begin.assert_not_called()

    def test_no_tasks_table_returns_early(self):
        """Fresh in-memory SQLite DB with no tables should not raise."""
        from sqlalchemy import create_engine
        from sqlalchemy.pool import StaticPool
        eng = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        apply_sqlite_migrations(eng)  # must not raise

    def test_missing_columns_are_added(self):
        """tasks table missing columns should have them added by migration."""
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import StaticPool
        eng = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        with eng.begin() as conn:
            conn.execute(text(
                "CREATE TABLE tasks (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT)"
            ))
        apply_sqlite_migrations(eng)
        with eng.begin() as conn:
            cols = {r[1] for r in conn.execute(text("PRAGMA table_info(tasks)")).fetchall()}
        assert "task_type" in cols
        assert "energy_level" in cols
        assert "times_rescheduled" in cols

    def test_existing_columns_not_duplicated(self):
        """Running migration twice on a fully-migrated table should not error."""
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import StaticPool
        eng = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        with eng.begin() as conn:
            conn.execute(text(
                "CREATE TABLE tasks (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT)"
            ))
        apply_sqlite_migrations(eng)
        apply_sqlite_migrations(eng)  # second run must not raise


# ── email_utils.py ────────────────────────────────────────────────────────────

class TestEmailUtils:
    def test_send_raises_runtime_error_when_no_smtp_credentials(self):
        from backend.email_utils import _send
        with patch("backend.email_utils.DISABLE_SMTP_SENDING", False), \
             patch("backend.email_utils.SMTP_USER", ""), \
             patch("backend.email_utils.SMTP_PASSWORD", ""):
            with pytest.raises(RuntimeError, match="SMTP is not configured"):
                _send("to@example.com", "Subject", "<html>body</html>")

    def test_send_skips_when_disabled(self):
        """When DISABLE_SMTP_SENDING is True, _send should return without raising."""
        from backend.email_utils import _send
        with patch("backend.email_utils.DISABLE_SMTP_SENDING", True):
            _send("to@example.com", "Subject", "<html>body</html>")  # no raise

    def test_send_password_reset_email_body_is_constructed(self, client):
        """Trigger forgot-password with a real user so send_password_reset_email is called."""
        register_verified_user(client, email="fpbody@example.com", password="FpBody11")
        r = client.post("/auth/forgot-password", json={"email": "fpbody@example.com"})
        assert r.status_code == 200  # SMTP disabled → no actual email, but function body runs


# ── dependencies.py — get_current_user edge cases ────────────────────────────

class TestGetCurrentUserEdgeCases:
    def test_token_with_no_sub_returns_401(self, client):
        from jose import jwt
        from backend.config import SECRET_KEY, ALGORITHM
        payload = {
            "email": "x@x.com",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        }
        token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
        r = client.get("/tasks/", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401

    def test_token_for_nonexistent_user_returns_401(self, client):
        token = create_access_token(99999, "ghost@example.com")
        r = client.get("/tasks/", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401

    def test_token_for_disabled_user_returns_400(self, client, db_session):
        from backend.models import User
        from backend.security import hash_password
        user = User(
            name="Disabled", email="dep_disabled@example.com",
            password_hash=hash_password("DepDisab1"),
            is_verified=True, is_active=False,
        )
        db_session.add(user)
        db_session.commit()
        token = create_access_token(int(user.id), str(user.email))
        r = client.get("/tasks/", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 400

    def test_token_for_unverified_user_returns_403(self, client, db_session):
        from backend.models import User
        from backend.security import hash_password
        user = User(
            name="Unver", email="dep_unver@example.com",
            password_hash=hash_password("DepUnver1"),
            is_verified=False, is_active=True,
        )
        db_session.add(user)
        db_session.commit()
        token = create_access_token(int(user.id), str(user.email))
        r = client.get("/tasks/", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 403


# ── auth.py — disabled account login ─────────────────────────────────────────

class TestDisabledAccountLogin:
    def test_login_with_disabled_account_returns_400(self, client, db_session):
        from backend.models import User
        from backend.security import hash_password
        user = User(
            name="Inactive", email="inactive@example.com",
            password_hash=hash_password("Inactive1"),
            is_verified=True, is_active=False,
        )
        db_session.add(user)
        db_session.commit()
        r = login_form(client, "inactive@example.com", "Inactive1")
        assert r.status_code == 400
        assert "disabled" in r.json()["detail"].lower()


class TestForgotPasswordWithRealUser:
    def test_creates_reset_token_for_registered_user(self, client, db_session):
        from backend.models import PasswordResetToken
        register_verified_user(client, email="fp_real@example.com", password="FpReal11")
        r = client.post("/auth/forgot-password", json={"email": "fp_real@example.com"})
        assert r.status_code == 200
        token_row = db_session.query(PasswordResetToken).first()
        assert token_row is not None

    def test_nonexistent_email_returns_same_message(self, client):
        r = client.post("/auth/forgot-password", json={"email": "nobody@nowhere.com"})
        assert r.status_code == 200
        assert "reset link" in r.json()["message"].lower()


# ── schedules.py — reschedule 404 ────────────────────────────────────────────

class TestReschedule404:
    def test_reschedule_nonexistent_task_returns_404(self, client):
        register_verified_user(client, email="sched404@example.com", password="Sched404!")
        token = login_form(client, "sched404@example.com", "Sched404!").json()["access_token"]
        r = client.post("/schedules/reschedule/99999", headers=auth_headers(token))
        assert r.status_code == 404


# ── tasks.py — PATCH /tasks/{id}/complete and PUT field branches ──────────────

@pytest.fixture
def task_token(client):
    register_verified_user(client, email="taskgap@example.com",
                           password="TaskGap1", name="Gap User")
    return login_form(client, "taskgap@example.com", "TaskGap1").json()["access_token"]


class TestPatchCompleteEndpoint:
    def test_patch_complete_marks_task_done(self, client, task_token):
        tid = client.post("/tasks/", headers=auth_headers(task_token),
                          json={"title": "Complete me"}).json()["task"]["id"]
        r = client.patch(f"/tasks/{tid}/complete", headers=auth_headers(task_token))
        assert r.status_code == 200
        assert r.json()["completed"] is True

    def test_patch_complete_nonexistent_task_returns_404(self, client, task_token):
        r = client.patch("/tasks/99999/complete", headers=auth_headers(task_token))
        assert r.status_code == 404


class TestPutFieldBranches:
    def test_put_updates_duration_and_task_type(self, client, task_token):
        tid = client.post("/tasks/", headers=auth_headers(task_token),
                          json={"title": "Original"}).json()["task"]["id"]
        r = client.put(f"/tasks/{tid}", headers=auth_headers(task_token),
                       json={"duration_minutes": 90, "task_type": "semi"})
        assert r.status_code == 200
        assert r.json()["task"]["duration_minutes"] == 90
        assert r.json()["task"]["task_type"] == "semi"

    def test_put_updates_fixed_time_fields(self, client, task_token):
        tid = client.post("/tasks/", headers=auth_headers(task_token),
                          json={"title": "Meeting",
                                "task_type": "fixed",
                                "fixed_start": "09:00",
                                "fixed_end": "10:00"}).json()["task"]["id"]
        r = client.put(f"/tasks/{tid}", headers=auth_headers(task_token),
                       json={"fixed_start": "10:00", "fixed_end": "11:00",
                             "location": "Room 1"})
        assert r.status_code == 200
        assert r.json()["task"]["fixed_start"] == "10:00"
        assert r.json()["task"]["location"] == "Room 1"

    def test_put_updates_recurrence_fields(self, client, task_token):
        tid = client.post("/tasks/", headers=auth_headers(task_token),
                          json={"title": "Weekly"}).json()["task"]["id"]
        r = client.put(f"/tasks/{tid}", headers=auth_headers(task_token),
                       json={"recurrence": "weekly", "recurrence_days": "1,3"})
        assert r.status_code == 200
        assert r.json()["task"]["recurrence"] == "weekly"
        assert r.json()["task"]["recurrence_days"] == "1,3"

    def test_put_updates_preferred_time_locked(self, client, task_token):
        tid = client.post("/tasks/", headers=auth_headers(task_token),
                          json={"title": "Lock"}).json()["task"]["id"]
        r = client.put(f"/tasks/{tid}", headers=auth_headers(task_token),
                       json={"preferred_time_locked": True})
        assert r.status_code == 200
        assert r.json()["task"]["preferred_time_locked"] is True

    def test_put_empty_title_returns_422(self, client, task_token):
        tid = client.post("/tasks/", headers=auth_headers(task_token),
                          json={"title": "Original"}).json()["task"]["id"]
        r = client.put(f"/tasks/{tid}", headers=auth_headers(task_token),
                       json={"title": "   "})
        assert r.status_code == 422

    def test_create_time_format_with_non_digit_parts_rejected(self, client, task_token):
        r = client.post("/tasks/", headers=auth_headers(task_token),
                        json={"title": "Bad", "task_type": "fixed",
                              "fixed_start": "AB:00", "fixed_end": "10:00"})
        assert r.status_code == 422

    def test_create_time_out_of_range_rejected(self, client, task_token):
        r = client.post("/tasks/", headers=auth_headers(task_token),
                        json={"title": "Bad", "task_type": "fixed",
                              "fixed_start": "25:00", "fixed_end": "26:00"})
        assert r.status_code == 422
