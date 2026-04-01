#!/usr/bin/env python3
"""Start the API, then open the Tauri desktop app (default) or the browser.

Usage (from repo root): python launcher/start_dashboard.py

Environment:
  PAD_LAUNCH=tauri|browser|none   (default: tauri)
  PAD_TAURI_USE_BINARY=1|0        (default: 0) If 1, prefer a built desktoptauri-widget binary under
                                  src-tauri/target/{debug,release}/. If 0 (default), run
                                  `npm run tauri:dev` (Vite on :5173) so UI changes show without
                                  rebuilding the Rust app. Set 1 only when you want the packaged binary.
  PAD_TAURI_BINARY=/path/to/app   optional; overrides auto-detected Tauri binary (implies using binary)
  PAD_WEBKIT_SAFE=1|0             (default: 1 on Linux) WebKitGTK workarounds for frozen/blank
                                  webviews on Debian/Parrot/VMs. Set 0 if you want GPU path.
  PAD_BUILD_FRONTEND=1|0          (default: 0) If 1, run `npm run build` in web/react-version before
                                  starting (refreshes dist/ for the API + browser; not needed for
                                  Tauri dev, which uses Vite).
"""
from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

HOST = os.environ.get("PAD_HOST", "127.0.0.1")
PORT = int(os.environ.get("PAD_PORT", "8000"))
PORT_TRIES = int(os.environ.get("PAD_PORT_TRIES", "10"))
LOGIN = "/login"

# Binary name from web/react-version/src-tauri/Cargo.toml [[bin]] / package name.
_TAURI_CRATE_BIN = "desktoptauri-widget"


class LaunchError(Exception):
    pass


def project_root() -> Path:
    if env := os.environ.get("PAD_PROJECT_ROOT"):
        p = Path(env).resolve()
        if (p / "backend" / "app.py").is_file():
            return p
    here = Path(__file__).resolve().parent
    for d in (here, *here.parents):
        if (d / "backend" / "app.py").is_file():
            return d
    raise SystemExit("Could not find project root (backend/app.py). Set PAD_PROJECT_ROOT.")


def find_python(root: Path) -> Path:
    if env := os.environ.get("PAD_PYTHON"):
        return Path(env)
    if sys.platform == "win32":
        for rel in ("venv\\Scripts\\python.exe", ".venv\\Scripts\\python.exe"):
            p = root / rel
            if p.is_file():
                return p
    else:
        for rel in ("venv/bin/python3", "venv/bin/python", ".venv/bin/python3", ".venv/bin/python"):
            p = root / rel
            if p.is_file():
                return p
    return Path(sys.executable)


def _tauri_binary_candidates(root: Path) -> list[Path]:
    base = root / "web" / "react-version" / "src-tauri" / "target"
    name = _TAURI_CRATE_BIN
    if sys.platform == "win32":
        name += ".exe"
    return [
        base / "release" / name,
        base / "debug" / name,
    ]


def launch_mode() -> str:
    return os.environ.get("PAD_LAUNCH", "tauri").strip().lower()


def _env_flag(name: str, default: str = "1") -> bool:
    v = os.environ.get(name, default).strip().lower()
    return v not in ("0", "false", "no", "off")


def env_for_tauri_child() -> dict[str, str]:
    """Linux WebKitGTK + DMA-BUF often freezes or half-blanks the webview on Debian/Parrot VMs."""
    env = os.environ.copy()
    if sys.platform.startswith("linux") and _env_flag("PAD_WEBKIT_SAFE", "1"):
        env.setdefault("WEBKIT_DISABLE_DMABUF_RENDERER", "1")
        env.setdefault("WEBKIT_DISABLE_COMPOSITING_MODE", "1")
    return env


def _prefer_tauri_binary() -> bool:
    if os.environ.get("PAD_TAURI_BINARY"):
        return True
    v = os.environ.get("PAD_TAURI_USE_BINARY", "0").strip().lower()
    return v in ("1", "true", "yes", "on")


def launch_client(root: Path, base: str) -> subprocess.Popen | None:
    mode = launch_mode()
    if mode == "none":
        print(f"Server is up at {base} — PAD_LAUNCH=none (open the app manually).", file=sys.stderr)
        return None
    if mode == "browser":
        webbrowser.open(f"{base}{LOGIN}")
        return None
    if mode != "tauri":
        raise LaunchError(f"Unknown PAD_LAUNCH={mode!r}; use tauri, browser, or none.")

    react = root / "web" / "react-version"
    env = env_for_tauri_child()
    kwargs: dict = {
        "cwd": str(react),
        "env": env,
        "stdout": sys.stdout,
        "stderr": sys.stderr,
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    else:
        kwargs["start_new_session"] = True

    if custom := os.environ.get("PAD_TAURI_BINARY"):
        p = Path(custom).expanduser()
        if not p.is_file():
            raise LaunchError(f"PAD_TAURI_BINARY not found: {p}")
        return subprocess.Popen([str(p)], cwd=str(root), env=env_for_tauri_child())

    # Default: Vite dev server so ./start-dashboard.sh reflects latest React changes without
    # rebuilding the Rust binary (a stale target/debug binary would otherwise hide UI updates).
    if not _prefer_tauri_binary():
        npm = shutil.which("npm")
        if npm and (react / "package.json").is_file():
            print(
                "Launching Tauri in dev mode (Vite :5173). "
                "Set PAD_TAURI_USE_BINARY=1 to use src-tauri/target/*/desktoptauri-widget instead.",
                file=sys.stderr,
            )
            return subprocess.Popen([npm, "run", "tauri:dev"], **kwargs)

    for cand in _tauri_binary_candidates(root):
        if cand.is_file():
            print(
                f"Using Tauri binary: {cand} (set PAD_TAURI_USE_BINARY=0 for `npm run tauri:dev`).",
                file=sys.stderr,
            )
            return subprocess.Popen([str(cand)], cwd=str(root), env=env_for_tauri_child())

    npm = shutil.which("npm")
    if not npm:
        raise LaunchError(
            "No Tauri binary under src-tauri/target/ and npm not found. Either:\n"
            f"  cd {react} && npm install && npm run tauri:build\n"
            "or install Node/npm and re-run (dev mode will run `npm run tauri:dev`)."
        )

    print("No Tauri binary found; using `npm run tauri:dev`.", file=sys.stderr)
    return subprocess.Popen([npm, "run", "tauri:dev"], **kwargs)


def server_ready(base: str) -> bool:
    # Checks FastAPI startup by hitting the openapi spec.
    try:
        with urllib.request.urlopen(f"{base}/openapi.json", timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False


def wait_for_server(base: str, attempts: int = 60) -> bool:
    for _ in range(attempts):
        if server_ready(base):
            return True
        time.sleep(0.5)
    return False


def maybe_rebuild_frontend(root: Path) -> None:
    """Refresh dist/ when PAD_BUILD_FRONTEND=1 (browser + API static SPA; not used by Tauri dev)."""
    v = os.environ.get("PAD_BUILD_FRONTEND", "0").strip().lower()
    if v not in ("1", "true", "yes", "on"):
        return
    react = root / "web" / "react-version"
    npm = shutil.which("npm")
    if not npm or not (react / "package.json").is_file():
        print("PAD_BUILD_FRONTEND=1 but npm or web/react-version/package.json missing.", file=sys.stderr)
        sys.exit(1)
    print("Running npm run build in web/react-version (PAD_BUILD_FRONTEND=1)...", file=sys.stderr)
    r = subprocess.run([npm, "run", "build"], cwd=str(react), env=os.environ.copy())
    if r.returncode != 0:
        sys.exit(r.returncode)


def main() -> None:
    root = project_root()
    maybe_rebuild_frontend(root)
    py = find_python(root)
    dist = root / "web" / "react-version" / "dist"
    if not dist.is_dir():
        print(
            "Note: web/react-version/dist is missing. Run: cd web/react-version && npm install && npm run build",
            file=sys.stderr,
        )

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"

    proc: subprocess.Popen | None = None
    tauri_proc: subprocess.Popen | None = None

    def kill(_sig=None, _frame=None):
        if tauri_proc and tauri_proc.poll() is None:
            tauri_proc.terminate()
            try:
                tauri_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                tauri_proc.kill()
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()

    signal.signal(signal.SIGINT, kill)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, kill)

    try:
        # Try multiple ports to avoid failures when 8000 is already used.
        for port in range(PORT, PORT + PORT_TRIES):
            base = f"http://{HOST}:{port}"

            # If something is already listening on this port, reuse it.
            if server_ready(base):
                try:
                    tauri_proc = launch_client(root, base)
                except LaunchError as e:
                    mode = launch_mode()
                    if mode == "tauri":
                        print(str(e), file=sys.stderr)
                        print("Falling back to browser (install Tauri/Rust to launch desktop app).", file=sys.stderr)
                        webbrowser.open(f"{base}{LOGIN}")
                        tauri_proc = None
                    else:
                        raise
                if tauri_proc:
                    tauri_proc.wait()
                return

            # Start uvicorn on this port.
            cmd = [
                str(py),
                "-m",
                "uvicorn",
                "backend.app:app",
                "--host",
                HOST,
                "--port",
                str(port),
            ]
            proc = subprocess.Popen(cmd, cwd=root, env=env)

            if not wait_for_server(base):
                # Give it another try on the next port.
                if proc and proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                proc = None
                continue

            try:
                tauri_proc = launch_client(root, base)
            except LaunchError as e:
                mode = launch_mode()
                if mode == "tauri":
                    # Fresh machines often don't have Rust/Tauri set up; in that case,
                    # still open the app in a browser so the user isn't blocked.
                    print(str(e), file=sys.stderr)
                    print("Falling back to browser (install Tauri/Rust to launch desktop app).", file=sys.stderr)
                    webbrowser.open(f"{base}{LOGIN}")
                    tauri_proc = None
                else:
                    print(str(e), file=sys.stderr)
                    kill()
                    sys.exit(1)

            # Keep the launcher alive as long as the backend is alive.
            proc.wait()
            return

        print(f"Server did not become ready on ports {PORT}..{PORT + PORT_TRIES - 1}.", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        kill()


if __name__ == "__main__":
    main()
