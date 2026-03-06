"""
constraints.py
--------------
Handles all hard rules that the scheduler cannot violate:

  1. Fixed tasks own their time slot -- nothing can be placed there
  2. Every task must fall within the user's wake/sleep window
  3. No two tasks can overlap
  4. A buffer gap is enforced between tasks (from UserPreferences)

The main entry point is apply_constraints(), which takes a proposed
schedule and returns a cleaned version with any violations resolved.

Time is represented internally as integer minutes-since-midnight throughout
this file. e.g. "09:30" = 570. Helper functions handle conversion.
"""

from typing import TypedDict


# ── Types ─────────────────────────────────────────────────────────────────────

class ScheduledTask(TypedDict):
    task_id            : int
    title              : str
    start_min          : int   # minutes since midnight
    end_min            : int   # minutes since midnight
    energy_level       : str
    task_type          : str
    times_rescheduled  : int


# ── Time helpers ──────────────────────────────────────────────────────────────

def hhmm_to_min(hhmm: str) -> int:
    """Convert 'HH:MM' string to minutes since midnight. '09:30' -> 570."""
    h, m = hhmm.strip().split(":")
    return int(h) * 60 + int(m)


def min_to_hhmm(minutes: int) -> str:
    """Convert minutes since midnight back to 'HH:MM'. 570 -> '09:30'."""
    minutes = max(0, min(minutes, 1439))  # clamp to valid day range
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def time_of_day(start_min: int) -> str:
    """
    Classify a start time as morning / afternoon / evening.
      morning   : 00:00 - 11:59
      afternoon : 12:00 - 17:59
      evening   : 18:00 - 23:59
    """
    if start_min < 720:   # before noon
        return "morning"
    if start_min < 1080:  # before 6pm
        return "afternoon"
    return "evening"


# ── Overlap detection ─────────────────────────────────────────────────────────

def overlaps(a: ScheduledTask, b: ScheduledTask) -> bool:
    """Return True if two scheduled tasks overlap in time."""
    return a["start_min"] < b["end_min"] and b["start_min"] < a["end_min"]


def has_conflict_with_fixed(candidate_start: int, candidate_end: int,
                             fixed_tasks: list[ScheduledTask]) -> bool:
    """
    Check whether a proposed time window conflicts with any fixed task.
    Used by the slot-finding logic in rule_based.py.
    """
    for ft in fixed_tasks:
        if candidate_start < ft["end_min"] and ft["start_min"] < candidate_end:
            return True
    return False


# ── Free slot finder ──────────────────────────────────────────────────────────

def find_free_slots(
    fixed_tasks    : list[ScheduledTask],
    day_start_min  : int,
    day_end_min    : int,
    buffer_minutes : int = 10,
) -> list[tuple[int, int]]:
    """
    Given a list of already-placed fixed tasks and the day boundaries,
    return a list of (start, end) free windows where flexible tasks can go.

    Buffer minutes are subtracted from each end of a fixed task's slot so
    there is always a gap before and after fixed commitments.

    Returns list of (start_min, end_min) tuples, sorted by start time.
    """
    # Build a list of blocked intervals from fixed tasks (with buffer)
    blocked: list[tuple[int, int]] = []
    for ft in fixed_tasks:
        block_start = max(day_start_min, ft["start_min"] - buffer_minutes)
        block_end   = min(day_end_min,   ft["end_min"]   + buffer_minutes)
        blocked.append((block_start, block_end))

    # Sort and merge overlapping blocked intervals
    blocked.sort(key=lambda x: x[0])
    merged: list[tuple[int, int]] = []
    for start, end in blocked:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))

    # Free slots are the gaps between blocked intervals
    free: list[tuple[int, int]] = []
    cursor = day_start_min

    for block_start, block_end in merged:
        if cursor < block_start:
            free.append((cursor, block_start))
        cursor = max(cursor, block_end)

    if cursor < day_end_min:
        free.append((cursor, day_end_min))

    return free


# ── Main constraint enforcement ───────────────────────────────────────────────

def apply_constraints(
    schedule       : list[ScheduledTask],
    day_start_min  : int,
    day_end_min    : int,
    buffer_minutes : int = 10,
) -> tuple[list[ScheduledTask], list[ScheduledTask]]:
    """
    Take a proposed schedule and enforce all hard constraints.

    Returns:
        (valid_schedule, overflow)
        valid_schedule -- tasks that fit within the day with no conflicts
        overflow       -- tasks that could not be placed (shown as 'did not fit')

    Rules enforced:
        1. Fixed tasks are always kept as-is (they anchor the day)
        2. Tasks outside wake/sleep bounds are moved to overflow
        3. Overlapping flexible tasks are moved to overflow
        4. Buffer gaps between tasks are enforced
    """
    fixed    = [t for t in schedule if t["task_type"] == "fixed"]
    flexible = [t for t in schedule if t["task_type"] != "fixed"]

    valid    : list[ScheduledTask] = []
    overflow : list[ScheduledTask] = []

    # Fixed tasks always go in -- they are ground truth
    for ft in fixed:
        if ft["start_min"] >= day_start_min and ft["end_min"] <= day_end_min:
            valid.append(ft)
        else:
            # Fixed task is outside the day window -- flag it but still include
            # (user set this time, we respect it but warn via overflow flag)
            ft_copy = dict(ft)
            ft_copy["out_of_bounds"] = True  # type: ignore
            valid.append(ft_copy)  # type: ignore

    # Flexible tasks -- check bounds and overlaps
    for task in flexible:
        # Out of day bounds
        if task["start_min"] < day_start_min or task["end_min"] > day_end_min:
            overflow.append(task)
            continue

        # Check overlap with already-valid tasks (including buffer)
        conflict = False
        for placed in valid:
            buffered_start = placed["start_min"] - buffer_minutes
            buffered_end   = placed["end_min"]   + buffer_minutes
            if task["start_min"] < buffered_end and buffered_start < task["end_min"]:
                conflict = True
                break

        if conflict:
            overflow.append(task)
        else:
            valid.append(task)

    # Sort final schedule by start time
    valid.sort(key=lambda t: t["start_min"])

    return valid, overflow
