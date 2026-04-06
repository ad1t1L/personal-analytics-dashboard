"""
Unit tests for the learning engine (pure functions + DB-driven main entry point).

Covers:
  - clamp, nudge, stress_to_signal, feeling_to_signal, avg helpers
  - update_energy_weights_from_daily
  - update_energy_weights_from_tasks
  - update_buffer_preference
  - update_schedule_density
  - run_end_of_day_learning (not-enough-data guard + full run)
"""

from __future__ import annotations

import bootstrap_sys_path  # noqa: F401

from datetime import date, timedelta

import pytest

from backend.scheduler.learning_engine import (
    LEARNING_RATE,
    MIN_FEEDBACK_DAYS,
    WOULD_MOVE_THRESHOLD,
    HIGH_STRESS_THRESHOLD,
    HIGH_BOREDOM_THRESHOLD,
    avg,
    clamp,
    nudge,
    stress_to_signal,
    feeling_to_signal,
    update_buffer_preference,
    update_energy_weights_from_daily,
    update_energy_weights_from_tasks,
    update_schedule_density,
    update_task_preferred_times,
    run_end_of_day_learning,
)
from backend.models import (
    DailyFeedback,
    Task,
    TaskFeedback,
    User,
    UserPreferences,
)
from backend.security import hash_password


# ── Pure-function helpers ─────────────────────────────────────────────────────

class TestClamp:
    def test_value_below_lo_is_clamped(self):
        assert clamp(-0.5) == 0.0

    def test_value_above_hi_is_clamped(self):
        assert clamp(1.5) == 1.0

    def test_value_in_range_unchanged(self):
        assert clamp(0.7) == 0.7

    def test_custom_bounds(self):
        assert clamp(12, lo=5, hi=10) == 10
        assert clamp(3, lo=5, hi=10) == 5


class TestNudge:
    def test_nudge_toward_higher_signal(self):
        result = nudge(0.5, 1.0, LEARNING_RATE)
        assert result == pytest.approx(0.5 + LEARNING_RATE * (1.0 - 0.5))

    def test_nudge_toward_lower_signal(self):
        result = nudge(0.8, 0.0, LEARNING_RATE)
        assert result == pytest.approx(0.8 + LEARNING_RATE * (0.0 - 0.8))

    def test_nudge_result_clamped_to_zero_one(self):
        assert nudge(0.99, 1.0, rate=0.5) <= 1.0
        assert nudge(0.01, 0.0, rate=0.5) >= 0.0

    def test_no_change_when_already_at_signal(self):
        assert nudge(0.5, 0.5) == pytest.approx(0.5)


class TestStressToSignal:
    def test_none_returns_none(self):
        assert stress_to_signal(None) is None

    def test_stress_1_returns_1(self):
        assert stress_to_signal(1) == pytest.approx(1.0)

    def test_stress_5_returns_0(self):
        assert stress_to_signal(5) == pytest.approx(0.0)

    def test_stress_3_returns_midpoint(self):
        assert stress_to_signal(3) == pytest.approx(0.5)

    def test_signal_monotonically_decreasing(self):
        signals = [stress_to_signal(s) for s in range(1, 6)]
        assert signals == sorted(signals, reverse=True)


class TestFeelingToSignal:
    def test_none_returns_none(self):
        assert feeling_to_signal(None) is None

    def test_energized_returns_1(self):
        assert feeling_to_signal("energized") == 1.0

    def test_neutral_returns_half(self):
        assert feeling_to_signal("neutral") == 0.5

    def test_drained_returns_0(self):
        assert feeling_to_signal("drained") == 0.0

    def test_unknown_feeling_returns_none(self):
        assert feeling_to_signal("happy") is None


class TestAvg:
    def test_empty_returns_none(self):
        assert avg([]) is None

    def test_single_value(self):
        assert avg([3.0]) == pytest.approx(3.0)

    def test_average_of_list(self):
        assert avg([1.0, 2.0, 3.0]) == pytest.approx(2.0)

    def test_none_values_skipped(self):
        assert avg([None, 2.0, None, 4.0]) == pytest.approx(3.0)

    def test_all_none_returns_none(self):
        assert avg([None, None]) is None


# ── DB-backed engine tests ────────────────────────────────────────────────────

def _make_user(db_session) -> User:
    user = User(
        name="Learner", email="learner@example.com",
        password_hash=hash_password("LearnPass1"),
        is_verified=True, is_active=True,
    )
    db_session.add(user)
    db_session.flush()
    return user


def _make_prefs(db_session, user_id: int) -> UserPreferences:
    prefs = UserPreferences(user_id=user_id)
    db_session.add(prefs)
    db_session.flush()
    return prefs


def _make_daily(db_session, user_id: int, date_str: str, **kwargs) -> DailyFeedback:
    row = DailyFeedback(user_id=user_id, date=date_str, **kwargs)
    db_session.add(row)
    db_session.flush()
    return row


class TestUpdateEnergyWeightsFromDaily:
    def test_high_stress_morning_nudges_weight_down(self, db_session):
        user = _make_user(db_session)
        prefs = _make_prefs(db_session, user.id)
        daily = _make_daily(db_session, user.id, "2030-01-01",
                            stress_morning=5)  # max stress → signal 0
        before = prefs.energy_morning_high
        update_energy_weights_from_daily(prefs, daily)
        assert prefs.energy_morning_high < before

    def test_low_stress_morning_nudges_weight_up(self, db_session):
        user = _make_user(db_session)
        prefs = _make_prefs(db_session, user.id)
        daily = _make_daily(db_session, user.id, "2030-01-01",
                            stress_morning=1)  # min stress → signal 1
        before = prefs.energy_morning_high
        update_energy_weights_from_daily(prefs, daily)
        assert prefs.energy_morning_high > before

    def test_none_stress_leaves_weight_unchanged(self, db_session):
        user = _make_user(db_session)
        prefs = _make_prefs(db_session, user.id)
        daily = _make_daily(db_session, user.id, "2030-01-01")
        before = prefs.energy_morning_high
        update_energy_weights_from_daily(prefs, daily)
        assert prefs.energy_morning_high == before

    def test_medium_energy_weight_updated_at_half_rate(self, db_session):
        user = _make_user(db_session)
        prefs = _make_prefs(db_session, user.id)
        daily = _make_daily(db_session, user.id, "2030-01-01",
                            stress_morning=5)
        update_energy_weights_from_daily(prefs, daily)
        # High and medium both move down, but medium less so
        assert prefs.energy_morning_medium > prefs.energy_morning_high


class TestUpdateEnergyWeightsFromTasks:
    def test_drained_feeling_nudges_weight_down(self, db_session):
        user = _make_user(db_session)
        prefs = _make_prefs(db_session, user.id)
        task = Task(user_id=user.id, title="Hard task", energy_level="high",
                    task_type="flexible")
        db_session.add(task)
        db_session.flush()
        entry = TaskFeedback(
            user_id=user.id, task_id=task.id, date="2030-01-01",
            feeling="drained", time_of_day_done="morning", would_move=False,
        )
        db_session.add(entry)
        db_session.flush()
        before = prefs.energy_morning_high
        update_energy_weights_from_tasks(prefs, [entry])
        assert prefs.energy_morning_high < before

    def test_energized_feeling_nudges_weight_up(self, db_session):
        user = _make_user(db_session)
        prefs = _make_prefs(db_session, user.id)
        task = Task(user_id=user.id, title="Fun task", energy_level="high",
                    task_type="flexible")
        db_session.add(task)
        db_session.flush()
        entry = TaskFeedback(
            user_id=user.id, task_id=task.id, date="2030-01-01",
            feeling="energized", time_of_day_done="morning", would_move=False,
        )
        db_session.add(entry)
        db_session.flush()
        before = prefs.energy_morning_high
        update_energy_weights_from_tasks(prefs, [entry])
        assert prefs.energy_morning_high > before

    def test_no_feeling_skipped(self, db_session):
        user = _make_user(db_session)
        prefs = _make_prefs(db_session, user.id)
        task = Task(user_id=user.id, title="Task", energy_level="high",
                    task_type="flexible")
        db_session.add(task)
        db_session.flush()
        entry = TaskFeedback(
            user_id=user.id, task_id=task.id, date="2030-01-01",
            feeling=None, time_of_day_done="morning", would_move=False,
        )
        db_session.add(entry)
        db_session.flush()
        before = prefs.energy_morning_high
        update_energy_weights_from_tasks(prefs, [entry])
        assert prefs.energy_morning_high == before


class TestUpdateBufferPreference:
    def _make_days(self, db_session, user_id, n, stress, boredom):
        days = []
        for i in range(n):
            d = _make_daily(db_session, user_id,
                            (date.today() - timedelta(days=i)).isoformat(),
                            stress_morning=stress, boredom_morning=boredom)
            days.append(d)
        return days

    def test_high_stress_increases_buffer(self, db_session):
        user = _make_user(db_session)
        prefs = _make_prefs(db_session, user.id)
        days = self._make_days(db_session, user.id, 5,
                               stress=5, boredom=1)
        before = prefs.preferred_buffer_minutes
        update_buffer_preference(prefs, days)
        assert prefs.preferred_buffer_minutes > before

    def test_high_boredom_decreases_buffer(self, db_session):
        user = _make_user(db_session)
        prefs = _make_prefs(db_session, user.id)
        prefs.preferred_buffer_minutes = 20
        days = self._make_days(db_session, user.id, 5,
                               stress=1, boredom=5)
        before = prefs.preferred_buffer_minutes
        update_buffer_preference(prefs, days)
        assert prefs.preferred_buffer_minutes < before

    def test_buffer_clamped_between_5_and_30(self, db_session):
        user = _make_user(db_session)
        prefs = _make_prefs(db_session, user.id)
        prefs.preferred_buffer_minutes = 30
        days = self._make_days(db_session, user.id, 5, stress=5, boredom=1)
        update_buffer_preference(prefs, days)
        assert prefs.preferred_buffer_minutes <= 30
        prefs.preferred_buffer_minutes = 5
        days2 = self._make_days(db_session, user.id, 5, stress=1, boredom=5)
        update_buffer_preference(prefs, days2)
        assert prefs.preferred_buffer_minutes >= 5

    def test_no_data_leaves_buffer_unchanged(self, db_session):
        user = _make_user(db_session)
        prefs = _make_prefs(db_session, user.id)
        before = prefs.preferred_buffer_minutes
        update_buffer_preference(prefs, [])
        assert prefs.preferred_buffer_minutes == before


class TestUpdateScheduleDensity:
    def _stress_heavy_days(self, db_session, user_id, n):
        return [
            _make_daily(db_session, user_id,
                        (date.today() - timedelta(days=i)).isoformat(),
                        stress_morning=5, stress_afternoon=5, stress_evening=5,
                        boredom_morning=1, boredom_afternoon=1, boredom_evening=1)
            for i in range(n)
        ]

    def _boredom_heavy_days(self, db_session, user_id, n):
        return [
            _make_daily(db_session, user_id,
                        (date.today() - timedelta(days=i)).isoformat(),
                        stress_morning=1, stress_afternoon=1, stress_evening=1,
                        boredom_morning=5, boredom_afternoon=5, boredom_evening=5)
            for i in range(n)
        ]

    def test_3_stress_heavy_days_sets_relaxed(self, db_session):
        user = _make_user(db_session)
        prefs = _make_prefs(db_session, user.id)
        days = self._stress_heavy_days(db_session, user.id, 3)
        update_schedule_density(prefs, days)
        assert prefs.schedule_density == "relaxed"

    def test_3_boredom_heavy_days_sets_packed(self, db_session):
        user = _make_user(db_session)
        prefs = _make_prefs(db_session, user.id)
        days = self._boredom_heavy_days(db_session, user.id, 3)
        update_schedule_density(prefs, days)
        assert prefs.schedule_density == "packed"

    def test_fewer_than_3_consistent_days_no_change(self, db_session):
        user = _make_user(db_session)
        prefs = _make_prefs(db_session, user.id)
        prefs.schedule_density = "relaxed"
        days = self._stress_heavy_days(db_session, user.id, 2)
        update_schedule_density(prefs, days)
        assert prefs.schedule_density == "relaxed"


class TestRunEndOfDayLearning:
    def test_returns_not_ran_below_min_feedback_days(self, db_session):
        user = _make_user(db_session)
        today = date.today().isoformat()
        result = run_end_of_day_learning(user.id, today, db_session)
        assert result["ran"] is False
        assert str(MIN_FEEDBACK_DAYS) in result["reason"]

    def test_runs_and_returns_ran_true_with_enough_data(self, db_session):
        user = _make_user(db_session)
        today = date.today()
        for i in range(MIN_FEEDBACK_DAYS):
            day = (today - timedelta(days=i)).isoformat()
            db_session.add(DailyFeedback(
                user_id=user.id, date=day,
                stress_morning=3, boredom_morning=2,
                stress_afternoon=2, boredom_afternoon=2,
                stress_evening=3, boredom_evening=2,
            ))
        db_session.flush()
        result = run_end_of_day_learning(user.id, today.isoformat(), db_session)
        assert result["ran"] is True
        assert "updates_applied" in result

    def test_creates_user_preferences_row_if_missing(self, db_session):
        user = _make_user(db_session)
        today = date.today()
        for i in range(MIN_FEEDBACK_DAYS):
            day = (today - timedelta(days=i)).isoformat()
            db_session.add(DailyFeedback(
                user_id=user.id, date=day,
                stress_morning=2, boredom_morning=2,
                stress_afternoon=2, boredom_afternoon=2,
                stress_evening=2, boredom_evening=2,
            ))
        db_session.flush()
        run_end_of_day_learning(user.id, today.isoformat(), db_session)
        prefs = db_session.query(UserPreferences).filter_by(user_id=user.id).first()
        assert prefs is not None

    def test_no_update_when_today_has_no_daily_row(self, db_session):
        """If today_daily is None the energy weight update step is skipped gracefully."""
        user = _make_user(db_session)
        today = date.today()
        # Add enough days to cross threshold but NOT include today
        for i in range(1, MIN_FEEDBACK_DAYS + 1):
            day = (today - timedelta(days=i)).isoformat()
            db_session.add(DailyFeedback(
                user_id=user.id, date=day,
                stress_morning=2, boredom_morning=2,
                stress_evening=2, boredom_evening=2,
            ))
        db_session.flush()
        result = run_end_of_day_learning(user.id, today.isoformat(), db_session)
        assert result["ran"] is True

    def test_current_weights_included_in_result(self, db_session):
        user = _make_user(db_session)
        today = date.today()
        for i in range(MIN_FEEDBACK_DAYS):
            day = (today - timedelta(days=i)).isoformat()
            db_session.add(DailyFeedback(
                user_id=user.id, date=day,
                stress_morning=3, boredom_morning=2,
                stress_evening=3, boredom_evening=2,
            ))
        db_session.flush()
        result = run_end_of_day_learning(user.id, today.isoformat(), db_session)
        assert "current_weights" in result
        assert "energy_morning_high" in result["current_weights"]
        assert "buffer_minutes" in result["current_weights"]


class TestUpdateEnergyWeightsFromTasksEdgeCases:
    """Cover branches skipped when time_of_day_done or energy_level are invalid."""

    def test_invalid_time_of_day_skipped(self, db_session):
        user = _make_user(db_session)
        prefs = _make_prefs(db_session, user.id)
        task = Task(user_id=user.id, title="T", energy_level="high", task_type="flexible")
        db_session.add(task)
        db_session.flush()
        entry = TaskFeedback(
            user_id=user.id, task_id=task.id, date="2030-01-01",
            feeling="drained", time_of_day_done="midnight",  # not valid
            would_move=False,
        )
        db_session.add(entry)
        db_session.flush()
        before = prefs.energy_morning_high
        update_energy_weights_from_tasks(prefs, [entry])
        assert prefs.energy_morning_high == before  # unchanged

    def test_invalid_energy_level_on_task_skipped(self, db_session):
        user = _make_user(db_session)
        prefs = _make_prefs(db_session, user.id)
        task = Task(user_id=user.id, title="T", energy_level="extreme",  # invalid
                    task_type="flexible")
        db_session.add(task)
        db_session.flush()
        entry = TaskFeedback(
            user_id=user.id, task_id=task.id, date="2030-01-01",
            feeling="drained", time_of_day_done="morning",
            would_move=False,
        )
        db_session.add(entry)
        db_session.flush()
        before = prefs.energy_morning_high
        update_energy_weights_from_tasks(prefs, [entry])
        assert prefs.energy_morning_high == before


class TestUpdateScheduleDensityEmptyDays:
    def test_day_with_no_ratings_is_skipped(self, db_session):
        """DailyFeedback rows with all-None stress/boredom don't affect density."""
        user = _make_user(db_session)
        prefs = _make_prefs(db_session, user.id)
        # A row with no values at all
        empty_day = _make_daily(db_session, user.id, "2030-01-01")
        prefs.schedule_density = "relaxed"
        update_schedule_density(prefs, [empty_day])
        assert prefs.schedule_density == "relaxed"  # unchanged


class TestUpdateTaskPreferredTimes:
    def test_consistent_would_move_updates_preferred_time(self, db_session):
        """Task with >= WOULD_MOVE_THRESHOLD consistent would_move signals is updated."""
        user = _make_user(db_session)
        task = Task(user_id=user.id, title="Study", energy_level="high",
                    task_type="flexible", preferred_time="none",
                    preferred_time_locked=False)
        db_session.add(task)
        db_session.flush()

        for i in range(WOULD_MOVE_THRESHOLD):
            fb = TaskFeedback(
                user_id=user.id, task_id=task.id,
                date=f"2030-01-0{i + 1}",
                would_move=True,
                preferred_time_given="morning",
            )
            db_session.add(fb)
        db_session.flush()

        update_task_preferred_times(user.id, "2030-01-10", db_session)
        db_session.flush()
        assert task.preferred_time == "morning"

    def test_inconsistent_signals_do_not_update(self, db_session):
        """Mixed would_move signals (below 60% consistency) leave preferred_time unchanged."""
        user = _make_user(db_session)
        task = Task(user_id=user.id, title="Mixed", energy_level="medium",
                    task_type="flexible", preferred_time="none",
                    preferred_time_locked=False)
        db_session.add(task)
        db_session.flush()

        # 1 morning, 1 afternoon, 1 evening — no clear winner
        for i, t in enumerate(["morning", "afternoon", "evening"]):
            db_session.add(TaskFeedback(
                user_id=user.id, task_id=task.id,
                date=f"2030-02-0{i + 1}",
                would_move=True,
                preferred_time_given=t,
            ))
        db_session.flush()

        update_task_preferred_times(user.id, "2030-02-10", db_session)
        db_session.flush()
        assert task.preferred_time == "none"  # unchanged

    def test_locked_task_not_updated(self, db_session):
        """preferred_time_locked=True prevents update even with consistent signals."""
        user = _make_user(db_session)
        task = Task(user_id=user.id, title="Locked", energy_level="high",
                    task_type="flexible", preferred_time="evening",
                    preferred_time_locked=True)
        db_session.add(task)
        db_session.flush()

        for i in range(WOULD_MOVE_THRESHOLD):
            db_session.add(TaskFeedback(
                user_id=user.id, task_id=task.id,
                date=f"2030-03-0{i + 1}",
                would_move=True,
                preferred_time_given="morning",
            ))
        db_session.flush()

        update_task_preferred_times(user.id, "2030-03-10", db_session)
        db_session.flush()
        assert task.preferred_time == "evening"  # locked — unchanged
