"""
preferences.py
--------------
Routes for reading and updating user preferences.

GET /preferences
    Returns the current user's raw preferences (user-set + ML-learned).

GET /preferences/figures
    Returns the preference data shaped for visualisation:
      - energy_curve: 3x3 grid (time-of-day × energy level) of learned weights
      - schedule_settings: wake/sleep times, chronotype, density, buffer
      - summary: human-readable interpretation of each weight

PUT /preferences
    Updates the user-set fields (wake_time, sleep_time, chronotype, timezone).
    ML-learned fields are read-only through this endpoint.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
from typing import Optional

from backend.dependencies import get_db, get_current_user
from backend.models import User, UserPreferences

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_or_create_prefs(user: User, db: Session) -> UserPreferences:
    """Return the user's UserPreferences row, creating it with defaults if absent."""
    prefs = db.query(UserPreferences).filter(
        UserPreferences.user_id == user.id
    ).first()

    if prefs is None:
        prefs = UserPreferences(user_id=user.id)
        db.add(prefs)
        db.commit()
        db.refresh(prefs)

    return prefs


def _weight_label(weight: float) -> str:
    """Convert a 0–1 energy weight to a human-readable label."""
    if weight >= 0.75:
        return "excellent"
    if weight >= 0.55:
        return "good"
    if weight >= 0.40:
        return "neutral"
    if weight >= 0.25:
        return "below average"
    return "poor"


# ── Request schema ────────────────────────────────────────────────────────────

class UpdatePreferencesRequest(BaseModel):
    wake_time  : Optional[str] = None  # HH:MM
    sleep_time : Optional[str] = None  # HH:MM
    chronotype : Optional[str] = None  # "morning" | "evening" | "neutral"
    timezone   : Optional[str] = None

    @field_validator("chronotype")
    @classmethod
    def validate_chronotype(cls, v):
        if v is not None and v not in ("morning", "evening", "neutral"):
            raise ValueError("chronotype must be morning, evening, or neutral")
        return v

    @field_validator("wake_time", "sleep_time")
    @classmethod
    def validate_hhmm(cls, v):
        if v is not None:
            parts = v.split(":")
            if len(parts) != 2 or not all(p.isdigit() for p in parts):
                raise ValueError("time must be in HH:MM format")
            h, m = int(parts[0]), int(parts[1])
            if not (0 <= h <= 23 and 0 <= m <= 59):
                raise ValueError("time out of range")
        return v


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
def get_preferences(
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """Return all preference fields for the current user."""
    prefs = _get_or_create_prefs(current_user, db)

    return {
        "user_id"   : current_user.id,
        # User-set
        "wake_time"  : prefs.wake_time,
        "sleep_time" : prefs.sleep_time,
        "chronotype" : prefs.chronotype,
        "timezone"   : prefs.timezone,
        # ML-learned schedule shape
        "schedule_density"         : prefs.schedule_density,
        "preferred_buffer_minutes" : prefs.preferred_buffer_minutes,
        # ML-learned energy weights
        "energy_morning_high"   : prefs.energy_morning_high,
        "energy_morning_medium" : prefs.energy_morning_medium,
        "energy_morning_low"    : prefs.energy_morning_low,
        "energy_afternoon_high"   : prefs.energy_afternoon_high,
        "energy_afternoon_medium" : prefs.energy_afternoon_medium,
        "energy_afternoon_low"    : prefs.energy_afternoon_low,
        "energy_evening_high"   : prefs.energy_evening_high,
        "energy_evening_medium" : prefs.energy_evening_medium,
        "energy_evening_low"    : prefs.energy_evening_low,
        # Metadata
        "created_at" : prefs.created_at,
        "updated_at" : prefs.updated_at,
    }


@router.get("/figures")
def get_preference_figures(
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """
    Return preference data shaped for the front-end visualisation layer.

    energy_curve
        3×3 grid of learned weights (0.0–1.0).
        Rows = time of day (morning, afternoon, evening).
        Columns = task energy level (high, medium, low).
        Each cell also carries a human-readable label.

    schedule_settings
        User-set and ML-learned schedule shape values.

    summary
        Flat list of notable insights derived from the weights,
        e.g. "You handle high-energy tasks best in the morning."
    """
    prefs = _get_or_create_prefs(current_user, db)

    # ── Build energy curve grid ───────────────────────────────────────────────
    energy_curve = {
        "morning": {
            "high"   : {"weight": prefs.energy_morning_high,   "label": _weight_label(prefs.energy_morning_high)},
            "medium" : {"weight": prefs.energy_morning_medium, "label": _weight_label(prefs.energy_morning_medium)},
            "low"    : {"weight": prefs.energy_morning_low,    "label": _weight_label(prefs.energy_morning_low)},
        },
        "afternoon": {
            "high"   : {"weight": prefs.energy_afternoon_high,   "label": _weight_label(prefs.energy_afternoon_high)},
            "medium" : {"weight": prefs.energy_afternoon_medium, "label": _weight_label(prefs.energy_afternoon_medium)},
            "low"    : {"weight": prefs.energy_afternoon_low,    "label": _weight_label(prefs.energy_afternoon_low)},
        },
        "evening": {
            "high"   : {"weight": prefs.energy_evening_high,   "label": _weight_label(prefs.energy_evening_high)},
            "medium" : {"weight": prefs.energy_evening_medium, "label": _weight_label(prefs.energy_evening_medium)},
            "low"    : {"weight": prefs.energy_evening_low,    "label": _weight_label(prefs.energy_evening_low)},
        },
    }

    # ── Schedule settings ─────────────────────────────────────────────────────
    schedule_settings = {
        "wake_time"               : prefs.wake_time,
        "sleep_time"              : prefs.sleep_time,
        "chronotype"              : prefs.chronotype,
        "timezone"                : prefs.timezone,
        "schedule_density"        : prefs.schedule_density,
        "preferred_buffer_minutes": prefs.preferred_buffer_minutes,
    }

    # ── Derive human-readable summary insights ────────────────────────────────
    summary = []

    # Best period for high-energy tasks
    high_scores = {
        "morning"  : prefs.energy_morning_high,
        "afternoon": prefs.energy_afternoon_high,
        "evening"  : prefs.energy_evening_high,
    }
    best_high = max(high_scores, key=high_scores.get)
    if high_scores[best_high] > 0.5:
        summary.append(f"You handle high-energy tasks best in the {best_high}.")

    # Worst period for high-energy tasks
    worst_high = min(high_scores, key=high_scores.get)
    if high_scores[worst_high] < 0.5:
        summary.append(f"Avoid scheduling demanding tasks in the {worst_high}.")

    # Schedule density insight
    if prefs.schedule_density == "packed":
        summary.append("You prefer a packed schedule with minimal gaps.")
    else:
        summary.append("You prefer breathing room between tasks.")

    # Buffer insight
    if prefs.preferred_buffer_minutes >= 20:
        summary.append(f"You typically need {prefs.preferred_buffer_minutes} min buffers between tasks.")

    # Chronotype
    if prefs.chronotype == "morning":
        summary.append("You are a morning person — your peak hours are early in the day.")
    elif prefs.chronotype == "evening":
        summary.append("You are an evening person — your peak hours come later in the day.")

    return {
        "user_id"          : current_user.id,
        "energy_curve"     : energy_curve,
        "schedule_settings": schedule_settings,
        "summary"          : summary,
    }


@router.put("")
def update_preferences(
    body         : UpdatePreferencesRequest,
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """Update the user-set preference fields."""
    prefs = _get_or_create_prefs(current_user, db)

    if body.wake_time  is not None: prefs.wake_time  = body.wake_time
    if body.sleep_time is not None: prefs.sleep_time = body.sleep_time
    if body.chronotype is not None: prefs.chronotype = body.chronotype
    if body.timezone   is not None: prefs.timezone   = body.timezone

    db.commit()
    db.refresh(prefs)

    return {
        "saved"     : True,
        "wake_time" : prefs.wake_time,
        "sleep_time": prefs.sleep_time,
        "chronotype": prefs.chronotype,
        "timezone"  : prefs.timezone,
    }
