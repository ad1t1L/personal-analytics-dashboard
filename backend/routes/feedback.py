"""
feedback.py
-----------
Routes for saving and retrieving feedback.

POST /feedback/task
    Save per-task feedback when a user marks a task complete.
    Updates the task itself (actual_duration, actual_time_of_day, completed_at)
    and saves a TaskFeedback row.
    If the user said would_move=True and preferred_time_given is set,
    updates preferred_time on the task (unless preferred_time_locked=True).

POST /feedback/daily
    Save or update a daily check-in for a specific period (morning/afternoon/evening).
    Each period is a partial update -- calling this three times in a day
    fills in the same DailyFeedback row incrementally.

GET /feedback/daily/{date}
    Returns the current state of the daily feedback row for a given date.
    Frontend uses this to check which check-ins have already been submitted
    so it does not prompt the user twice for the same period.

GET /feedback/task/{task_id}
    Returns all feedback entries for a specific task.
    Used by the preferences breakdown page to show the user
    their history with a particular task.
"""

from datetime import datetime, timezone, date as date_type
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from backend.dependencies import get_db, get_current_user
from backend.models import Task, User, TaskFeedback, DailyFeedback
from backend.scheduler.constraints import time_of_day, hhmm_to_min
from backend.scheduler.learning_engine import run_end_of_day_learning

router = APIRouter()


# ── Request schemas ───────────────────────────────────────────────────────────

class TaskFeedbackRequest(BaseModel):
    task_id              : int
    date                 : str                  # YYYY-MM-DD
    actual_duration      : Optional[int]  = None  # minutes
    feeling              : Optional[str]  = None  # "drained"|"neutral"|"energized"
    satisfaction         : Optional[int]  = None  # 1-5
    would_move           : bool           = False
    preferred_time_given : Optional[str]  = None  # "morning"|"afternoon"|"evening"|"none"

    @field_validator("feeling")
    @classmethod
    def validate_feeling(cls, v):
        if v is not None and v not in ("drained", "neutral", "energized"):
            raise ValueError("feeling must be drained, neutral, or energized")
        return v

    @field_validator("preferred_time_given")
    @classmethod
    def validate_preferred_time(cls, v):
        if v is not None and v not in ("morning", "afternoon", "evening", "none"):
            raise ValueError("preferred_time_given must be morning, afternoon, evening, or none")
        return v

    @field_validator("satisfaction")
    @classmethod
    def validate_satisfaction(cls, v):
        if v is not None and not (1 <= v <= 5):
            raise ValueError("satisfaction must be between 1 and 5")
        return v


class DailyFeedbackRequest(BaseModel):
    date              : str            # YYYY-MM-DD

    # Morning period (submitted at noon)
    stress_morning    : Optional[int] = None  # 1-5
    boredom_morning   : Optional[int] = None  # 1-5

    # Afternoon period (submitted at 6pm)
    stress_afternoon  : Optional[int] = None
    boredom_afternoon : Optional[int] = None

    # Evening period (submitted at 9pm)
    stress_evening    : Optional[int] = None
    boredom_evening   : Optional[int] = None

    # Overall (submitted at 9pm alongside evening)
    overall_rating    : Optional[int] = None  # 1-5
    notes             : Optional[str] = None

    @field_validator(
        "stress_morning", "boredom_morning",
        "stress_afternoon", "boredom_afternoon",
        "stress_evening", "boredom_evening",
        "overall_rating",
    )
    @classmethod
    def validate_rating(cls, v):
        if v is not None and not (1 <= v <= 5):
            raise ValueError("ratings must be between 1 and 5")
        return v


# ── Helper ────────────────────────────────────────────────────────────────────

def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def current_time_of_day() -> str:
    """Return the current period of day based on the server clock."""
    from datetime import datetime
    now_min = datetime.now().hour * 60 + datetime.now().minute
    return time_of_day(now_min)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/task")
def submit_task_feedback(
    body         : TaskFeedbackRequest,
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """
    Save feedback for a completed task.

    Also:
    - Marks the task as completed with a timestamp
    - Saves actual_duration and actual_time_of_day back onto the task
    - Updates preferred_time on the task if would_move=True and not locked
    """
    # Verify task belongs to this user
    task = db.query(Task).filter(
        Task.id      == body.task_id,
        Task.user_id == current_user.id,
    ).first()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")

    # ── Mark task complete and record outcome fields ───────────────────────────
    task.completed    = True
    task.completed_at = utcnow()

    if body.actual_duration is not None:
        task.actual_duration = body.actual_duration

    # Determine what time of day the task was completed
    task.actual_time_of_day = current_time_of_day()

    # ── Update preferred_time if user said they'd move it ─────────────────────
    if body.would_move and body.preferred_time_given and not task.preferred_time_locked:
        task.preferred_time = body.preferred_time_given

    # ── Save TaskFeedback row ─────────────────────────────────────────────────
    feedback = TaskFeedback(
        user_id              = current_user.id,
        task_id              = body.task_id,
        date                 = body.date,
        actual_duration      = body.actual_duration,
        time_of_day_done     = task.actual_time_of_day,
        feeling              = body.feeling,
        satisfaction         = body.satisfaction,
        would_move           = body.would_move,
        preferred_time_given = body.preferred_time_given,
    )

    db.add(feedback)
    db.commit()
    db.refresh(feedback)

    return {
        "saved"   : True,
        "task_id" : body.task_id,
        "feedback_id": feedback.id,
    }


@router.post("/daily")
def submit_daily_feedback(
    body         : DailyFeedbackRequest,
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """
    Save or update a daily check-in.

    Each call is a partial update -- only the fields included in the
    request body are written. Calling this three times in a day (noon,
    6pm, 9pm) fills in the same row incrementally without overwriting
    previously submitted periods.
    """
    # Find existing row for this date or create a new one
    row = db.query(DailyFeedback).filter(
        DailyFeedback.user_id == current_user.id,
        DailyFeedback.date    == body.date,
    ).first()

    if row is None:
        row = DailyFeedback(
            user_id = current_user.id,
            date    = body.date,
        )
        db.add(row)

    # Only update fields that were actually sent (partial update)
    if body.stress_morning    is not None: row.stress_morning    = body.stress_morning
    if body.boredom_morning   is not None: row.boredom_morning   = body.boredom_morning
    if body.stress_afternoon  is not None: row.stress_afternoon  = body.stress_afternoon
    if body.boredom_afternoon is not None: row.boredom_afternoon = body.boredom_afternoon
    if body.stress_evening    is not None: row.stress_evening    = body.stress_evening
    if body.boredom_evening   is not None: row.boredom_evening   = body.boredom_evening
    if body.overall_rating    is not None: row.overall_rating    = body.overall_rating
    if body.notes             is not None: row.notes             = body.notes

    db.commit()
    db.refresh(row)

    # ── Trigger end-of-day learning if evening period was just submitted ───────
    # We detect this by checking if stress_evening was just set for the first time.
    # The learning engine runs after the full day's data is in.
    learning_result = None
    evening_just_submitted = (
        body.stress_evening is not None and
        body.boredom_evening is not None
    )

    if evening_just_submitted:
        learning_result = run_end_of_day_learning(
            user_id  = current_user.id,
            date_str = body.date,
            db       = db,
        )

    # Tell the frontend which periods are now complete
    response = {
        "saved" : True,
        "date"  : body.date,
        "completed_periods": {
            "morning"  : row.stress_morning   is not None,
            "afternoon": row.stress_afternoon is not None,
            "evening"  : row.stress_evening   is not None,
            "overall"  : row.overall_rating   is not None,
        },
    }

    # Include learning summary if it ran (useful for debugging / preferences page)
    if learning_result is not None:
        response["learning"] = learning_result

    return response


@router.get("/daily/{date_str}")
def get_daily_feedback(
    date_str     : str,
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """
    Get the current state of the daily feedback row for a given date.
    Frontend calls this on load to know which check-in prompts to show.

    Returns which periods are complete so the frontend can skip
    prompts the user has already answered.
    """
    try:
        date_type.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    row = db.query(DailyFeedback).filter(
        DailyFeedback.user_id == current_user.id,
        DailyFeedback.date    == date_str,
    ).first()

    if row is None:
        return {
            "date"  : date_str,
            "exists": False,
            "completed_periods": {
                "morning"  : False,
                "afternoon": False,
                "evening"  : False,
                "overall"  : False,
            },
        }

    return {
        "date"  : date_str,
        "exists": True,
        "completed_periods": {
            "morning"  : row.stress_morning   is not None,
            "afternoon": row.stress_afternoon is not None,
            "evening"  : row.stress_evening   is not None,
            "overall"  : row.overall_rating   is not None,
        },
        "data": {
            "stress_morning"   : row.stress_morning,
            "boredom_morning"  : row.boredom_morning,
            "stress_afternoon" : row.stress_afternoon,
            "boredom_afternoon": row.boredom_afternoon,
            "stress_evening"   : row.stress_evening,
            "boredom_evening"  : row.boredom_evening,
            "overall_rating"   : row.overall_rating,
            "notes"            : row.notes,
        },
    }


@router.get("/task/{task_id}")
def get_task_feedback_history(
    task_id      : int,
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """
    Get all feedback entries for a specific task.
    Used by the preferences breakdown page.
    """
    # Verify task belongs to user
    task = db.query(Task).filter(
        Task.id      == task_id,
        Task.user_id == current_user.id,
    ).first()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")

    entries = db.query(TaskFeedback).filter(
        TaskFeedback.task_id == task_id,
        TaskFeedback.user_id == current_user.id,
    ).order_by(TaskFeedback.created_at.desc()).all()

    return {
        "task_id"       : task_id,
        "task_title"    : task.title,
        "feedback_count": len(entries),
        "entries": [
            {
                "id"                 : e.id,
                "date"               : e.date,
                "actual_duration"    : e.actual_duration,
                "time_of_day_done"   : e.time_of_day_done,
                "feeling"            : e.feeling,
                "satisfaction"       : e.satisfaction,
                "would_move"         : e.would_move,
                "preferred_time_given": e.preferred_time_given,
            }
            for e in entries
        ],
    }
