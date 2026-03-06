from sqlalchemy import ForeignKey, String, Integer, Boolean, Float
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime, timezone
from typing import Optional
from backend.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ── Auth models ───────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id                : Mapped[int]            = mapped_column(Integer, primary_key=True, index=True)
    name              : Mapped[str]            = mapped_column(String, nullable=False)
    email             : Mapped[str]            = mapped_column(String, unique=True, nullable=False, index=True)
    password_hash     : Mapped[str]            = mapped_column(String, nullable=False)
    is_verified       : Mapped[bool]           = mapped_column(Boolean, default=False, nullable=False)
    is_active         : Mapped[bool]           = mapped_column(Boolean, default=True, nullable=False)
    totp_secret       : Mapped[Optional[str]]  = mapped_column(String(32), nullable=True)
    totp_enabled      : Mapped[bool]           = mapped_column(Boolean, default=False, nullable=False)
    email_2fa_enabled : Mapped[bool]           = mapped_column(Boolean, default=False, nullable=False)
    created_at        : Mapped[datetime]       = mapped_column(default=utcnow)
    last_login        : Mapped[Optional[datetime]] = mapped_column(nullable=True)

    tasks                 : Mapped[list["Task"]]                   = relationship(back_populates="owner",      cascade="all, delete-orphan")
    feedback_entries      : Mapped[list["DailyFeedback"]]          = relationship(back_populates="owner",      cascade="all, delete-orphan")
    task_feedback_entries : Mapped[list["TaskFeedback"]]           = relationship(back_populates="owner",      cascade="all, delete-orphan")
    preferences           : Mapped[Optional["UserPreferences"]]    = relationship(back_populates="owner",      cascade="all, delete-orphan", uselist=False)
    verification_tokens   : Mapped[list["EmailVerificationToken"]] = relationship(back_populates="user",       cascade="all, delete-orphan")
    refresh_tokens        : Mapped[list["RefreshToken"]]           = relationship(back_populates="user",       cascade="all, delete-orphan")
    email_2fa_codes       : Mapped[list["Email2FACode"]]           = relationship(back_populates="user",       cascade="all, delete-orphan")
    password_reset_tokens : Mapped[list["PasswordResetToken"]]     = relationship(back_populates="user",       cascade="all, delete-orphan")


class EmailVerificationToken(Base):
    __tablename__ = "email_verification_tokens"

    id         : Mapped[int]      = mapped_column(Integer, primary_key=True, index=True)
    user_id    : Mapped[int]      = mapped_column(ForeignKey("users.id"), nullable=False)
    token      : Mapped[str]      = mapped_column(String, unique=True, nullable=False, index=True)
    expires_at : Mapped[datetime] = mapped_column(nullable=False)
    created_at : Mapped[datetime] = mapped_column(default=utcnow)

    user: Mapped["User"] = relationship(back_populates="verification_tokens")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id         : Mapped[int]      = mapped_column(Integer, primary_key=True, index=True)
    user_id    : Mapped[int]      = mapped_column(ForeignKey("users.id"), nullable=False)
    token_hash : Mapped[str]      = mapped_column(String, unique=True, nullable=False, index=True)
    expires_at : Mapped[datetime] = mapped_column(nullable=False)
    created_at : Mapped[datetime] = mapped_column(default=utcnow)
    revoked    : Mapped[bool]     = mapped_column(Boolean, default=False, nullable=False)

    user: Mapped["User"] = relationship(back_populates="refresh_tokens")


class Email2FACode(Base):
    __tablename__ = "email_2fa_codes"

    id         : Mapped[int]      = mapped_column(Integer, primary_key=True, index=True)
    user_id    : Mapped[int]      = mapped_column(ForeignKey("users.id"), nullable=False)
    code       : Mapped[str]      = mapped_column(String(10), nullable=False)
    expires_at : Mapped[datetime] = mapped_column(nullable=False)
    created_at : Mapped[datetime] = mapped_column(default=utcnow)

    user: Mapped["User"] = relationship(back_populates="email_2fa_codes")


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id         : Mapped[int]      = mapped_column(Integer, primary_key=True, index=True)
    user_id    : Mapped[int]      = mapped_column(ForeignKey("users.id"), nullable=False)
    token      : Mapped[str]      = mapped_column(String, unique=True, nullable=False, index=True)
    expires_at : Mapped[datetime] = mapped_column(nullable=False)
    created_at : Mapped[datetime] = mapped_column(default=utcnow)
    used       : Mapped[bool]     = mapped_column(Boolean, default=False, nullable=False)

    user: Mapped["User"] = relationship(back_populates="password_reset_tokens")


# ── App models ────────────────────────────────────────────────────────────────

class Task(Base):
    """
    A task belonging to a user.

    task_type:
        "fixed"    -- hard start time (doctor, work, school)
        "semi"     -- has a deadline/window but no exact time (homework, dog walk)
        "flexible" -- no time constraint (cleaning, relaxing)

    energy_level:
        "high"   -- requires focus/effort (studying, exercise, work tasks)
        "medium" -- moderate effort (cooking, shopping, dog walk)
        "low"    -- passive/easy (relaxing, light reading)

    preferred_time:
        "morning" | "afternoon" | "evening" | "none"
        Starts as user-set or null. Gets learned from feedback over time.
        preferred_time_locked = True means the user has pinned it manually
        and the ML will never override it.

    recurrence:
        "none" | "daily" | "weekly"
        recurrence_days: comma-separated day numbers (0=Mon ... 6=Sun)
        e.g. "0,2,4" = Mon/Wed/Fri

    Outcome fields (filled after completion -- ML training signal):
        actual_duration     -- how long it really took
        actual_time_of_day  -- when it was actually done
        times_rescheduled   -- high value = procrastination signal
    """

    __tablename__ = "tasks"

    # ── Identity ──────────────────────────────────────────────────────────────
    id      : Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id : Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    # ── Core fields (already existed) ─────────────────────────────────────────
    title            : Mapped[str]           = mapped_column(String,   nullable=False)
    duration_minutes : Mapped[int]           = mapped_column(Integer,  default=30)
    deadline         : Mapped[Optional[str]] = mapped_column(String,   nullable=True)  # YYYY-MM-DD
    importance       : Mapped[int]           = mapped_column(Integer,  default=3)       # 1-5
    completed        : Mapped[bool]          = mapped_column(Boolean,  default=False)
    created_at       : Mapped[datetime]      = mapped_column(default=utcnow)

    # ── Task classification ────────────────────────────────────────────────────
    task_type : Mapped[str] = mapped_column(String(10), default="flexible", nullable=False)

    # Fixed-time fields -- only used when task_type = "fixed"
    fixed_start : Mapped[Optional[str]] = mapped_column(String(5), nullable=True)  # HH:MM
    fixed_end   : Mapped[Optional[str]] = mapped_column(String(5), nullable=True)  # HH:MM
    location    : Mapped[Optional[str]] = mapped_column(String,    nullable=True)  # for travel time later

    # ── Energy & time preference ───────────────────────────────────────────────
    energy_level          : Mapped[str]  = mapped_column(String(10), default="medium", nullable=False)
    preferred_time        : Mapped[str]  = mapped_column(String(10), default="none",   nullable=False)
    preferred_time_locked : Mapped[bool] = mapped_column(Boolean,    default=False,    nullable=False)

    # ── Recurrence ────────────────────────────────────────────────────────────
    recurrence      : Mapped[str]           = mapped_column(String(10), default="none", nullable=False)
    recurrence_days : Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # "0,2,4"

    # ── Outcome / ML training signal ──────────────────────────────────────────
    completed_at        : Mapped[Optional[datetime]] = mapped_column(nullable=True)
    actual_duration     : Mapped[Optional[int]]      = mapped_column(Integer,    nullable=True)
    actual_time_of_day  : Mapped[Optional[str]]      = mapped_column(String(10), nullable=True)
    times_rescheduled   : Mapped[int]                = mapped_column(Integer,    default=0, nullable=False)
    last_scheduled_date : Mapped[Optional[str]]      = mapped_column(String(10), nullable=True)  # YYYY-MM-DD

    # ── Relationships ─────────────────────────────────────────────────────────
    owner    : Mapped["User"]              = relationship(back_populates="tasks")
    feedback : Mapped[list["TaskFeedback"]] = relationship(back_populates="task", cascade="all, delete-orphan")


class UserPreferences(Base):
    """
    One row per user. Stores both user-set preferences and ML-learned weights.

    Energy curve weights (learned from feedback):
        How well the user handles high/medium/low energy tasks at each time of day.
        Range 0.0-1.0, default 0.5 (neutral / no data yet).
        The scheduler uses these weights when scoring candidate time slots.

        Example: energy_morning_high = 0.8 means this user handles demanding
        tasks well in the morning. energy_evening_high = 0.2 means they struggle
        with demanding tasks at night.

    schedule_density:
        "packed"  -- user prefers a full schedule with minimal gaps
        "relaxed" -- user prefers breathing room between tasks
        Learned from boredom vs stress balance in daily feedback.

    preferred_buffer_minutes:
        How many minutes between tasks the user prefers.
        Starts at 10, increases if they report stress on back-to-back days.
    """

    __tablename__ = "user_preferences"

    id      : Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id : Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)

    # ── User-set ───────────────────────────────────────────────────────────────
    wake_time  : Mapped[str] = mapped_column(String(5),  default="07:00",   nullable=False)  # HH:MM
    sleep_time : Mapped[str] = mapped_column(String(5),  default="23:00",   nullable=False)  # HH:MM
    chronotype : Mapped[str] = mapped_column(String(10), default="neutral", nullable=False)  # "morning"|"evening"|"neutral"
    timezone   : Mapped[str] = mapped_column(String(50), default="UTC",     nullable=False)

    # ── Learned schedule shape ─────────────────────────────────────────────────
    schedule_density         : Mapped[str] = mapped_column(String(10), default="relaxed", nullable=False)
    preferred_buffer_minutes : Mapped[int] = mapped_column(Integer,    default=10,         nullable=False)

    # ── Learned energy curve weights (0.0 - 1.0) ──────────────────────────────
    energy_morning_high   : Mapped[float] = mapped_column(Float, default=0.5, nullable=False)
    energy_morning_medium : Mapped[float] = mapped_column(Float, default=0.5, nullable=False)
    energy_morning_low    : Mapped[float] = mapped_column(Float, default=0.5, nullable=False)

    energy_afternoon_high   : Mapped[float] = mapped_column(Float, default=0.5, nullable=False)
    energy_afternoon_medium : Mapped[float] = mapped_column(Float, default=0.5, nullable=False)
    energy_afternoon_low    : Mapped[float] = mapped_column(Float, default=0.5, nullable=False)

    energy_evening_high   : Mapped[float] = mapped_column(Float, default=0.5, nullable=False)
    energy_evening_medium : Mapped[float] = mapped_column(Float, default=0.5, nullable=False)
    energy_evening_low    : Mapped[float] = mapped_column(Float, default=0.5, nullable=False)

    # ── Metadata ──────────────────────────────────────────────────────────────
    created_at : Mapped[datetime] = mapped_column(default=utcnow)
    updated_at : Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    owner: Mapped["User"] = relationship(back_populates="preferences")


class DailyFeedback(Base):
    """
    End-of-day check-in. One row per user per day.
    Captures stress and boredom separately for morning, afternoon, evening.

    stress_*  : 1 (very relaxed) - 5 (very stressed)
    boredom_* : 1 (very engaged) - 5 (very bored)

    High stress + low boredom in morning = schedule is too packed in the morning.
    Low stress + high boredom in afternoon = schedule is too light in the afternoon.
    The ML uses these signals to shift task density across the day.
    """

    __tablename__ = "daily_feedback"

    id      : Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id : Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    date    : Mapped[str] = mapped_column(String(10), nullable=False)  # YYYY-MM-DD

    # ── Per-period ratings (1-5) ───────────────────────────────────────────────
    stress_morning    : Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    boredom_morning   : Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    stress_afternoon  : Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    boredom_afternoon : Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    stress_evening    : Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    boredom_evening   : Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # ── Overall ───────────────────────────────────────────────────────────────
    overall_rating : Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 1-5
    notes          : Mapped[Optional[str]] = mapped_column(String,   nullable=True)

    created_at : Mapped[datetime] = mapped_column(default=utcnow)
    updated_at : Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    owner: Mapped["User"] = relationship(back_populates="feedback_entries")


class TaskFeedback(Base):
    """
    Per-task feedback submitted when a user marks a task complete.
    The most granular training signal -- tells us exactly how a specific
    task felt at a specific time of day for this specific user.

    feeling:
        "drained"   -- task cost more energy than expected
        "neutral"   -- felt fine
        "energized" -- task left them feeling good

    would_move:
        True if the user says they'd prefer this task at a different time.
        When True, preferred_time_given captures what they'd prefer instead.
        This directly updates preferred_time on the Task (unless locked).

    actual_duration vs task.duration_minutes:
        The difference tells us if the user consistently over/underestimates
        certain task types. Used to improve future duration predictions.
    """

    __tablename__ = "task_feedback"

    id      : Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id : Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    task_id : Mapped[int] = mapped_column(ForeignKey("tasks.id"), nullable=False)
    date    : Mapped[str] = mapped_column(String(10), nullable=False)  # YYYY-MM-DD

    # ── Outcome ───────────────────────────────────────────────────────────────
    actual_duration  : Mapped[Optional[int]] = mapped_column(Integer,    nullable=True)  # minutes
    time_of_day_done : Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # "morning"|"afternoon"|"evening"
    feeling          : Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # "drained"|"neutral"|"energized"
    satisfaction     : Mapped[Optional[int]] = mapped_column(Integer,    nullable=True)  # 1-5

    # ── Preference signal ──────────────────────────────────────────────────────
    would_move           : Mapped[bool]          = mapped_column(Boolean,    default=False, nullable=False)
    preferred_time_given : Mapped[Optional[str]] = mapped_column(String(10), nullable=True)

    created_at : Mapped[datetime] = mapped_column(default=utcnow)

    owner : Mapped["User"] = relationship(back_populates="task_feedback_entries")
    task  : Mapped["Task"] = relationship(back_populates="feedback")
