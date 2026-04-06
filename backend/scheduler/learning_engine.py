"""
learning_engine.py
------------------
Updates a user's learned preferences after the end of each day.

Triggered by: the evening daily check-in submission (9pm prompt).
Called from:  backend/routes/feedback.py after saving the evening period.

What it does:
  1. Checks there is enough data to learn from (min 3 days of feedback)
  2. Reads today's DailyFeedback and TaskFeedback entries
  3. Reads the last 7 days of DailyFeedback for pattern detection
  4. Nudges energy curve weights based on how tasks felt at each time of day
  5. Adjusts preferred_buffer_minutes based on stress levels
  6. Updates schedule_density based on stress vs boredom balance
  7. Updates preferred_time on tasks where would_move was consistently signalled
  8. Saves everything back to UserPreferences

Key design decision -- small nudges only:
  Each weight update pulls the current value 10% toward the new signal.
  This means a single bad day has minimal impact. Consistent feedback
  over 2 weeks moves the weights meaningfully. This prevents the schedule
  from overcorrecting based on noise.

  Formula: new_weight = old_weight + LEARNING_RATE * (signal - old_weight)
  With LEARNING_RATE = 0.10, a weight of 0.5 receiving a signal of 1.0
  moves to 0.55. It takes ~14 consistent signals to reach 0.80.
"""

from datetime import date, timedelta
from sqlalchemy.orm import Session

from backend.models import Task, UserPreferences, DailyFeedback, TaskFeedback


# ── Constants ─────────────────────────────────────────────────────────────────

# How much each day's feedback pulls the weights. 0.10 = 10% nudge per day.
LEARNING_RATE = 0.10

# Minimum number of days with feedback before the engine updates anything.
# Below this threshold the defaults are more reliable than the sparse data.
MIN_FEEDBACK_DAYS = 3

# How many days back to look when detecting weekly patterns
PATTERN_WINDOW_DAYS = 7

# Stress/boredom thresholds for schedule density decisions
HIGH_STRESS_THRESHOLD  = 3.5   # average stress above this = too packed
HIGH_BOREDOM_THRESHOLD = 3.5   # average boredom above this = too light

# How many times would_move must be True for a task before we update preferred_time
WOULD_MOVE_THRESHOLD = 2


# ── Helpers ───────────────────────────────────────────────────────────────────

def clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    """Clamp a float to [lo, hi]."""
    return max(lo, min(hi, value))


def nudge(current: float, signal: float, rate: float = LEARNING_RATE) -> float:
    """
    Pull current weight toward signal by rate.
    new = current + rate * (signal - current)
    """
    return clamp(current + rate * (signal - current))


def stress_to_signal(stress: int | None) -> float | None:
    """
    Convert a 1-5 stress rating to a 0.0-1.0 energy weight signal.

    High stress during a period means the tasks scheduled there were
    too demanding -- the energy weights for high-energy tasks in that
    period should decrease.

    stress 1 (very relaxed) -> signal 1.0 (period handled tasks well)
    stress 5 (very stressed) -> signal 0.0 (period was overloaded)
    """
    if stress is None:
        return None
    return clamp(1.0 - (stress - 1) / 4.0)


def feeling_to_signal(feeling: str | None) -> float | None:
    """
    Convert a task feeling rating to a 0.0-1.0 energy weight signal.

    energized -> 1.0 (great fit for this energy level at this time)
    neutral   -> 0.5 (no strong signal either way)
    drained   -> 0.0 (poor fit, task was too demanding for this slot)
    """
    if feeling is None:
        return None
    return {"energized": 1.0, "neutral": 0.5, "drained": 0.0}.get(feeling)


def avg(values: list[float]) -> float | None:
    """Return average of a list, or None if empty."""
    clean = [v for v in values if v is not None]
    return sum(clean) / len(clean) if clean else None


# ── Feedback data loader ───────────────────────────────────────────────────────

def load_todays_task_feedback(
    user_id   : int,
    date_str  : str,
    db        : Session,
) -> list[TaskFeedback]:
    """Load all TaskFeedback entries for today."""
    return (
        db.query(TaskFeedback)
        .filter(
            TaskFeedback.user_id == user_id,
            TaskFeedback.date    == date_str,
        )
        .all()
    )


def load_recent_daily_feedback(
    user_id     : int,
    date_str    : str,
    days_back   : int,
    db          : Session,
) -> list[DailyFeedback]:
    """Load the last N days of DailyFeedback including today."""
    cutoff = (date.fromisoformat(date_str) - timedelta(days=days_back)).isoformat()
    return (
        db.query(DailyFeedback)
        .filter(
            DailyFeedback.user_id == user_id,
            DailyFeedback.date   >= cutoff,
            DailyFeedback.date   <= date_str,
        )
        .all()
    )


# ── Core update functions ─────────────────────────────────────────────────────

def update_energy_weights_from_daily(
    prefs      : UserPreferences,
    daily      : DailyFeedback,
) -> None:
    """
    Use today's stress ratings to nudge the energy curve weights.

    Logic:
    - High stress in a period signals that high-energy tasks there were
      too demanding -> nudge high energy weight DOWN for that period
    - Low stress signals the period handled its tasks well
      -> nudge high energy weight UP
    - We apply the same signal to medium energy but at half strength
    - Low energy tasks are not affected by stress (they're never the cause)

    The stress signal applies uniformly to all energy levels in a period
    because we don't know exactly which tasks caused the stress --
    that's refined further by the per-task feedback below.
    """
    periods = {
        "morning"  : daily.stress_morning,
        "afternoon": daily.stress_afternoon,
        "evening"  : daily.stress_evening,
    }

    for period, stress in periods.items():
        signal = stress_to_signal(stress)
        if signal is None:
            continue

        # High energy weight gets the full signal
        key_high = f"energy_{period}_high"
        current  = getattr(prefs, key_high, 0.5)
        setattr(prefs, key_high, nudge(current, signal))

        # Medium energy weight gets a half-strength signal
        key_med  = f"energy_{period}_medium"
        current  = getattr(prefs, key_med, 0.5)
        setattr(prefs, key_med, nudge(current, signal, LEARNING_RATE * 0.5))

        # Low energy is unaffected by stress signals


def update_energy_weights_from_tasks(
    prefs        : UserPreferences,
    task_entries : list[TaskFeedback],
) -> None:
    """
    Use per-task feeling ratings to give more precise energy weight updates.

    This is more accurate than the daily stress signal because we know
    exactly what energy level the task was and what time of day it was done.

    Example: if user felt "drained" doing a high-energy task in the morning,
    energy_morning_high nudges down. If they felt "energized" doing a
    low-energy task in the evening, energy_evening_low nudges up.
    """
    for entry in task_entries:
        signal = feeling_to_signal(entry.feeling)
        if signal is None:
            continue

        time_of_day = entry.time_of_day_done
        if time_of_day not in ("morning", "afternoon", "evening"):
            continue

        # We need the task's energy level -- join through the task
        task = entry.task
        if task is None:
            continue

        energy = task.energy_level
        if energy not in ("high", "medium", "low"):
            continue

        key     = f"energy_{time_of_day}_{energy}"
        current = getattr(prefs, key, 0.5)
        setattr(prefs, key, nudge(current, signal))


def update_buffer_preference(
    prefs         : UserPreferences,
    recent_daily  : list[DailyFeedback],
) -> None:
    """
    Adjust preferred_buffer_minutes based on recent stress patterns.

    If average stress across periods has been consistently high,
    the user needs more breathing room between tasks -- increase buffer.
    If average boredom has been consistently high, the schedule is too
    light -- decrease buffer (pack tasks closer together).

    Buffer is clamped between 5 and 30 minutes.
    """
    all_stress  = []
    all_boredom = []

    for day in recent_daily:
        for val in (day.stress_morning, day.stress_afternoon, day.stress_evening):
            if val is not None:
                all_stress.append(val)
        for val in (day.boredom_morning, day.boredom_afternoon, day.boredom_evening):
            if val is not None:
                all_boredom.append(val)

    avg_stress  = avg(all_stress)
    avg_boredom = avg(all_boredom)

    if avg_stress is None and avg_boredom is None:
        return

    current_buffer = prefs.preferred_buffer_minutes

    if avg_stress is not None and avg_stress >= HIGH_STRESS_THRESHOLD:
        # Too stressed -- add 2 minutes of buffer, up to 30
        prefs.preferred_buffer_minutes = min(30, current_buffer + 2)

    elif avg_boredom is not None and avg_boredom >= HIGH_BOREDOM_THRESHOLD:
        # Too bored -- reduce buffer by 2 minutes, down to 5
        prefs.preferred_buffer_minutes = max(5, current_buffer - 2)


def update_schedule_density(
    prefs        : UserPreferences,
    recent_daily : list[DailyFeedback],
) -> None:
    """
    Update schedule_density based on the stress vs boredom balance
    over the last PATTERN_WINDOW_DAYS days.

    If stress consistently outweighs boredom -> set to "relaxed"
    If boredom consistently outweighs stress -> set to "packed"

    Only changes if the signal is consistent -- requires at least 3 days
    with a clear imbalance before flipping the density setting.
    """
    stress_heavy_days  = 0
    boredom_heavy_days = 0

    for day in recent_daily:
        stress_vals  = [v for v in (day.stress_morning,  day.stress_afternoon,  day.stress_evening)  if v is not None]
        boredom_vals = [v for v in (day.boredom_morning, day.boredom_afternoon, day.boredom_evening) if v is not None]

        if not stress_vals or not boredom_vals:
            continue

        day_stress  = sum(stress_vals)  / len(stress_vals)
        day_boredom = sum(boredom_vals) / len(boredom_vals)

        if day_stress > day_boredom + 0.5:    # stress clearly dominates
            stress_heavy_days += 1
        elif day_boredom > day_stress + 0.5:  # boredom clearly dominates
            boredom_heavy_days += 1

    if stress_heavy_days >= 3:
        prefs.schedule_density = "relaxed"
    elif boredom_heavy_days >= 3:
        prefs.schedule_density = "packed"
    # If mixed signal, leave density unchanged


def update_task_preferred_times(
    user_id      : int,
    date_str     : str,
    db           : Session,
) -> None:
    """
    Scan all TaskFeedback entries for this user and update preferred_time
    on tasks where would_move has been True consistently.

    A task's preferred_time is updated only when:
    - would_move = True appears at least WOULD_MOVE_THRESHOLD times
    - preferred_time_given is consistent (same answer each time)
    - preferred_time_locked is False on the task

    This runs across all historical feedback, not just today,
    so patterns that emerge gradually are still caught.
    """
    # Get all tasks for this user that are not locked
    tasks = (
        db.query(Task)
        .filter(
            Task.user_id              == user_id,
            Task.preferred_time_locked == False,
        )
        .all()
    )

    for task in tasks:
        # Get all would_move=True entries for this task
        move_entries = (
            db.query(TaskFeedback)
            .filter(
                TaskFeedback.task_id    == task.id,
                TaskFeedback.user_id    == user_id,
                TaskFeedback.would_move == True,
                TaskFeedback.preferred_time_given != None,
            )
            .all()
        )

        if len(move_entries) < WOULD_MOVE_THRESHOLD:
            continue

        # Check if the preferred_time_given is consistent
        given_times = [e.preferred_time_given for e in move_entries]
        most_common = max(set(given_times), key=given_times.count)
        consistency = given_times.count(most_common) / len(given_times)

        # Only update if more than 60% of signals agree
        if consistency >= 0.6 and most_common in ("morning", "afternoon", "evening"):
            task.preferred_time = most_common


# ── Main entry point ──────────────────────────────────────────────────────────

def run_end_of_day_learning(
    user_id  : int,
    date_str : str,
    db       : Session,
) -> dict:
    """
    Main entry point. Called from feedback.py after the evening
    check-in is saved.

    Returns a summary dict describing what was updated, useful for
    debugging and for the preferences breakdown page later.
    """
    # ── Check minimum data threshold ──────────────────────────────────────────
    total_feedback_days = (
        db.query(DailyFeedback)
        .filter(DailyFeedback.user_id == user_id)
        .count()
    )

    if total_feedback_days < MIN_FEEDBACK_DAYS:
        return {
            "ran"    : False,
            "reason" : f"Not enough data yet ({total_feedback_days}/{MIN_FEEDBACK_DAYS} days). "
                       f"Keep submitting check-ins -- learning starts after {MIN_FEEDBACK_DAYS} days.",
        }

    # ── Load preferences row (create if missing) ──────────────────────────────
    prefs = db.query(UserPreferences).filter(
        UserPreferences.user_id == user_id
    ).first()

    if prefs is None:
        prefs = UserPreferences(user_id=user_id)
        db.add(prefs)
        db.flush()

    # ── Load today's feedback ─────────────────────────────────────────────────
    today_daily = db.query(DailyFeedback).filter(
        DailyFeedback.user_id == user_id,
        DailyFeedback.date    == date_str,
    ).first()

    today_tasks = load_todays_task_feedback(user_id, date_str, db)

    # ── Load recent daily feedback for pattern detection ──────────────────────
    recent_daily = load_recent_daily_feedback(
        user_id, date_str, PATTERN_WINDOW_DAYS, db
    )

    updates = []

    # ── 1. Update energy weights from daily stress ratings ────────────────────
    if today_daily:
        update_energy_weights_from_daily(prefs, today_daily)
        updates.append("energy_weights_from_daily")

    # ── 2. Refine energy weights from per-task feelings ───────────────────────
    if today_tasks:
        update_energy_weights_from_tasks(prefs, today_tasks)
        updates.append(f"energy_weights_from_{len(today_tasks)}_tasks")

    # ── 3. Adjust buffer preference ───────────────────────────────────────────
    if recent_daily:
        old_buffer = prefs.preferred_buffer_minutes
        update_buffer_preference(prefs, recent_daily)
        if prefs.preferred_buffer_minutes != old_buffer:
            updates.append(f"buffer_minutes: {old_buffer} -> {prefs.preferred_buffer_minutes}")

    # ── 4. Update schedule density ────────────────────────────────────────────
    if recent_daily:
        old_density = prefs.schedule_density
        update_schedule_density(prefs, recent_daily)
        if prefs.schedule_density != old_density:
            updates.append(f"schedule_density: {old_density} -> {prefs.schedule_density}")

    # ── 5. Update task preferred times ────────────────────────────────────────
    update_task_preferred_times(user_id, date_str, db)
    updates.append("task_preferred_times_checked")

    # ── Commit everything ─────────────────────────────────────────────────────
    db.commit()

    return {
        "ran"                 : True,
        "date"                : date_str,
        "feedback_days_total" : total_feedback_days,
        "task_entries_today"  : len(today_tasks),
        "updates_applied"     : updates,
        "current_weights": {
            "energy_morning_high"     : round(prefs.energy_morning_high,   3),
            "energy_morning_medium"   : round(prefs.energy_morning_medium, 3),
            "energy_morning_low"      : round(prefs.energy_morning_low,    3),
            "energy_afternoon_high"   : round(prefs.energy_afternoon_high,   3),
            "energy_afternoon_medium" : round(prefs.energy_afternoon_medium, 3),
            "energy_afternoon_low"    : round(prefs.energy_afternoon_low,    3),
            "energy_evening_high"     : round(prefs.energy_evening_high,   3),
            "energy_evening_medium"   : round(prefs.energy_evening_medium, 3),
            "energy_evening_low"      : round(prefs.energy_evening_low,    3),
            "buffer_minutes"          : prefs.preferred_buffer_minutes,
            "schedule_density"        : prefs.schedule_density,
        },
    }
