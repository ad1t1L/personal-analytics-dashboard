"""
Unit tests for the scheduler internals.

These are pure function tests — no DB, no HTTP client needed.
They verify that the priority engine, deadline urgency, and constraint
logic work correctly in isolation, supporting story #5 (optimization engine).
"""

from __future__ import annotations

import bootstrap_sys_path  # noqa: F401

from datetime import date, timedelta

import pytest

from backend.scheduler.constraints import (
    hhmm_to_min,
    min_to_hhmm,
    time_of_day,
    find_free_slots,
    apply_constraints,
    has_conflict_with_fixed,
    ScheduledTask,
)
from backend.scheduler.priority_engine import (
    deadline_urgency,
    importance_score,
    procrastination_score,
    preferred_time_score,
    score_task_for_slot,
    rank_tasks,
)


# ── Constraint helpers ────────────────────────────────────────────────────────

class TestTimeHelpers:
    def test_hhmm_to_min_round_trip(self):
        assert hhmm_to_min("07:30") == 450
        assert min_to_hhmm(450) == "07:30"

    def test_time_of_day_boundaries(self):
        assert time_of_day(0)    == "morning"     # midnight
        assert time_of_day(719)  == "morning"     # 11:59
        assert time_of_day(720)  == "afternoon"   # noon
        assert time_of_day(1079) == "afternoon"   # 17:59
        assert time_of_day(1080) == "evening"     # 18:00


class TestFreeSlots:
    def test_no_fixed_tasks_yields_full_day(self):
        slots = find_free_slots([], 420, 1380)  # 07:00 - 23:00
        assert len(slots) == 1
        assert slots[0] == (420, 1380)

    def test_fixed_task_splits_day_into_two_slots(self):
        meeting = ScheduledTask(
            task_id=1, title="M",
            start_min=600, end_min=660,  # 10:00-11:00
            energy_level="medium", task_type="fixed", times_rescheduled=0
        )
        slots = find_free_slots([meeting], 420, 1380, buffer_minutes=10)
        # Expect: [07:00 - 09:50], [11:10 - 23:00]
        assert len(slots) == 2
        assert slots[0][1] == 590   # 09:50 (600 - 10 buffer)
        assert slots[1][0] == 670   # 11:10 (660 + 10 buffer)

    def test_conflict_with_fixed_detected(self):
        fixed = ScheduledTask(
            task_id=1, title="F",
            start_min=480, end_min=540,  # 08:00-09:00
            energy_level="high", task_type="fixed", times_rescheduled=0
        )
        assert has_conflict_with_fixed(480, 540, [fixed]) is True
        assert has_conflict_with_fixed(600, 660, [fixed]) is False


class TestApplyConstraints:
    def test_task_outside_day_bounds_goes_to_overflow(self):
        task = ScheduledTask(
            task_id=1, title="Late",
            start_min=1400, end_min=1430,  # after 23:00
            energy_level="low", task_type="flexible", times_rescheduled=0
        )
        valid, overflow = apply_constraints([task], 420, 1380)
        assert task in overflow
        assert task not in valid

    def test_overlapping_tasks_second_goes_to_overflow(self):
        t1 = ScheduledTask(task_id=1, title="T1", start_min=480, end_min=540,
                           energy_level="low", task_type="flexible", times_rescheduled=0)
        t2 = ScheduledTask(task_id=2, title="T2", start_min=500, end_min=560,
                           energy_level="low", task_type="flexible", times_rescheduled=0)
        valid, overflow = apply_constraints([t1, t2], 420, 1380, buffer_minutes=0)
        assert len(valid) == 1
        assert len(overflow) == 1


# ── Priority engine ───────────────────────────────────────────────────────────

class TestDeadlineUrgency:
    def test_no_deadline_returns_zero(self):
        assert deadline_urgency(None, "2030-01-01") == 0.0

    def test_overdue_returns_one(self):
        assert deadline_urgency("2020-01-01", "2030-01-01") == 1.0

    def test_today_deadline_returns_one(self):
        today = date.today().isoformat()
        assert deadline_urgency(today, today) == 1.0

    def test_urgency_increases_closer_to_deadline(self):
        today = date.today().isoformat()
        far = (date.today() + timedelta(days=30)).isoformat()
        near = (date.today() + timedelta(days=2)).isoformat()
        assert deadline_urgency(near, today) > deadline_urgency(far, today)


class TestImportanceScore:
    def test_normalises_to_zero_one_range(self):
        assert importance_score(1) == 0.0
        assert importance_score(5) == 1.0
        assert 0.0 < importance_score(3) < 1.0


class TestProcrastinationScore:
    def test_zero_reschedules_gives_zero(self):
        assert procrastination_score(0) == 0.0

    def test_five_plus_reschedules_caps_at_one(self):
        assert procrastination_score(5) == 1.0
        assert procrastination_score(10) == 1.0


class TestPreferredTimeScore:
    def test_no_preference_returns_neutral(self):
        assert preferred_time_score("none", "morning") == 0.5

    def test_exact_match_returns_one(self):
        assert preferred_time_score("morning", "morning") == 1.0

    def test_mismatch_returns_zero(self):
        assert preferred_time_score("morning", "evening") == 0.0


class TestRankTasks:
    def test_higher_importance_task_ranked_first(self):
        today = date.today().isoformat()
        tasks = [
            {"id": 1, "title": "Low", "task_type": "flexible", "importance": 1,
             "deadline": None, "energy_level": "medium", "preferred_time": "none",
             "times_rescheduled": 0},
            {"id": 2, "title": "High", "task_type": "flexible", "importance": 5,
             "deadline": None, "energy_level": "medium", "preferred_time": "none",
             "times_rescheduled": 0},
        ]
        from backend.scheduler.rule_based import DEFAULT_PREFS
        ranked = rank_tasks(tasks, today, DEFAULT_PREFS)
        assert ranked[0]["id"] == 2  # high importance first

    def test_overdue_task_outranks_no_deadline_task(self):
        today = date.today().isoformat()
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        tasks = [
            {"id": 1, "title": "No deadline", "task_type": "flexible", "importance": 3,
             "deadline": None, "energy_level": "medium", "preferred_time": "none",
             "times_rescheduled": 0},
            {"id": 2, "title": "Overdue", "task_type": "flexible", "importance": 3,
             "deadline": yesterday, "energy_level": "medium", "preferred_time": "none",
             "times_rescheduled": 0},
        ]
        from backend.scheduler.rule_based import DEFAULT_PREFS
        ranked = rank_tasks(tasks, today, DEFAULT_PREFS)
        assert ranked[0]["id"] == 2  # overdue task first

    def test_fixed_tasks_excluded_from_ranking(self):
        today = date.today().isoformat()
        tasks = [
            {"id": 1, "title": "Fixed", "task_type": "fixed", "importance": 5,
             "deadline": today, "energy_level": "high", "preferred_time": "none",
             "times_rescheduled": 0, "fixed_start": "09:00", "fixed_end": "10:00"},
            {"id": 2, "title": "Flex", "task_type": "flexible", "importance": 2,
             "deadline": None, "energy_level": "low", "preferred_time": "none",
             "times_rescheduled": 0},
        ]
        from backend.scheduler.rule_based import DEFAULT_PREFS
        ranked = rank_tasks(tasks, today, DEFAULT_PREFS)
        assert all(t["task_type"] != "fixed" for t in ranked)
