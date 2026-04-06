"""
Unit tests for backend/scheduler/learning_engine.py.

Pure function tests (no HTTP client) covering all helper functions,
the four weight-update routines, and the main run_end_of_day_learning
entry point.  DB-touching tests use db_session directly.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from backend.scheduler.learning_engine import (
    LEARNING_RATE,
    MIN_FEEDBACK_DAYS,
    HIGH_STRESS_THRESHOLD,
    HIGH_BOREDOM_THRESHOLD,
    WOULD_MOVE_THRESHOLD,
    clamp,
    nudge,
    stress_to_signal,
    feeling_to_signal,
    avg,
    update_energy_weights_from_daily,
    update_energy_weights_from_tasks,
    update_buffer_preference,
    update_schedule_density,
    update_task_preferred_times,
    run_end_of_day_learning,
)
from backend.models import (
    User, Task, UserPreferences, DailyFeedback, TaskFeedback,
)
from backend.security import hash_password


# ── Object factories (no DB) ──────────────────────────────────────────────────

def _prefs(**kwargs) -> UserPreferences:
    """Unsaved UserPreferences with all energy weights at 0.5; override via kwargs."""
    defaults = dict(
        energy_morning_high=0.5,   energy_morning_medium=0.5,   energy_morning_low=0.5,
        energy_afternoon_high=0.5, energy_afternoon_medium=0.5, energy_afternoon_low=0.5,
        energy_evening_high=0.5,   energy_evening_medium=0.5,   energy_evening_low=0.5,
        preferred_buffer_minutes=10,
        schedule_density="relaxed",
    )
    defaults.update(kwargs)
    p = UserPreferences(user_id=0)
    for k, v in defaults.items():
        setattr(p, k, v)
    return p


def _daily(**kwargs) -> DailyFeedback:
    """Unsaved DailyFeedback with all nulls; override via kwargs."""
    d = DailyFeedback(user_id=0, date="2026-01-01")
    for k, v in kwargs.items():
        setattr(d, k, v)
    return d


# ── clamp ─────────────────────────────────────────────────────────────────────

class TestClamp:
    def test_value_in_range_unchanged(self):
        assert clamp(0.5) == pytest.approx(0.5)

    def test_exactly_zero_unchanged(self):
        assert clamp(0.0) == pytest.approx(0.0)

    def test_exactly_one_unchanged(self):
        assert clamp(1.0) == pytest.approx(1.0)

    def test_below_zero_clamped_to_zero(self):
        assert clamp(-0.5) == pytest.approx(0.0)

    def test_above_one_clamped_to_one(self):
        assert clamp(1.5) == pytest.approx(1.0)

    def test_custom_bounds(self):
        assert clamp(3, lo=5, hi=10) == 5
        assert clamp(15, lo=5, hi=10) == 10
        assert clamp(7, lo=5, hi=10) == 7


# ── nudge ─────────────────────────────────────────────────────────────────────

class TestNudge:
    def test_nudge_toward_higher_signal(self):
        result = nudge(0.5, 1.0)
        expected = 0.5 + LEARNING_RATE * (1.0 - 0.5)
        assert abs(result - expected) < 1e-9

    def test_nudge_toward_lower_signal(self):
        result = nudge(0.5, 0.0)
        expected = 0.5 + LEARNING_RATE * (0.0 - 0.5)
        assert abs(result - expected) < 1e-9

    def test_nudge_at_signal_is_no_change(self):
        assert nudge(0.7, 0.7) == pytest.approx(0.7)

    def test_nudge_result_never_exceeds_one(self):
        assert nudge(0.95, 1.0, rate=1.0) == pytest.approx(1.0)

    def test_nudge_result_never_goes_below_zero(self):
        assert nudge(0.05, 0.0, rate=1.0) == pytest.approx(0.0)

    def test_custom_rate_applied_correctly(self):
        result = nudge(0.5, 1.0, rate=0.5)
        assert abs(result - 0.75) < 1e-9


# ── stress_to_signal ──────────────────────────────────────────────────────────

class TestStressToSignal:
    def test_none_returns_none(self):
        assert stress_to_signal(None) is None

    def test_stress_1_returns_1(self):
        assert stress_to_signal(1) == pytest.approx(1.0)

    def test_stress_5_returns_0(self):
        assert stress_to_signal(5) == pytest.approx(0.0)

    def test_stress_3_is_midpoint(self):
        sig = stress_to_signal(3)
        assert 0.0 < sig < 1.0

    def test_higher_stress_gives_lower_signal(self):
        assert stress_to_signal(4) < stress_to_signal(2)


# ── feeling_to_signal ─────────────────────────────────────────────────────────

class TestFeelingToSignal:
    def test_energized_returns_1(self):
        assert feeling_to_signal("energized") == pytest.approx(1.0)

    def test_neutral_returns_0_5(self):
        assert feeling_to_signal("neutral") == pytest.approx(0.5)

    def test_drained_returns_0(self):
        assert feeling_to_signal("drained") == pytest.approx(0.0)

    def test_none_returns_none(self):
        assert feeling_to_signal(None) is None

    def test_unknown_string_returns_none(self):
        assert feeling_to_signal("happy") is None


# ── avg ───────────────────────────────────────────────────────────────────────

class TestAvg:
    def test_empty_list_returns_none(self):
        assert avg([]) is None

    def test_all_none_returns_none(self):
        assert avg([None, None]) is None  # type: ignore[list-item]

    def test_none_values_ignored(self):
        result = avg([None, 2.0, 4.0])  # type: ignore[list-item]
        assert result == pytest.approx(3.0)

    def test_normal_average(self):
        assert avg([1.0, 2.0, 3.0]) == pytest.approx(2.0)

    def test_single_value(self):
        assert avg([0.7]) == pytest.approx(0.7)


# ── update_energy_weights_from_daily ─────────────────────────────────────────

class TestUpdateEnergyWeightsFromDaily:

    def test_high_stress_decreases_high_energy_weight(self):
        p = _prefs(energy_morning_high=0.5)
        update_energy_weights_from_daily(p, _daily(stress_morning=5))
        assert p.energy_morning_high < 0.5

    def test_low_stress_increases_high_energy_weight(self):
        p = _prefs(energy_morning_high=0.5)
        update_energy_weights_from_daily(p, _daily(stress_morning=1))
        assert p.energy_morning_high > 0.5

    def test_none_stress_leaves_weight_unchanged(self):
        p = _prefs(energy_morning_high=0.5)
        update_energy_weights_from_daily(p, _daily())  # all None
        assert p.energy_morning_high == pytest.approx(0.5)

    def test_medium_weight_nudged_less_than_high_weight(self):
        """Medium energy gets LEARNING_RATE * 0.5, so smaller change than high."""
        p = _prefs(energy_morning_high=0.5, energy_morning_medium=0.5)
        update_energy_weights_from_daily(p, _daily(stress_morning=5))
        high_drop = 0.5 - p.energy_morning_high
        med_drop = 0.5 - p.energy_morning_medium
        assert high_drop > med_drop

    def test_low_energy_weight_unaffected_by_stress(self):
        p = _prefs(energy_morning_low=0.5)
        update_energy_weights_from_daily(p, _daily(stress_morning=5))
        assert p.energy_morning_low == pytest.approx(0.5)

    def test_all_three_periods_updated(self):
        p = _prefs(
            energy_morning_high=0.5,
            energy_afternoon_high=0.5,
            energy_evening_high=0.5,
        )
        update_energy_weights_from_daily(
            p, _daily(stress_morning=5, stress_afternoon=5, stress_evening=5)
        )
        assert p.energy_morning_high < 0.5
        assert p.energy_afternoon_high < 0.5
        assert p.energy_evening_high < 0.5

    def test_weight_stays_within_0_1_range(self):
        p = _prefs(energy_morning_high=0.01)
        update_energy_weights_from_daily(p, _daily(stress_morning=5))
        assert 0.0 <= p.energy_morning_high <= 1.0


# ── update_energy_weights_from_tasks ─────────────────────────────────────────

class TestUpdateEnergyWeightsFromTasks:

    def _entry(self, feeling, time_of_day, energy_level):
        """Build a plain namespace that duck-types as a TaskFeedback entry."""
        from types import SimpleNamespace
        return SimpleNamespace(
            feeling=feeling,
            time_of_day_done=time_of_day,
            task=SimpleNamespace(energy_level=energy_level),
        )

    def test_drained_decreases_weight(self):
        p = _prefs(energy_morning_high=0.5)
        update_energy_weights_from_tasks(p, [self._entry("drained", "morning", "high")])
        assert p.energy_morning_high < 0.5

    def test_energized_increases_weight(self):
        p = _prefs(energy_morning_high=0.5)
        update_energy_weights_from_tasks(p, [self._entry("energized", "morning", "high")])
        assert p.energy_morning_high > 0.5

    def test_neutral_nudges_toward_0_5(self):
        p = _prefs(energy_morning_high=0.8)
        update_energy_weights_from_tasks(p, [self._entry("neutral", "morning", "high")])
        assert p.energy_morning_high < 0.8  # nudged toward 0.5

    def test_none_feeling_no_change(self):
        p = _prefs(energy_morning_high=0.5)
        update_energy_weights_from_tasks(p, [self._entry(None, "morning", "high")])
        assert p.energy_morning_high == pytest.approx(0.5)

    def test_invalid_time_of_day_no_change(self):
        p = _prefs(energy_morning_high=0.5)
        update_energy_weights_from_tasks(p, [self._entry("drained", "noon", "high")])
        assert p.energy_morning_high == pytest.approx(0.5)

    def test_task_none_no_change(self):
        from types import SimpleNamespace
        p = _prefs(energy_morning_high=0.5)
        e = SimpleNamespace(feeling="drained", time_of_day_done="morning", task=None)
        update_energy_weights_from_tasks(p, [e])
        assert p.energy_morning_high == pytest.approx(0.5)

    def test_empty_entries_no_change(self):
        p = _prefs(energy_morning_high=0.5)
        update_energy_weights_from_tasks(p, [])
        assert p.energy_morning_high == pytest.approx(0.5)


# ── update_buffer_preference ──────────────────────────────────────────────────

class TestUpdateBufferPreference:

    def test_high_avg_stress_increases_buffer(self):
        p = _prefs(preferred_buffer_minutes=10)
        days = [_daily(
            stress_morning=5, stress_afternoon=5, stress_evening=5,
            boredom_morning=1, boredom_afternoon=1, boredom_evening=1,
        )]
        update_buffer_preference(p, days)
        assert p.preferred_buffer_minutes > 10

    def test_high_avg_boredom_decreases_buffer(self):
        p = _prefs(preferred_buffer_minutes=20)
        days = [_daily(
            stress_morning=1, stress_afternoon=1, stress_evening=1,
            boredom_morning=5, boredom_afternoon=5, boredom_evening=5,
        )]
        update_buffer_preference(p, days)
        assert p.preferred_buffer_minutes < 20

    def test_buffer_never_goes_below_5(self):
        p = _prefs(preferred_buffer_minutes=5)
        days = [_daily(stress_morning=1, boredom_morning=5)]
        update_buffer_preference(p, days)
        assert p.preferred_buffer_minutes >= 5

    def test_buffer_never_exceeds_30(self):
        p = _prefs(preferred_buffer_minutes=30)
        days = [_daily(stress_morning=5, boredom_morning=1)]
        update_buffer_preference(p, days)
        assert p.preferred_buffer_minutes <= 30

    def test_empty_days_no_change(self):
        p = _prefs(preferred_buffer_minutes=10)
        update_buffer_preference(p, [])
        assert p.preferred_buffer_minutes == 10

    def test_no_ratings_no_change(self):
        p = _prefs(preferred_buffer_minutes=10)
        update_buffer_preference(p, [_daily()])  # all None
        assert p.preferred_buffer_minutes == 10


# ── update_schedule_density ───────────────────────────────────────────────────

class TestUpdateScheduleDensity:

    def _stress_heavy(self):
        return _daily(
            stress_morning=5, boredom_morning=1,
            stress_afternoon=5, boredom_afternoon=1,
        )

    def _boredom_heavy(self):
        return _daily(
            stress_morning=1, boredom_morning=5,
            stress_afternoon=1, boredom_afternoon=5,
        )

    def test_three_stress_heavy_days_sets_relaxed(self):
        p = _prefs(schedule_density="packed")
        update_schedule_density(p, [self._stress_heavy() for _ in range(3)])
        assert p.schedule_density == "relaxed"

    def test_three_boredom_heavy_days_sets_packed(self):
        p = _prefs(schedule_density="relaxed")
        update_schedule_density(p, [self._boredom_heavy() for _ in range(3)])
        assert p.schedule_density == "packed"

    def test_mixed_signal_leaves_density_unchanged(self):
        p = _prefs(schedule_density="relaxed")
        update_schedule_density(p, [self._stress_heavy(), self._boredom_heavy()])
        assert p.schedule_density == "relaxed"

    def test_fewer_than_three_stress_days_no_change(self):
        p = _prefs(schedule_density="packed")
        update_schedule_density(p, [self._stress_heavy(), self._stress_heavy()])
        assert p.schedule_density == "packed"

    def test_day_with_no_ratings_skipped(self):
        """Days where stress or boredom are all None do not count."""
        p = _prefs(schedule_density="packed")
        days = [self._stress_heavy(), self._stress_heavy(), _daily()]  # 2 real + 1 empty
        update_schedule_density(p, days)
        assert p.schedule_density == "packed"  # not enough stress-heavy days


# ── update_task_preferred_times ───────────────────────────────────────────────

class TestUpdateTaskPreferredTimes:

    def test_consistent_would_move_updates_preferred_time(self, db_session):
        user = User(
            name="Learner", email="learner@example.com",
            password_hash=hash_password("Learn1"), is_verified=True, is_active=True,
        )
        db_session.add(user)
        db_session.flush()

        task = Task(
            user_id=user.id, title="Study",
            preferred_time="none", preferred_time_locked=False,
        )
        db_session.add(task)
        db_session.flush()

        for i in range(WOULD_MOVE_THRESHOLD + 1):
            db_session.add(TaskFeedback(
                user_id=user.id, task_id=task.id,
                date=f"2026-01-{i+1:02d}",
                would_move=True, preferred_time_given="morning",
            ))
        db_session.commit()

        update_task_preferred_times(user.id, "2026-01-03", db_session)
        # update_task_preferred_times modifies in-memory; check without refresh
        assert task.preferred_time == "morning"

    def test_locked_task_not_updated(self, db_session):
        user = User(
            name="Locked", email="locked@example.com",
            password_hash=hash_password("Lock1"), is_verified=True, is_active=True,
        )
        db_session.add(user)
        db_session.flush()

        task = Task(
            user_id=user.id, title="Locked task",
            preferred_time="evening", preferred_time_locked=True,
        )
        db_session.add(task)
        db_session.flush()

        for i in range(WOULD_MOVE_THRESHOLD + 1):
            db_session.add(TaskFeedback(
                user_id=user.id, task_id=task.id,
                date=f"2026-01-{i+1:02d}",
                would_move=True, preferred_time_given="morning",
            ))
        db_session.commit()

        update_task_preferred_times(user.id, "2026-01-03", db_session)
        assert task.preferred_time == "evening"  # unchanged

    def test_below_threshold_signals_no_update(self, db_session):
        user = User(
            name="FewFb", email="fewfb@example.com",
            password_hash=hash_password("FewFb1"), is_verified=True, is_active=True,
        )
        db_session.add(user)
        db_session.flush()

        task = Task(
            user_id=user.id, title="Rarely moved",
            preferred_time="none", preferred_time_locked=False,
        )
        db_session.add(task)
        db_session.flush()

        # Only WOULD_MOVE_THRESHOLD - 1 entries (not enough)
        for i in range(WOULD_MOVE_THRESHOLD - 1):
            db_session.add(TaskFeedback(
                user_id=user.id, task_id=task.id,
                date=f"2026-01-{i+1:02d}",
                would_move=True, preferred_time_given="morning",
            ))
        db_session.commit()

        update_task_preferred_times(user.id, "2026-01-01", db_session)
        assert task.preferred_time == "none"

    def test_below_60pct_consistency_no_update(self, db_session):
        """All three time-of-day values each appear once (33%) — below the 60% threshold."""
        user = User(
            name="Spread", email="spread@example.com",
            password_hash=hash_password("Spread1"), is_verified=True, is_active=True,
        )
        db_session.add(user)
        db_session.flush()

        task = Task(
            user_id=user.id, title="Evenly split",
            preferred_time="none", preferred_time_locked=False,
        )
        db_session.add(task)
        db_session.flush()

        # 3 entries with 3 different preferred times → max consistency = 1/3 < 0.6
        for i, t in enumerate(["morning", "afternoon", "evening"]):
            db_session.add(TaskFeedback(
                user_id=user.id, task_id=task.id,
                date=f"2026-01-{i+1:02d}",
                would_move=True, preferred_time_given=t,
            ))
        db_session.commit()

        update_task_preferred_times(user.id, "2026-01-03", db_session)
        assert task.preferred_time == "none"  # unchanged — no clear winner


# ── run_end_of_day_learning ───────────────────────────────────────────────────

class TestRunEndOfDayLearning:

    def _seed_feedback_days(self, db_session, n_days: int) -> tuple[int, str]:
        """Create a user with n_days daily feedback rows. Returns (user_id, today_str)."""
        user = User(
            name=f"ML{n_days}", email=f"ml{n_days}@example.com",
            password_hash=hash_password("Mluser1"), is_verified=True, is_active=True,
        )
        db_session.add(user)
        db_session.flush()

        today = date.today()
        for i in range(n_days):
            day_str = (today - timedelta(days=n_days - 1 - i)).isoformat()
            db_session.add(DailyFeedback(
                user_id=user.id, date=day_str,
                stress_morning=3, boredom_morning=2,
                stress_afternoon=2, boredom_afternoon=2,
                stress_evening=2, boredom_evening=2,
            ))
        db_session.commit()
        return user.id, today.isoformat()

    def test_below_min_days_does_not_run(self, db_session):
        user_id, today = self._seed_feedback_days(db_session, MIN_FEEDBACK_DAYS - 1)
        result = run_end_of_day_learning(user_id, today, db_session)
        assert result["ran"] is False
        assert "reason" in result

    def test_at_min_days_runs(self, db_session):
        user_id, today = self._seed_feedback_days(db_session, MIN_FEEDBACK_DAYS)
        result = run_end_of_day_learning(user_id, today, db_session)
        assert result["ran"] is True

    def test_result_includes_current_weights(self, db_session):
        user_id, today = self._seed_feedback_days(db_session, MIN_FEEDBACK_DAYS)
        result = run_end_of_day_learning(user_id, today, db_session)
        weights = result["current_weights"]
        for key in (
            "energy_morning_high", "energy_morning_medium", "energy_morning_low",
            "energy_afternoon_high", "energy_afternoon_medium", "energy_afternoon_low",
            "energy_evening_high", "energy_evening_medium", "energy_evening_low",
            "buffer_minutes", "schedule_density",
        ):
            assert key in weights

    def test_creates_preferences_row_when_none_exists(self, db_session):
        user_id, today = self._seed_feedback_days(db_session, MIN_FEEDBACK_DAYS)
        run_end_of_day_learning(user_id, today, db_session)
        prefs = db_session.query(UserPreferences).filter(
            UserPreferences.user_id == user_id
        ).first()
        assert prefs is not None

    def test_feedback_days_total_reported_correctly(self, db_session):
        n = MIN_FEEDBACK_DAYS + 2
        user_id, today = self._seed_feedback_days(db_session, n)
        result = run_end_of_day_learning(user_id, today, db_session)
        assert result["feedback_days_total"] == n
