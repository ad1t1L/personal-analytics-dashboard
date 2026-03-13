from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import date

from backend.database import SessionLocal
from backend.models import DailyFeedback, TaskFeedback, Task, User
from backend.dependencies import get_db, get_current_user

router = APIRouter()


# ── Request schemas ────────────────────────────────────────────────────────────

class DailyFeedbackCreate(BaseModel):
    stress_morning:    Optional[int] = None   # 1-5
    stress_afternoon:  Optional[int] = None
    stress_evening:    Optional[int] = None
    boredom_morning:   Optional[int] = None
    boredom_afternoon: Optional[int] = None
    boredom_evening:   Optional[int] = None
    overall_rating:    Optional[int] = None   # 1-5
    notes:             Optional[str] = None


class TaskFeedbackCreate(BaseModel):
    task_id:              int
    feeling:              Optional[str] = None   # "drained"|"neutral"|"energized"
    satisfaction:         Optional[int] = None   # 1-5
    actual_duration:      Optional[int] = None   # minutes
    time_of_day_done:     Optional[str] = None   # "morning"|"afternoon"|"evening"
    would_move:           bool          = False
    preferred_time_given: Optional[str] = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/daily-feedback", status_code=201)
def submit_daily_feedback(
    body:         DailyFeedbackCreate,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Upsert the daily end-of-day feedback for the current user.
    If a row already exists for today it is updated in place;
    otherwise a new row is created.
    """
    today = date.today().isoformat()

    existing = db.query(DailyFeedback).filter(
        DailyFeedback.user_id == current_user.id,
        DailyFeedback.date    == today,
    ).first()

    if existing:
        for field, value in body.model_dump(exclude_none=True).items():
            setattr(existing, field, value)
        db.commit()
        db.refresh(existing)
        return {"saved": True, "feedback": existing}

    feedback = DailyFeedback(
        user_id          = current_user.id,
        date             = today,
        stress_morning   = body.stress_morning,
        stress_afternoon = body.stress_afternoon,
        stress_evening   = body.stress_evening,
        boredom_morning  = body.boredom_morning,
        boredom_afternoon= body.boredom_afternoon,
        boredom_evening  = body.boredom_evening,
        overall_rating   = body.overall_rating,
        notes            = body.notes,
    )
    db.add(feedback)
    db.commit()
    db.refresh(feedback)
    return {"saved": True, "feedback": feedback}


@router.get("/daily-feedback/today")
def get_today_feedback(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Returns today's DailyFeedback row for the current user, or null if none exists yet.
    Used by the frontend to pre-fill the end-of-day survey modal.
    """
    today = date.today().isoformat()
    feedback = db.query(DailyFeedback).filter(
        DailyFeedback.user_id == current_user.id,
        DailyFeedback.date    == today,
    ).first()
    return {"feedback": feedback}


@router.post("/task-feedback", status_code=201)
def submit_task_feedback(
    body:         TaskFeedbackCreate,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Submit post-completion feedback for a specific task.
    Verifies the task belongs to the current user before saving.
    """
    task = db.query(Task).filter(
        Task.id      == body.task_id,
        Task.user_id == current_user.id,
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    today = date.today().isoformat()
    feedback = TaskFeedback(
        user_id              = current_user.id,
        task_id              = body.task_id,
        date                 = today,
        feeling              = body.feeling,
        satisfaction         = body.satisfaction,
        actual_duration      = body.actual_duration,
        time_of_day_done     = body.time_of_day_done,
        would_move           = body.would_move,
        preferred_time_given = body.preferred_time_given,
    )
    db.add(feedback)
    db.commit()
    db.refresh(feedback)
    return {"saved": True, "feedback": feedback}
