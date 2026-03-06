"""
Run this ONCE on your existing database before starting the app with the new models.
It adds all the new columns without touching existing data.

Usage:
    python -m backend.migrate

Safe to run multiple times -- skips columns that already exist.
"""

import sqlite3
import os

DB_PATH = os.environ.get("DB_PATH", "database/app.db")


def column_exists(cursor, table: str, column: str) -> bool:
    cursor.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cursor.fetchall())


def table_exists(cursor, table: str) -> bool:
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
    return cursor.fetchone() is not None


def add_column(cursor, table: str, column: str, definition: str):
    if not column_exists(cursor, table, column):
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
        print(f"  + {table}.{column}")
    else:
        print(f"  ~ {table}.{column} (already exists, skipped)")


def run():
    print(f"Connecting to {DB_PATH}...")
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # ── tasks: new columns ────────────────────────────────────────────────────
    print("\nMigrating: tasks")
    add_column(c, "tasks", "task_type",            "TEXT NOT NULL DEFAULT 'flexible'")
    add_column(c, "tasks", "fixed_start",           "TEXT")
    add_column(c, "tasks", "fixed_end",             "TEXT")
    add_column(c, "tasks", "location",              "TEXT")
    add_column(c, "tasks", "energy_level",          "TEXT NOT NULL DEFAULT 'medium'")
    add_column(c, "tasks", "preferred_time",        "TEXT NOT NULL DEFAULT 'none'")
    add_column(c, "tasks", "preferred_time_locked", "INTEGER NOT NULL DEFAULT 0")
    add_column(c, "tasks", "recurrence",            "TEXT NOT NULL DEFAULT 'none'")
    add_column(c, "tasks", "recurrence_days",       "TEXT")
    add_column(c, "tasks", "completed_at",          "TEXT")
    add_column(c, "tasks", "actual_duration",       "INTEGER")
    add_column(c, "tasks", "actual_time_of_day",    "TEXT")
    add_column(c, "tasks", "times_rescheduled",     "INTEGER NOT NULL DEFAULT 0")
    add_column(c, "tasks", "last_scheduled_date",   "TEXT")

    # ── feedback: rename old table, create new daily_feedback ─────────────────
    print("\nMigrating: feedback -> daily_feedback")
    if table_exists(c, "feedback") and not table_exists(c, "daily_feedback"):
        # Copy old feedback rows into the new table structure
        c.execute("""
            CREATE TABLE daily_feedback (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id          INTEGER NOT NULL REFERENCES users(id),
                date             TEXT NOT NULL,
                stress_morning   INTEGER,
                boredom_morning  INTEGER,
                stress_afternoon  INTEGER,
                boredom_afternoon INTEGER,
                stress_evening   INTEGER,
                boredom_evening  INTEGER,
                overall_rating   INTEGER,
                notes            TEXT,
                created_at       TEXT,
                updated_at       TEXT
            )
        """)
        # Migrate old rows: map stress_level -> stress_morning as best guess
        c.execute("""
            INSERT INTO daily_feedback (user_id, date, stress_morning, notes, created_at, updated_at)
            SELECT user_id, date, stress_level, notes, created_at, created_at
            FROM feedback
        """)
        print("  + daily_feedback table created, old feedback rows migrated")
    elif table_exists(c, "daily_feedback"):
        print("  ~ daily_feedback already exists, skipped")
    else:
        print("  ~ no old feedback table found, daily_feedback will be created by SQLAlchemy")

    # ── user_preferences: new table ───────────────────────────────────────────
    print("\nMigrating: user_preferences")
    if not table_exists(c, "user_preferences"):
        c.execute("""
            CREATE TABLE user_preferences (
                id                       INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id                  INTEGER NOT NULL UNIQUE REFERENCES users(id),
                wake_time                TEXT NOT NULL DEFAULT '07:00',
                sleep_time               TEXT NOT NULL DEFAULT '23:00',
                chronotype               TEXT NOT NULL DEFAULT 'neutral',
                timezone                 TEXT NOT NULL DEFAULT 'UTC',
                schedule_density         TEXT NOT NULL DEFAULT 'relaxed',
                preferred_buffer_minutes INTEGER NOT NULL DEFAULT 10,
                energy_morning_high      REAL NOT NULL DEFAULT 0.5,
                energy_morning_medium    REAL NOT NULL DEFAULT 0.5,
                energy_morning_low       REAL NOT NULL DEFAULT 0.5,
                energy_afternoon_high    REAL NOT NULL DEFAULT 0.5,
                energy_afternoon_medium  REAL NOT NULL DEFAULT 0.5,
                energy_afternoon_low     REAL NOT NULL DEFAULT 0.5,
                energy_evening_high      REAL NOT NULL DEFAULT 0.5,
                energy_evening_medium    REAL NOT NULL DEFAULT 0.5,
                energy_evening_low       REAL NOT NULL DEFAULT 0.5,
                created_at               TEXT,
                updated_at               TEXT
            )
        """)
        print("  + user_preferences table created")
    else:
        print("  ~ user_preferences already exists, skipped")

    # ── task_feedback: new table ───────────────────────────────────────────────
    print("\nMigrating: task_feedback")
    if not table_exists(c, "task_feedback"):
        c.execute("""
            CREATE TABLE task_feedback (
                id                   INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id              INTEGER NOT NULL REFERENCES users(id),
                task_id              INTEGER NOT NULL REFERENCES tasks(id),
                date                 TEXT NOT NULL,
                actual_duration      INTEGER,
                time_of_day_done     TEXT,
                feeling              TEXT,
                satisfaction         INTEGER,
                would_move           INTEGER NOT NULL DEFAULT 0,
                preferred_time_given TEXT,
                created_at           TEXT
            )
        """)
        print("  + task_feedback table created")
    else:
        print("  ~ task_feedback already exists, skipped")

    conn.commit()
    conn.close()
    print("\nMigration complete.")


if __name__ == "__main__":
    run()
