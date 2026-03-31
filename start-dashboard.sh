#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

ROOT_DIR="$(pwd)"

# Debian/Parrot often ship Python without a working ensurepip inside venv creation.
# Creating with --without-pip avoids that failure; we install pip afterward.
create_venv_no_pip() {
  echo "Creating Python virtual env (.venv, without bundled pip)..." >&2
  if python3 -m venv --help 2>/dev/null | grep -q -- '--without-pip'; then
    python3 -m venv --without-pip .venv
  else
    python3 -m venv .venv
  fi
}

bootstrap_pip() {
  local py="$1"
  if "$py" -m pip --version >/dev/null 2>&1; then
    return 0
  fi
  echo "Installing pip into venv..." >&2
  if "$py" -m ensurepip --upgrade --default-pip 2>/dev/null; then
    return 0
  fi
  echo "ensurepip failed; downloading get-pip.py (works on Debian/Parrot minimal installs)..." >&2
  local gp
  gp="$(mktemp)"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://bootstrap.pypa.io/get-pip.py -o "$gp"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$gp" https://bootstrap.pypa.io/get-pip.py
  else
    echo "Need curl or wget to download get-pip.py." >&2
    return 1
  fi
  if ! "$py" "$gp"; then
    rm -f "$gp"
    echo "get-pip.py failed. Try: sudo apt-get install -y python3-venv python3-pip" >&2
    return 1
  fi
  rm -f "$gp"
  "$py" -m pip --version >/dev/null 2>&1
}

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
  create_venv_no_pip
  PY="$ROOT_DIR/.venv/bin/python3"
fi

if ! bootstrap_pip "$PY"; then
  if command -v apt-get >/dev/null 2>&1; then
    echo "Trying system packages (python3-venv python3-pip), then recreating venv..." >&2
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
    create_venv_no_pip
    PY="$ROOT_DIR/.venv/bin/python3"
    bootstrap_pip "$PY" || {
      echo "Could not install pip into venv. See errors above." >&2
      exit 1
    }
  else
    exit 1
  fi
fi

echo "Installing Python dependencies..." >&2
"$PY" -m pip install --upgrade pip
retry_cmd 3 3 -- "$PY" -m pip install -r requirements.txt

# Build the React frontend if dist/ is missing (needed for the API to serve the SPA in a browser).
# Tauri dev uses Vite (:5173) and does not require dist/. To force a fresh dist/ anyway, use:
#   PAD_BUILD_FRONTEND=1 ./start-dashboard.sh
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
