from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone

from backend.database import SessionLocal
from backend.models import Task, User
from backend.dependencies import get_db, get_current_user

router = APIRouter()


# ── Request schemas ───────────────────────────────────────────────────────────

class TaskCreate(BaseModel):
    title:            str
    duration_minutes: Optional[int] = 30
    deadline:         Optional[str] = None
    importance:       Optional[int] = 3


class TaskUpdate(BaseModel):
    title:            Optional[str] = None
    duration_minutes: Optional[int] = None
    deadline:         Optional[str] = None
    importance:       Optional[int] = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/")
def list_tasks(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Returns ONLY the tasks belonging to the logged-in user.
    current_user is injected by the JWT dependency — the user_id filter
    ensures no one can see anyone else's tasks, even if they guess an ID.
    """
    tasks = db.query(Task).filter(Task.user_id == current_user.id).all()
    return {"tasks": tasks}


@router.post("/", status_code=201)
def create_task(
    body:         TaskCreate,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    if not body.title.strip():
        raise HTTPException(status_code=422, detail="Task title cannot be empty")

    task = Task(
        user_id          = current_user.id,
        title            = body.title.strip(),
        duration_minutes = body.duration_minutes,
        deadline         = body.deadline,
        importance       = body.importance,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return {"created": True, "task": task}


@router.patch("/{task_id}")
def update_task(
    task_id:      int,
    body:         TaskUpdate,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Partially update a task's fields (title, duration, deadline, importance).
    Only updates fields that are explicitly provided in the request body.
    IDOR-safe: checks user_id before allowing any modification.
    """
    task = db.query(Task).filter(
        Task.id      == task_id,
        Task.user_id == current_user.id,
    ).first()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if body.title is not None:
        if not body.title.strip():
            raise HTTPException(status_code=422, detail="Task title cannot be empty")
        task.title = body.title.strip()

    if body.duration_minutes is not None:
        task.duration_minutes = body.duration_minutes

    if body.deadline is not None:
        task.deadline = body.deadline if body.deadline else None

    if body.importance is not None:
        if not 1 <= body.importance <= 5:
            raise HTTPException(status_code=422, detail="Importance must be between 1 and 5")
        task.importance = body.importance

    db.commit()
    db.refresh(task)
    return {"updated": True, "task": task}


@router.patch("/{task_id}/complete")
def toggle_complete(
    task_id:      int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Toggles a task's completed state.
    Sets completed_at timestamp when marking complete, clears it when undoing.
    """
    task = db.query(Task).filter(
        Task.id      == task_id,
        Task.user_id == current_user.id,
    ).first()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task.completed = not task.completed
    task.completed_at = datetime.now(timezone.utc) if task.completed else None

    db.commit()
    db.refresh(task)
    return {"updated": True, "completed": task.completed, "task": task}


@router.delete("/{task_id}")
def delete_task(
    task_id:      int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Deletes a task — but ONLY if it belongs to the current user.
    Without the user_id check, any logged-in user could delete anyone's task
    just by guessing an ID (Insecure Direct Object Reference / IDOR).
    """
    task = db.query(Task).filter(
        Task.id      == task_id,
        Task.user_id == current_user.id,
    ).first()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    db.delete(task)
    db.commit()
    return {"deleted": True}