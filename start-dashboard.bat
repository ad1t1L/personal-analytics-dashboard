@echo off
setlocal
cd /d "%~dp0"
if exist "venv\Scripts\python.exe" (
  "venv\Scripts\python.exe" launcher\start_dashboard.py
) else if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" launcher\start_dashboard.py
) else (
  python launcher\start_dashboard.py
)
pause
