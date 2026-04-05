"""Put repo root on sys.path for `from backend...` (Run Python File skips conftest/pytest)."""

from __future__ import annotations

import sys
from pathlib import Path

_root = Path(__file__).resolve().parents[2]
_s = str(_root)
if _s not in sys.path:
    sys.path.insert(0, _s)
