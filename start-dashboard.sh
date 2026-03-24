#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ -x venv/bin/python3 ]]; then
  exec venv/bin/python3 launcher/start_dashboard.py
elif [[ -x venv/bin/python ]]; then
  exec venv/bin/python launcher/start_dashboard.py
elif [[ -x .venv/bin/python3 ]]; then
  exec .venv/bin/python3 launcher/start_dashboard.py
else
  exec python3 launcher/start_dashboard.py
fi
