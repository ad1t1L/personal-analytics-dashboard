"""
rule_based.py
-------------
The main scheduling algorithm. Takes a list of tasks and user preferences
and returns a fully built schedule for the day.

Algorithm overview:
  1. Separate fixed tasks (anchors) from flexible/semi tasks
  2. Place fixed tasks into the schedule first -- they cannot move
  3. Find the free time windows between fixed tasks
  4. Rank remaining tasks using priority_engine.score_task_for_slot
  5. Fill free windows with ranked tasks, best-scoring slot first
  6. Any tasks that don't fit go into the overflow list
  7. Apply final constraint check to catch any edge cases

The output is two lists:
  scheduled -- tasks with assigned start/end times, sorted by start time
  overflow  -- tasks that could not fit into the day

Both lists use the ScheduledTask TypedDict from constraints.py so the
API route can serialize them consistently.
"""

from datetime import date

from .constraints import (
    ScheduledTask,
    hhmm_to_min,
    min_to_hhmm,
    time_of_day,
    find_free_slots,
    apply_constraints,
    has_conflict_with_fixed,
)
from .priority_engine import score_task_for_slot, rank_tasks


# ── Default preferences (used when no UserPreferences row exists yet) ─────────

DEFAULT_PREFS = {
    "wake_time"               : "07:00",
    "sleep_time"              : "23:00",
    "chronotype"              : "neutral",
    "schedule_density"        : "relaxed",
    "preferred_buffer_minutes": 10,
    "energy_morning_high"     : 0.8,   # most people handle hard tasks better in morning
    "energy_morning_medium"   : 0.7,
    "energy_morning_low"      : 0.5,
    "energy_afternoon_high"   : 0.5,
    "energy_afternoon_medium" : 0.7,
    "energy_afternoon_low"    : 0.6,
    "energy_evening_high"     : 0.3,
    "energy_evening_medium"   : 0.5,
    "energy_evening_low"      : 0.8,   # low-energy tasks suit evenings
}


# ── Task -> ScheduledTask builder ─────────────────────────────────────────────

def make_scheduled_task(task: dict, start_min: int) -> ScheduledTask:
    """Build a ScheduledTask dict from a raw task dict and a chosen start time."""
    duration = task.get("duration_minutes", 30)
    end_min  = start_min + duration
    return ScheduledTask(
        task_id           = task["id"],
        title             = task["title"],
        start_min         = start_min,
        end_min           = end_min,
        energy_level      = task.get("energy_level", "medium"),
        task_type         = task.get("task_type", "flexible"),
        times_rescheduled = task.get("times_rescheduled", 0),
    )


# ── Slot finder for a single task ─────────────────────────────────────────────

def find_best_slot(
    task         : dict,
    free_slots   : list[tuple[int, int]],
    fixed_tasks  : list[ScheduledTask],
    placed_tasks : list[ScheduledTask],
    today_str    : str,
    prefs        : dict,
    buffer_min   : int,
) -> tuple[int, float] | tuple[None, None]:
    """
    Find the best available start time for a task across all free slots.

    For each position in each free slot, compute a score based on:
      - What time of day that position falls in
      - How well that matches the task's energy level and preference

    We try positions at 15-minute increments within each free slot.

    Returns (best_start_min, best_score) or (None, None) if no slot fits.
    """
    duration    = task.get("duration_minutes", 30)
    best_start  = None
    best_score  = -1.0

    for slot_start, slot_end in free_slots:
        # Step through the slot in 15-minute increments
        cursor = slot_start
        while cursor + duration <= slot_end:
            candidate_end = cursor + duration

            # Make sure we're not overlapping any already-placed task (with buffer)
            conflict = False
            for placed in placed_tasks:
                if cursor < placed["end_min"] + buffer_min and placed["start_min"] - buffer_min < candidate_end:
                    conflict = True
                    break

            if not conflict and not has_conflict_with_fixed(cursor, candidate_end, fixed_tasks):
                tod   = time_of_day(cursor)
                score = score_task_for_slot(task, tod, today_str, prefs)
                if score > best_score:
                    best_score = score
                    best_start = cursor

            cursor += 15  # 15-minute resolution

    if best_start is None:
        return None, None
    return best_start, best_score


# ── Main build function ───────────────────────────────────────────────────────

def build_schedule(
    tasks     : list[dict],
    prefs     : dict | None = None,
    today_str : str | None  = None,
) -> dict:
    """
    Build a full day schedule from a list of tasks and user preferences.

    Args:
        tasks     : list of task dicts (from DB, serialized)
        prefs     : user preferences dict (from UserPreferences model)
                    Pass None to use DEFAULT_PREFS (for new users)
        today_str : date string YYYY-MM-DD, defaults to today

    Returns a dict:
        {
          "date"      : "YYYY-MM-DD",
          "scheduled" : [ ScheduledTask, ... ],   # sorted by start time
          "overflow"  : [ ScheduledTask, ... ],   # tasks that did not fit
          "summary"   : {
              "total_tasks"     : int,
              "scheduled_count" : int,
              "overflow_count"  : int,
              "total_hours"     : float,
          }
        }
    """
    if prefs is None:
        prefs = DEFAULT_PREFS

    if today_str is None:
        today_str = date.today().isoformat()

    # If scheduling for today, don't place tasks in time slots that have already passed.
    # For future dates, any time in the day is valid.
    from datetime import datetime
    now = datetime.now()
    is_today = (today_str == now.date().isoformat())
    if is_today:
        now_min = now.hour * 60 + now.minute
    else:
        now_min = 0

    # ── Day boundaries ────────────────────────────────────────────────────────
    day_start_min  = hhmm_to_min(prefs.get("wake_time",  "07:00"))
    day_end_min    = hhmm_to_min(prefs.get("sleep_time", "23:00"))
    buffer_minutes = int(prefs.get("preferred_buffer_minutes", 10))

    # ── Step 1: Separate fixed and flexible tasks ──────────────────────────────
    fixed_raw    = [t for t in tasks if t.get("task_type") == "fixed"]
    flexible_raw = [t for t in tasks if t.get("task_type") != "fixed"]

    # ── Step 2: Place fixed tasks ──────────────────────────────────────────────
    fixed_scheduled: list[ScheduledTask] = []
    fixed_overflow:  list[ScheduledTask] = []

    for task in fixed_raw:
        if not task.get("fixed_start") or not task.get("fixed_end"):
            # Fixed task with no time set -- treat as semi-flexible
            flexible_raw.append({**task, "task_type": "semi"})
            continue

        start_min = hhmm_to_min(task["fixed_start"])
        end_min   = hhmm_to_min(task["fixed_end"])

        st = ScheduledTask(
            task_id           = task["id"],
            title             = task["title"],
            start_min         = start_min,
            end_min           = end_min,
            energy_level      = task.get("energy_level", "medium"),
            task_type         = "fixed",
            times_rescheduled = task.get("times_rescheduled", 0),
        )
        fixed_scheduled.append(st)

    # Sort fixed tasks by start time
    fixed_scheduled.sort(key=lambda t: t["start_min"])

    # ── Step 3: Find free time windows ────────────────────────────────────────
    effective_start = max(day_start_min, now_min + 30)
    free_slots = find_free_slots(fixed_scheduled, effective_start, day_end_min, buffer_minutes)

    # ── Step 4: Rank flexible/semi tasks ──────────────────────────────────────
    ranked_tasks = rank_tasks(flexible_raw, today_str, prefs)

    # ── Step 5: Fill free slots ───────────────────────────────────────────────
    placed   : list[ScheduledTask] = []
    overflow : list[ScheduledTask] = []

    for task in ranked_tasks:
        best_start, best_score = find_best_slot(
            task         = task,
            free_slots   = free_slots,
            fixed_tasks  = fixed_scheduled,
            placed_tasks = placed,
            today_str    = today_str,
            prefs        = prefs,
            buffer_min   = buffer_minutes,
        )

        if best_start is not None:
            st = make_scheduled_task(task, best_start)
            placed.append(st)
        else:
            # No slot found -- goes to overflow
            overflow.append(ScheduledTask(
                task_id           = task["id"],
                title             = task["title"],
                start_min         = -1,   # sentinel: not scheduled
                end_min           = -1,
                energy_level      = task.get("energy_level", "medium"),
                task_type         = task.get("task_type", "flexible"),
                times_rescheduled = task.get("times_rescheduled", 0),
            ))

    # ── Step 6: Combine and apply final constraint check ──────────────────────
    full_schedule  = fixed_scheduled + placed
    valid, extra_overflow = apply_constraints(
        schedule      = full_schedule,
        day_start_min = day_start_min,
        day_end_min   = day_end_min,
        buffer_minutes= buffer_minutes,
    )
    overflow.extend(extra_overflow)

    # Sort final schedule by start time
    valid.sort(key=lambda t: t["start_min"])

    # ── Step 7: Add human-readable time strings ───────────────────────────────
    scheduled_out = []
    for st in valid:
        item = dict(st)
        item["start_time"] = min_to_hhmm(st["start_min"])
        item["end_time"]   = min_to_hhmm(st["end_min"])
        item["time_of_day"] = time_of_day(st["start_min"])
        scheduled_out.append(item)

    overflow_out = []
    for st in overflow:
        item = dict(st)
        item["start_time"]  = None
        item["end_time"]    = None
        item["time_of_day"] = None
        overflow_out.append(item)

    # ── Summary ───────────────────────────────────────────────────────────────
    total_scheduled_minutes = sum(
        t["end_min"] - t["start_min"] for t in valid
    )

    return {
        "date"      : today_str,
        "scheduled" : scheduled_out,
        "overflow"  : overflow_out,
        "summary"   : {
            "total_tasks"     : len(tasks),
            "scheduled_count" : len(scheduled_out),
            "overflow_count"  : len(overflow_out),
            "total_hours"     : round(total_scheduled_minutes / 60, 1),
        },
    }
