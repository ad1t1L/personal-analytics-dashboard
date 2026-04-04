@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "ROOT_DIR=%cd%"

set "PY="
if exist "%ROOT_DIR%\venv\Scripts\python.exe" set "PY=%ROOT_DIR%\venv\Scripts\python.exe"
if "%PY%"=="" if exist "%ROOT_DIR%\.venv\Scripts\python.exe" set "PY=%ROOT_DIR%\.venv\Scripts\python.exe"

if "%PY%"=="" (
  echo Creating Python virtual env ^(.venv^)... 1>&2
  python -m venv .venv
  set "PY=%ROOT_DIR%\.venv\Scripts\python.exe"
)

REM Some fresh installs create a venv without pip. If so, bootstrap it via ensurepip.
%PY% -m pip --version >nul 2>nul
if errorlevel 1 (
  echo Bootstrapping pip in venv ^(ensurepip^)... 1>&2
  "%PY%" -m ensurepip --upgrade --default-pip
  if errorlevel 1 (
    echo Could not bootstrap pip. Install system package: python3-pip ^(and python3-venv^). 1>&2
    exit /b 1
  )
)

echo Installing Python dependencies... 1>&2
"%PY%" -m pip install --upgrade pip
"%PY%" -m pip install -r requirements.txt

set "DIST_INDEX=%ROOT_DIR%\web\react-version\dist\index.html"
if not exist "%DIST_INDEX%" (
  echo Building React frontend ^(npm run build^)... 1>&2
  where npm >nul 2>nul
  if errorlevel 1 (
    echo npm not found but frontend dist/ is missing. 1>&2
    echo Install Node.js ^(includes npm^) and re-run start-dashboard.bat. 1>&2
    exit /b 1
  )
  pushd web\react-version
  if exist package-lock.json (
    npm ci --no-audit --no-fund
  ) else (
    npm install --no-audit --no-fund
  )
  npm run build
  popd
)

"%PY%" launcher\start_dashboard.py
