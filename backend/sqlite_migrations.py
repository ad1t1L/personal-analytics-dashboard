"""
Lightweight SQLite schema patches for dev DBs created before newer ORM models.

SQLAlchemy create_all() does not add columns to existing tables; old SQLite files
keep the previous tasks schema and inserts then fail (e.g. missing task_type).
"""

from __future__ import annotations

import logging
from sqlalchemy import text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

# Columns added after the original minimal tasks table (see models.Task).
_TASKS_COLUMNS: list[tuple[str, str]] = [
    ("task_type", "TEXT NOT NULL DEFAULT 'flexible'"),
    ("fixed_start", "TEXT"),
    ("fixed_end", "TEXT"),
    ("location", "TEXT"),
    ("energy_level", "TEXT NOT NULL DEFAULT 'medium'"),
    ("preferred_time", "TEXT NOT NULL DEFAULT 'none'"),
    ("preferred_time_locked", "INTEGER NOT NULL DEFAULT 0"),
    ("recurrence", "TEXT NOT NULL DEFAULT 'none'"),
    ("recurrence_days", "TEXT"),
    ("completed_at", "DATETIME"),
    ("actual_duration", "INTEGER"),
    ("actual_time_of_day", "TEXT"),
    ("times_rescheduled", "INTEGER NOT NULL DEFAULT 0"),
    ("last_scheduled_date", "TEXT"),
]


def apply_sqlite_migrations(engine: Engine) -> None:
    if not str(engine.url).startswith("sqlite"):
        return

    with engine.begin() as conn:
        exists = conn.execute(
            text(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks' LIMIT 1"
            )
        ).scalar()
        if not exists:
            return

        rows = conn.execute(text("PRAGMA table_info(tasks)")).fetchall()
        have = {r[1] for r in rows}

        for col, ddl in _TASKS_COLUMNS:
            if col in have:
                continue
            conn.execute(text(f"ALTER TABLE tasks ADD COLUMN {col} {ddl}"))
            logger.info("SQLite migration: added column tasks.%s", col)
