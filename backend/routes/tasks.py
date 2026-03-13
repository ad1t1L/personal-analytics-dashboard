from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from backend.database import SessionLocal
from backend.models import Task, User, utcnow
from backend.dependencies import get_db, get_current_user

router = APIRouter()


# ── Request schema ────────────────────────────────────────────────────────────

class TaskCreate(BaseModel):
    title:            str
    duration_minutes: Optional[int] = 30
    deadline:         Optional[str] = None
    importance:       Optional[int] = 3


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


@router.patch("/{task_id}/complete")
def complete_task(
    task_id:      int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Marks a task as completed with a timestamp.
    Only the task's owner can complete it (IDOR protection).
    """
    task = db.query(Task).filter(
        Task.id      == task_id,
        Task.user_id == current_user.id,
    ).first()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task.completed    = True
    task.completed_at = utcnow()
    db.commit()
    db.refresh(task)
    return {"completed": True, "task": task}


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