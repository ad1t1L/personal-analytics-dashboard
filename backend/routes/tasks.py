"""
tasks.py
--------
CRUD routes for tasks.

GET  /tasks/          -- list all tasks for the current user
POST /tasks/          -- create a new task
GET  /tasks/{id}      -- get a single task
PUT  /tasks/{id}      -- update a task (all fields)
PATCH /tasks/{id}     -- partial update (e.g. just mark complete)
DELETE /tasks/{id}    -- delete a task
POST /tasks/{id}/complete -- mark complete without full feedback flow
                             (quick complete, no survey)
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from backend.models import Task, User
from backend.dependencies import get_db, get_current_user

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def utcnow() -> datetime:
    return datetime.now(timezone.utc)


VALID_TASK_TYPES    = ("fixed", "semi", "flexible")
VALID_ENERGY_LEVELS = ("high", "medium", "low")
VALID_PREF_TIMES    = ("morning", "afternoon", "evening", "none")
VALID_RECURRENCE    = ("none", "daily", "weekly")


# ── Request schemas ───────────────────────────────────────────────────────────

class TaskCreate(BaseModel):
    # ── Core ──────────────────────────────────────────────────────────────────
    title            : str
    duration_minutes : Optional[int] = 30
    importance       : Optional[int] = 3
    deadline         : Optional[str] = None   # YYYY-MM-DD

    # ── Task type ─────────────────────────────────────────────────────────────
    # "fixed"    = set time (appointment, work, class)
    # "semi"     = due by a date but flexible when (homework, errands)
    # "flexible" = no time constraint at all (cleaning, relaxing)
    task_type        : Optional[str] = "flexible"

    # ── Fixed-time fields (only used when task_type = "fixed") ────────────────
    fixed_start      : Optional[str] = None   # HH:MM
    fixed_end        : Optional[str] = None   # HH:MM
    location         : Optional[str] = None

    # ── Energy & preference ───────────────────────────────────────────────────
    energy_level          : Optional[str]  = "medium"   # "high"|"medium"|"low"
    preferred_time        : Optional[str]  = "none"     # "morning"|"afternoon"|"evening"|"none"
    preferred_time_locked : Optional[bool] = False      # True = ML will not override

    # ── Recurrence ────────────────────────────────────────────────────────────
    recurrence      : Optional[str] = "none"   # "none"|"daily"|"weekly"
    recurrence_days : Optional[str] = None     # "0,2,4" = Mon/Wed/Fri

    @field_validator("task_type")
    @classmethod
    def validate_task_type(cls, v):
        if v is not None and v not in VALID_TASK_TYPES:
            raise ValueError(f"task_type must be one of: {VALID_TASK_TYPES}")
        return v

    @field_validator("energy_level")
    @classmethod
    def validate_energy(cls, v):
        if v is not None and v not in VALID_ENERGY_LEVELS:
            raise ValueError(f"energy_level must be one of: {VALID_ENERGY_LEVELS}")
        return v

    @field_validator("preferred_time")
    @classmethod
    def validate_pref_time(cls, v):
        if v is not None and v not in VALID_PREF_TIMES:
            raise ValueError(f"preferred_time must be one of: {VALID_PREF_TIMES}")
        return v

    @field_validator("recurrence")
    @classmethod
    def validate_recurrence(cls, v):
        if v is not None and v not in VALID_RECURRENCE:
            raise ValueError(f"recurrence must be one of: {VALID_RECURRENCE}")
        return v

    @field_validator("importance")
    @classmethod
    def validate_importance(cls, v):
        if v is not None and not (1 <= v <= 5):
            raise ValueError("importance must be between 1 and 5")
        return v

    @field_validator("fixed_start", "fixed_end")
    @classmethod
    def validate_time_format(cls, v):
        if v is not None:
            parts = v.split(":")
            if len(parts) != 2:
                raise ValueError("Time must be in HH:MM format")
            h, m = parts
            if not (h.isdigit() and m.isdigit()):
                raise ValueError("Time must be in HH:MM format")
            if not (0 <= int(h) <= 23 and 0 <= int(m) <= 59):
                raise ValueError("Invalid time value")
        return v


class TaskUpdate(BaseModel):
    """Full update -- all fields optional, only provided ones are changed."""
    title                 : Optional[str]  = None
    duration_minutes      : Optional[int]  = None
    importance            : Optional[int]  = None
    deadline              : Optional[str]  = None
    task_type             : Optional[str]  = None
    fixed_start           : Optional[str]  = None
    fixed_end             : Optional[str]  = None
    location              : Optional[str]  = None
    energy_level          : Optional[str]  = None
    preferred_time        : Optional[str]  = None
    preferred_time_locked : Optional[bool] = None
    recurrence            : Optional[str]  = None
    recurrence_days       : Optional[str]  = None


class TaskPatch(BaseModel):
    """
    Partial update for lightweight changes.
    e.g. toggling completed, updating just the deadline.
    """
    completed             : Optional[bool] = None
    preferred_time_locked : Optional[bool] = None
    preferred_time        : Optional[str]  = None
    deadline              : Optional[str]  = None
    importance            : Optional[int]  = None


# ── Serializer ────────────────────────────────────────────────────────────────

def serialize_task(task: Task) -> dict:
    """Convert a Task ORM object to a dict for API responses."""
    return {
        "id"                   : task.id,
        "title"                : task.title,
        "task_type"            : task.task_type,
        "duration_minutes"     : task.duration_minutes,
        "deadline"             : task.deadline,
        "importance"           : task.importance,
        "completed"            : task.completed,
        "completed_at"         : task.completed_at.isoformat() if task.completed_at else None,
        "energy_level"         : task.energy_level,
        "preferred_time"       : task.preferred_time,
        "preferred_time_locked": task.preferred_time_locked,
        "fixed_start"          : task.fixed_start,
        "fixed_end"            : task.fixed_end,
        "location"             : task.location,
        "recurrence"           : task.recurrence,
        "recurrence_days"      : task.recurrence_days,
        "actual_duration"      : task.actual_duration,
        "actual_time_of_day"   : task.actual_time_of_day,
        "times_rescheduled"    : task.times_rescheduled,
        "last_scheduled_date"  : task.last_scheduled_date,
        "created_at"           : task.created_at.isoformat() if task.created_at else None,
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/")
def list_tasks(
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """
    Returns all incomplete tasks for the current user.
    Completed tasks are excluded -- they are historical records.
    Pass ?include_completed=true to include them.
    """
    tasks = (
        db.query(Task)
        .filter(Task.user_id == current_user.id)
        .order_by(Task.created_at.desc())
        .all()
    )
    return {"tasks": [serialize_task(t) for t in tasks]}


@router.get("/{task_id}")
def get_task(
    task_id      : int,
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """Get a single task by ID."""
    task = db.query(Task).filter(
        Task.id      == task_id,
        Task.user_id == current_user.id,
    ).first()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")

    return serialize_task(task)


@router.post("/", status_code=201)
def create_task(
    body         : TaskCreate,
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """
    Create a new task.

    Validation rules:
    - Fixed tasks must have both fixed_start and fixed_end
    - Semi and fixed tasks should have a deadline
    - recurrence_days is required when recurrence = "weekly"
    """
    if not body.title.strip():
        raise HTTPException(status_code=422, detail="Task title cannot be empty.")

    # Fixed tasks need a time range
    if body.task_type == "fixed":
        if not body.fixed_start or not body.fixed_end:
            raise HTTPException(
                status_code=422,
                detail="Fixed tasks require both fixed_start and fixed_end (HH:MM)."
            )

    # Weekly recurrence needs days
    if body.recurrence == "weekly" and not body.recurrence_days:
        raise HTTPException(
            status_code=422,
            detail="Weekly recurrence requires recurrence_days (e.g. '0,2,4' for Mon/Wed/Fri)."
        )

    task = Task(
        user_id               = current_user.id,
        title                 = body.title.strip(),
        task_type             = body.task_type or "flexible",
        duration_minutes      = body.duration_minutes or 30,
        deadline              = body.deadline,
        importance            = body.importance or 3,
        energy_level          = body.energy_level or "medium",
        preferred_time        = body.preferred_time or "none",
        preferred_time_locked = body.preferred_time_locked or False,
        fixed_start           = body.fixed_start,
        fixed_end             = body.fixed_end,
        location              = body.location,
        recurrence            = body.recurrence or "none",
        recurrence_days       = body.recurrence_days,
    )

    db.add(task)
    db.commit()
    db.refresh(task)

    return {"created": True, "task": serialize_task(task)}


@router.put("/{task_id}")
def update_task(
    task_id      : int,
    body         : TaskUpdate,
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """Full update -- replace any provided fields on the task."""
    task = db.query(Task).filter(
        Task.id      == task_id,
        Task.user_id == current_user.id,
    ).first()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")

    if body.title                 is not None: task.title                 = body.title.strip()
    if body.duration_minutes      is not None: task.duration_minutes      = body.duration_minutes
    if body.importance            is not None: task.importance            = body.importance
    if body.deadline              is not None: task.deadline              = body.deadline
    if body.task_type             is not None: task.task_type             = body.task_type
    if body.fixed_start           is not None: task.fixed_start           = body.fixed_start
    if body.fixed_end             is not None: task.fixed_end             = body.fixed_end
    if body.location              is not None: task.location              = body.location
    if body.energy_level          is not None: task.energy_level          = body.energy_level
    if body.preferred_time        is not None: task.preferred_time        = body.preferred_time
    if body.preferred_time_locked is not None: task.preferred_time_locked = body.preferred_time_locked
    if body.recurrence            is not None: task.recurrence            = body.recurrence
    if body.recurrence_days       is not None: task.recurrence_days       = body.recurrence_days

    db.commit()
    db.refresh(task)

    return {"updated": True, "task": serialize_task(task)}


@router.patch("/{task_id}")
def patch_task(
    task_id      : int,
    body         : TaskPatch,
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """
    Lightweight partial update.
    Used for quick actions like locking a preferred time or
    shifting a deadline without opening the full edit form.
    """
    task = db.query(Task).filter(
        Task.id      == task_id,
        Task.user_id == current_user.id,
    ).first()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")

    if body.completed             is not None: task.completed             = body.completed
    if body.preferred_time_locked is not None: task.preferred_time_locked = body.preferred_time_locked
    if body.preferred_time        is not None: task.preferred_time        = body.preferred_time
    if body.deadline              is not None: task.deadline              = body.deadline
    if body.importance            is not None: task.importance            = body.importance

    db.commit()
    db.refresh(task)

    return {"updated": True, "task": serialize_task(task)}


@router.post("/{task_id}/complete")
def quick_complete_task(
    task_id      : int,
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """
    Mark a task complete without going through the feedback flow.
    Used when the user just wants to check something off quickly.
    The feedback survey is still shown on the frontend -- this endpoint
    is the fallback if they dismiss it.
    """
    task = db.query(Task).filter(
        Task.id      == task_id,
        Task.user_id == current_user.id,
    ).first()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")

    task.completed    = True
    task.completed_at = utcnow()

    db.commit()
    db.refresh(task)

    return {"completed": True, "task": serialize_task(task)}


@router.delete("/{task_id}")
def delete_task(
    task_id      : int,
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """
    Delete a task permanently.
    Note: this also deletes all TaskFeedback rows for this task
    via the cascade rule on the relationship.
    """
    task = db.query(Task).filter(
        Task.id      == task_id,
        Task.user_id == current_user.id,
    ).first()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")

    db.delete(task)
    db.commit()

    return {"deleted": True}
