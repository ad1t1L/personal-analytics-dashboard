"""
priority_engine.py
------------------
Scores and ranks tasks to determine what order they should be placed
into the schedule, and what time of day each task prefers.

The score for each task is a weighted sum of:

  1. Importance (1-5, user-set)             -- how critical is this task
  2. Deadline urgency                        -- how soon is it due
  3. Energy match                            -- does this task's energy level
                                                match what the user can handle
                                                at the candidate time of day
  4. Preferred time match                    -- does the candidate slot match
                                                the user's learned preference
  5. Procrastination penalty                 -- tasks rescheduled many times
                                                get pushed up the priority list

The energy match scores come from UserPreferences.energy_* weights, which
start at 0.5 and get updated by the learning engine as feedback comes in.

This file does NOT place tasks -- it only scores and ranks them.
rule_based.py uses these scores to decide placement order.
"""

from datetime import date
from typing import Optional


# ── Scoring weights ───────────────────────────────────────────────────────────
# Adjust these to change how much each factor influences the schedule.
# They must sum to 1.0 for the score to stay in a predictable range,
# but the scheduler will work either way.

W_IMPORTANCE   = 0.30
W_DEADLINE     = 0.25
W_ENERGY       = 0.20
W_PREFERRED    = 0.15
W_PROCRASTINATE = 0.10


# ── Deadline urgency ──────────────────────────────────────────────────────────

def deadline_urgency(deadline_str: Optional[str], today_str: str) -> float:
    """
    Return a 0.0-1.0 urgency score based on how soon the deadline is.

      No deadline  -> 0.0  (no urgency)
      >14 days     -> 0.1  (low urgency)
      7-14 days    -> 0.3
      3-7 days     -> 0.6
      1-3 days     -> 0.85
      Today/overdue -> 1.0 (maximum urgency)
    """
    if not deadline_str:
        return 0.0

    try:
        deadline = date.fromisoformat(deadline_str)
        today    = date.fromisoformat(today_str)
        days_left = (deadline - today).days
    except ValueError:
        return 0.0

    if days_left <= 0:
        return 1.0
    if days_left <= 3:
        return 0.85
    if days_left <= 7:
        return 0.6
    if days_left <= 14:
        return 0.3
    return 0.1


# ── Energy match ──────────────────────────────────────────────────────────────

def energy_match_score(
    energy_level : str,
    time_of_day  : str,
    prefs        : dict,
) -> float:
    """
    Look up the user's learned energy curve weight for this
    (energy_level, time_of_day) combination.

    prefs is a dict with keys like energy_morning_high, energy_afternoon_medium etc.
    These come from UserPreferences and start at 0.5 (neutral).

    Returns 0.0-1.0. Higher = better match.
    """
    key = f"energy_{time_of_day}_{energy_level}"
    return float(prefs.get(key, 0.5))


# ── Preferred time match ──────────────────────────────────────────────────────

def preferred_time_score(preferred_time: str, candidate_time_of_day: str) -> float:
    """
    Score how well the candidate time slot matches the task's preferred time.

      Exact match  -> 1.0
      "none"       -> 0.5 (no preference, neutral)
      No match     -> 0.0
    """
    if preferred_time == "none":
        return 0.5
    if preferred_time == candidate_time_of_day:
        return 1.0
    return 0.0


# ── Procrastination score ─────────────────────────────────────────────────────

def procrastination_score(times_rescheduled: int) -> float:
    """
    Tasks that keep getting pushed back need to be prioritised.
    Returns 0.0-1.0. Caps at 1.0 after 5+ reschedules.
    """
    return min(times_rescheduled / 5.0, 1.0)


# ── Importance normalisation ──────────────────────────────────────────────────

def importance_score(importance: int) -> float:
    """Normalise importance 1-5 to 0.0-1.0."""
    return (max(1, min(5, importance)) - 1) / 4.0


# ── Main scoring function ─────────────────────────────────────────────────────

def score_task_for_slot(
    task             : dict,
    candidate_time_of_day : str,
    today_str        : str,
    prefs            : dict,
) -> float:
    """
    Compute a composite score for placing a specific task in a specific
    time-of-day slot. Higher score = better fit.

    task dict must have:
        importance, deadline, energy_level, preferred_time, times_rescheduled

    prefs dict must have energy_* keys from UserPreferences.

    Returns a float in roughly 0.0-1.0 range.
    """
    s_importance    = importance_score(task.get("importance", 3))
    s_deadline      = deadline_urgency(task.get("deadline"), today_str)
    s_energy        = energy_match_score(
                          task.get("energy_level", "medium"),
                          candidate_time_of_day,
                          prefs,
                      )
    s_preferred     = preferred_time_score(
                          task.get("preferred_time", "none"),
                          candidate_time_of_day,
                      )
    s_procrastinate = procrastination_score(task.get("times_rescheduled", 0))

    return (
        W_IMPORTANCE    * s_importance    +
        W_DEADLINE      * s_deadline      +
        W_ENERGY        * s_energy        +
        W_PREFERRED     * s_preferred     +
        W_PROCRASTINATE * s_procrastinate
    )


# ── Rank tasks for the day ────────────────────────────────────────────────────

def rank_tasks(
    tasks     : list[dict],
    today_str : str,
    prefs     : dict,
) -> list[dict]:
    """
    Sort flexible/semi tasks by their best possible score across all time slots.
    Tasks with higher peak scores get placed first, ensuring the most important
    and urgent tasks claim the best time slots.

    Fixed tasks are excluded -- they don't need ranking.
    Returns tasks sorted highest-score first.
    """
    flexible = [t for t in tasks if t.get("task_type") != "fixed"]

    def best_score(task: dict) -> float:
        return max(
            score_task_for_slot(task, period, today_str, prefs)
            for period in ("morning", "afternoon", "evening")
        )

    return sorted(flexible, key=best_score, reverse=True)
