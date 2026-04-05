import logging
import sys
from pathlib import Path

# Ensure the repo root is on sys.path so `from backend.xxx import ...` works
# when this file is run directly (IDE "Run" button) instead of via uvicorn from the repo root.
_repo_root = str(Path(__file__).resolve().parents[1])
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.database import engine
from backend.models import Base
from backend.sqlite_migrations import apply_sqlite_migrations

Base.metadata.create_all(bind=engine)
apply_sqlite_migrations(engine)

from backend.routes.tasks import router as tasks_router
from backend.routes.schedules import router as schedules_router
from backend.routes.feedback import router as feedback_router
from backend.routes.auth import router as auth_router

app = FastAPI(title="Personal Analytics Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "tauri://localhost",
        "http://tauri.localhost",
    ],  # Web + Tauri dev/prod origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(tasks_router,     prefix="/tasks",     tags=["tasks"])
app.include_router(schedules_router, prefix="/schedules", tags=["schedules"])
app.include_router(feedback_router,  prefix="/feedback",  tags=["feedback"])

# ── SPA (Vite build): same origin as API on :8000 — no separate Vite server needed ──
_REPO_ROOT = Path(__file__).resolve().parent.parent
_FRONTEND_DIST = _REPO_ROOT / "web" / "react-version" / "dist"
if _FRONTEND_DIST.is_dir():  # pragma: no cover
    # Serve the SPA without relying on `StaticFiles(html=True)` (it isn't
    # reliably falling back for client-side routes like `/login`).
    assets_dir = _FRONTEND_DIST / "assets"
    if assets_dir.is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=str(assets_dir), html=False),
            name="spa-assets",
        )

    index_html = _FRONTEND_DIST / "index.html"
    vite_svg = _FRONTEND_DIST / "vite.svg"

    _no_cache = {"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache"}

    @app.get("/")
    def spa_index():
        return FileResponse(str(index_html), headers=_no_cache)

    @app.get("/vite.svg")
    def spa_vite_svg():
        if not vite_svg.is_file():
            raise HTTPException(status_code=404)
        return FileResponse(str(vite_svg))

    @app.get("/{path:path}")
    def spa_fallback(path: str):
        # Don't swallow backend API routes.
        if path in ("auth", "tasks", "schedules", "feedback") or path.startswith(
            ("auth/", "tasks/", "schedules/", "feedback/")
        ):
            raise HTTPException(status_code=404)

        # Don't handle known FastAPI URLs.
        if path in ("openapi.json", "docs", "redoc"):
            raise HTTPException(status_code=404)

        # If it looks like a real file request, 404 instead of returning index.html.
        if "." in path:
            raise HTTPException(status_code=404)

        return FileResponse(str(index_html), headers=_no_cache)
else:
    logging.getLogger(__name__).warning(
        "web/react-version/dist missing — run `npm run build` in web/react-version to serve the UI on :8000"
    )