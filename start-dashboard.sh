#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

ROOT_DIR="$(pwd)"

retry_cmd() {
  # Usage: retry_cmd <retries> <sleep_seconds> -- <command...>
  local retries="$1"
  local sleep_s="$2"
  shift 2
  shift # consume "--"
  local n=1
  while true; do
    if "$@"; then
      return 0
    fi
    if [[ "$n" -ge "$retries" ]]; then
      return 1
    fi
    echo "Command failed. Retrying ($n/$retries) in ${sleep_s}s..." >&2
    sleep "$sleep_s"
    n=$((n+1))
  done
}

pick_python() {
  if [[ -x "$ROOT_DIR/venv/bin/python3" ]]; then
    echo "$ROOT_DIR/venv/bin/python3"
    return 0
  fi
  if [[ -x "$ROOT_DIR/venv/bin/python" ]]; then
    echo "$ROOT_DIR/venv/bin/python"
    return 0
  fi
  if [[ -x "$ROOT_DIR/.venv/bin/python3" ]]; then
    echo "$ROOT_DIR/.venv/bin/python3"
    return 0
  fi
  if [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
    echo "$ROOT_DIR/.venv/bin/python"
    return 0
  fi
  return 1
}

PY="$(pick_python || true)"
if [[ -z "${PY:-}" ]]; then
  echo "Creating Python virtual env (.venv)..." >&2
  python3 -m venv .venv
  PY="$ROOT_DIR/.venv/bin/python3"
fi

# Some fresh installs create a venv without `pip`. If so, bootstrap it via ensurepip,
# and if that doesn't exist, install the system packages and recreate the venv.
if ! "$PY" -m pip --version >/dev/null 2>&1; then
  echo "Bootstrapping pip in venv (ensurepip)..." >&2
  if ! "$PY" -m ensurepip --upgrade --default-pip >/dev/null 2>&1; then
    echo "ensurepip missing. Installing system python3-pip/python3-venv..." >&2
    if command -v apt-get >/dev/null 2>&1; then
      # Wait for apt/dpkg lock to clear (common on fresh machines).
      for _ in $(seq 1 60); do
        if pgrep -x apt-get >/dev/null 2>&1 || pgrep -x apt >/dev/null 2>&1 || pgrep -x dpkg >/dev/null 2>&1; then
          sleep 2
          continue
        fi
        break
      done
      sudo apt-get update
      sudo apt-get install -y python3-venv python3-pip
      rm -rf "$ROOT_DIR/.venv" "$ROOT_DIR/venv"
      python3 -m venv .venv
      PY="$ROOT_DIR/.venv/bin/python3"
    else
      echo "No apt-get available to install python3-pip. Install python3-pip manually." >&2
      exit 1
    fi
    if ! "$PY" -m ensurepip --upgrade --default-pip >/dev/null 2>&1; then
      echo "Failed to bootstrap pip after installing system packages." >&2
      exit 1
    fi
  fi
fi

echo "Installing Python dependencies..." >&2
"$PY" -m pip install --upgrade pip
retry_cmd 3 3 -- "$PY" -m pip install -r requirements.txt

# Build the React frontend if dist/ is missing.
DIST_INDEX="$ROOT_DIR/web/react-version/dist/index.html"
if [[ ! -f "$DIST_INDEX" ]]; then
  echo "Building React frontend (npm run build)..." >&2
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm not found but frontend dist/ is missing." >&2
    echo "Install Node.js (includes npm) and re-run." >&2
    exit 1
  fi
  pushd "web/react-version" >/dev/null
  # Retry install/build a couple times; fresh machines can fail once due to network hiccups.
  if [[ -f package-lock.json ]]; then
    retry_cmd 3 4 -- npm ci --no-audit --no-fund
  else
    retry_cmd 3 4 -- npm install --no-audit --no-fund
  fi
  retry_cmd 3 4 -- npm run build
  popd >/dev/null
fi

exec "$PY" launcher/start_dashboard.py
