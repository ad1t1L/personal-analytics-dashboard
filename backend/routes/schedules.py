"""
schedules.py
------------
API routes for generating and retrieving schedules.

GET /schedules/today
    Generates today's schedule for the authenticated user.
    Pulls real tasks from the DB, applies the rule-based scheduler,
    and returns scheduled + overflow lists.

GET /schedules/date/{date}
    Same as above but for a specific date (YYYY-MM-DD).
    Useful for the weekly calendar view.

POST /schedules/reschedule/{task_id}
    Increments times_rescheduled on a task and regenerates today's schedule.
    Called when the user manually pushes a task to tomorrow.
"""

from datetime import date as date_type
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.dependencies import get_db, get_current_user
from backend.models import Task, User, UserPreferences
from backend.scheduler.rule_based import build_schedule

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def prefs_to_dict(prefs: UserPreferences | None) -> dict:
    """
    Convert a UserPreferences ORM object to a plain dict for the scheduler.
    Falls back to None (scheduler uses DEFAULT_PREFS) if no row exists yet.
    """
    if prefs is None:
        return {}

    return {
        "wake_time"               : prefs.wake_time,
        "sleep_time"              : prefs.sleep_time,
        "chronotype"              : prefs.chronotype,
        "schedule_density"        : prefs.schedule_density,
        "preferred_buffer_minutes": prefs.preferred_buffer_minutes,
        "energy_morning_high"     : prefs.energy_morning_high,
        "energy_morning_medium"   : prefs.energy_morning_medium,
        "energy_morning_low"      : prefs.energy_morning_low,
        "energy_afternoon_high"   : prefs.energy_afternoon_high,
        "energy_afternoon_medium" : prefs.energy_afternoon_medium,
        "energy_afternoon_low"    : prefs.energy_afternoon_low,
        "energy_evening_high"     : prefs.energy_evening_high,
        "energy_evening_medium"   : prefs.energy_evening_medium,
        "energy_evening_low"      : prefs.energy_evening_low,
    }


def task_to_dict(task: Task) -> dict:
    """Serialize a Task ORM object to a plain dict for the scheduler."""
    return {
        "id"                  : task.id,
        "title"               : task.title,
        "task_type"           : task.task_type,
        "duration_minutes"    : task.duration_minutes,
        "deadline"            : task.deadline,
        "importance"          : task.importance,
        "energy_level"        : task.energy_level,
        "preferred_time"      : task.preferred_time,
        "preferred_time_locked": task.preferred_time_locked,
        "fixed_start"         : task.fixed_start,
        "fixed_end"           : task.fixed_end,
        "recurrence"          : task.recurrence,
        "recurrence_days"     : task.recurrence_days,
        "times_rescheduled"   : task.times_rescheduled,
        "completed"           : task.completed,
    }


def get_tasks_for_date(
    user_id   : int,
    date_str  : str,
    db        : Session,
) -> list[Task]:
    """
    Return all tasks that should appear on a given date for a user.

    Includes:
      - Tasks with a deadline matching this date
      - Tasks with no deadline (always eligible to be scheduled)
      - Recurring tasks that fall on this day of week
      - Fixed tasks whose fixed_start date matches (deadline used as date anchor)
      - Excludes completed tasks
    """
    from datetime import date as date_type
    try:
        target_date = date_type.fromisoformat(date_str)
    except ValueError:
        return []

    day_of_week = str(target_date.weekday())  # 0=Mon, 6=Sun

    all_tasks = (
        db.query(Task)
        .filter(Task.user_id == user_id, Task.completed == False)
        .all()
    )

    eligible = []
    for task in all_tasks:
        # Fixed tasks: include if deadline matches target date
        if task.task_type == "fixed":
            if task.deadline == date_str:
                eligible.append(task)
            continue

        # Recurring daily: always include
        if task.recurrence == "daily":
            eligible.append(task)
            continue

        # Recurring weekly: include if today is in recurrence_days
        if task.recurrence == "weekly" and task.recurrence_days:
            if day_of_week in task.recurrence_days.split(","):
                eligible.append(task)
            continue

        # Non-recurring: include if deadline is today or no deadline
        if task.deadline is None or task.deadline == date_str:
            eligible.append(task)
            continue

        # Semi-flexible tasks with a future deadline still get scheduled today
        # if they haven't been placed yet (last_scheduled_date is not today)
        if task.task_type == "semi" and task.deadline and task.deadline >= date_str:
            if task.last_scheduled_date != date_str:
                eligible.append(task)

    return eligible


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/today")
def get_todays_schedule(
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """Generate and return today's schedule for the authenticated user."""
    today_str = date_type.today().isoformat()
    return _build_for_date(current_user, today_str, db)


@router.get("/date/{date_str}")
def get_schedule_for_date(
    date_str     : str,
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """Generate and return the schedule for a specific date (YYYY-MM-DD)."""
    try:
        date_type.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    return _build_for_date(current_user, date_str, db)


@router.post("/reschedule/{task_id}")
def reschedule_task(
    task_id      : int,
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """
    Mark a task as manually rescheduled (pushes it to tomorrow).
    Increments times_rescheduled so the priority engine can detect
    procrastination patterns. Returns the updated today's schedule.
    """
    task = db.query(Task).filter(
        Task.id      == task_id,
        Task.user_id == current_user.id,
    ).first()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")

    task.times_rescheduled += 1
    db.commit()

    # Return the refreshed schedule without this task
    today_str = date_type.today().isoformat()
    return _build_for_date(current_user, today_str, db)


# ── Internal builder ──────────────────────────────────────────────────────────

def _build_for_date(user: User, date_str: str, db: Session) -> dict:
    """Shared logic for building a schedule for any date."""
    # Get user preferences (or None -- scheduler falls back to defaults)
    prefs_obj  = db.query(UserPreferences).filter(
        UserPreferences.user_id == user.id
    ).first()
    prefs_dict = prefs_to_dict(prefs_obj)

    # Get eligible tasks for this date
    tasks     = get_tasks_for_date(user.id, date_str, db)
    task_dicts = [task_to_dict(t) for t in tasks]

    # Build and return schedule
    result = build_schedule(
        tasks     = task_dicts,
        prefs     = prefs_dict if prefs_dict else None,
        today_str = date_str,
    )

    return result
