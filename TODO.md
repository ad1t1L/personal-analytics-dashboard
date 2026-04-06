    ```md
# TODO

## Milestone 1 — Working MVP
- [ ] Backend API runs and returns mock schedule
- [ ] Web client fetches /schedules/today and renders it
- [ ] Desktop client fetches /schedules/today and shows it

## Milestone 2 — Persistence
- [ ] Add SQLite tables for tasks and feedback
- [ ] Implement create/list tasks using DB
- [ ] Store feedback in DB

## Milestone 3 — Rule-based Scheduler
- [ ] Use tasks + appointments to build schedule
- [ ] Enforce constraints (no overlaps, max hours)
- [ ] Add priority engine (deadlines + importance)

## Milestone 4 — ML Enhancements
- [ ] Stress prediction model (supervised)
- [ ] Q-learning policy for schedule adjustments
- [ ] Train/update based on feedback logs

## Immediate

Change allow_origins to your actual domain(s) before deploying
    Example production value:
        allow_origins=["https://yourapp.com", "https://www.yourapp.com"]

Generate a strong key once:
   python -c "import secrets; print(secrets.token_hex(32))"
Then set it as an environment variable on your machine/server:
Windows:  setx SECRET_KEY "your-generated-key"
Mac/Linux: export SECRET_KEY="your-generated-key"
