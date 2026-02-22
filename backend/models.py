from sqlalchemy import ForeignKey, String, Integer, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime, timezone
from typing import Optional
from backend.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ── Auth models ───────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id            : Mapped[int]            = mapped_column(Integer, primary_key=True, index=True)
    name          : Mapped[str]            = mapped_column(String, nullable=False)
    email         : Mapped[str]            = mapped_column(String, unique=True, nullable=False, index=True)
    password_hash : Mapped[str]            = mapped_column(String, nullable=False)
    is_verified   : Mapped[bool]           = mapped_column(Boolean, default=False, nullable=False)
    is_active     : Mapped[bool]           = mapped_column(Boolean, default=True, nullable=False)
    created_at    : Mapped[datetime]       = mapped_column(default=utcnow)
    last_login    : Mapped[Optional[datetime]] = mapped_column(nullable=True)

    tasks               : Mapped[list["Task"]]                   = relationship(back_populates="owner", cascade="all, delete-orphan")
    feedback_entries    : Mapped[list["Feedback"]]               = relationship(back_populates="owner", cascade="all, delete-orphan")
    verification_tokens : Mapped[list["EmailVerificationToken"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    refresh_tokens      : Mapped[list["RefreshToken"]]           = relationship(back_populates="user", cascade="all, delete-orphan")
    password_reset_tokens : Mapped[list["PasswordResetToken"]]   = relationship(back_populates="user", cascade="all, delete-orphan")


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
    __tablename__ = "tasks"

    id               : Mapped[int]            = mapped_column(Integer, primary_key=True, index=True)
    user_id          : Mapped[int]            = mapped_column(ForeignKey("users.id"), nullable=False)
    title            : Mapped[str]            = mapped_column(String, nullable=False)
    duration_minutes : Mapped[int]            = mapped_column(Integer, default=30)
    deadline         : Mapped[Optional[str]]  = mapped_column(String, nullable=True)
    importance       : Mapped[int]            = mapped_column(Integer, default=3)
    completed        : Mapped[bool]           = mapped_column(Boolean, default=False)
    created_at       : Mapped[datetime]       = mapped_column(default=utcnow)

    owner: Mapped["User"] = relationship(back_populates="tasks")


class Feedback(Base):
    __tablename__ = "feedback"

    id           : Mapped[int]           = mapped_column(Integer, primary_key=True, index=True)
    user_id      : Mapped[int]           = mapped_column(ForeignKey("users.id"), nullable=False)
    date         : Mapped[str]           = mapped_column(String, nullable=False)
    stress_level : Mapped[int]           = mapped_column(Integer, nullable=False)
    notes        : Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at   : Mapped[datetime]      = mapped_column(default=utcnow)

    owner: Mapped["User"] = relationship(back_populates="feedback_entries")