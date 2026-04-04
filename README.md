
# Personal Analytics Dashboard

A cross-platform personal analytics and scheduling application that generates daily schedules, adapts to user feedback, and optimizes workload over time using a hybrid rule-based and machine learning approach.

This project includes:
- A web-based dashboard
- A Tauri desktop application
- A Python desktop client (PySide6)
- A shared Python backend for scheduling, analytics, and optimization

---

## Features

- Daily task and schedule generation
- Dynamic schedule updates when tasks or appointments change
- Task prioritization based on importance and deadlines
- User feedback collection (stress / underwhelmed / balanced)
- Adaptive schedule optimization over time
- Web and desktop clients using the same backend logic

---

## System Architecture

The system follows a centralized backend design:

- **Backend (Python / FastAPI)**  
  Handles scheduling logic, task storage, feedback processing, and machine learning.

- **Web Client (React / Vite)**  
  Provides an interactive browser-based dashboard.

- **Tauri Desktop App**  
  Wraps the React frontend in a native desktop window via Tauri (Rust).

- **Python Desktop Client (PySide6)**  
  Alternative desktop application that communicates with the same backend API.

All computation is centralized in the backend to ensure consistency across platforms.

---

## Project Structure

```
personal-analytics-dashboard/
├── backend/        # FastAPI app, scheduler, ML logic
├── web/            # React/Vite frontend + Tauri desktop wrapper
├── desktop/        # Python/PySide6 desktop client
├── launcher/       # Startup scripts (Python + Go)
├── database/       # SQLite database file + schema
├── docs/           # Design and project documentation
└── requirements.txt
```

---

## Installation & Setup

Follow these steps to install all required dependencies and run the project locally.

---

## 1. Prerequisites

### Python
- Python **3.10 or newer** is required.
- Download from: https://www.python.org/downloads/

**IMPORTANT (Windows users)**  
During installation, check "Add Python to PATH".

Verify installation:
```bash
python --version
```

### Node.js
- Required to build the React frontend.
- Download from: https://nodejs.org/

Verify installation:
```bash
node --version
npm --version
```

### Rust (for Tauri desktop app)
- Required only if you want to run the Tauri desktop app.
- Download from: https://rustup.rs/

---

## 2. Clone the Repository

```bash
git clone https://github.com/ITSC-4155-Spring-2026-Team-11/personal-analytics-dashboard.git
cd personal-analytics-dashboard
```

---

## Quick Start (recommended)

On a fresh machine with Python 3.10+ and Node.js installed, run:

```bash
./start-dashboard.sh
```

The script will:
- Create/use a Python virtual environment
- Install backend dependencies from `requirements.txt`
- Build the React frontend if `web/react-version/dist/` is missing
- Start the API and open the app (Tauri if available, otherwise browser)

On Windows:

```bat
start-dashboard.bat
```

---

## 3. Backend Setup (API Server)

From the project root, create and activate a virtual environment:

```bash
# Create venv
python -m venv .venv

# Activate (Windows)
.venv\Scripts\activate

# Activate (macOS / Linux)
source .venv/bin/activate
```

Install dependencies:
```bash
pip install -r requirements.txt
```

Start the backend server from the project root:
```bash
python -m uvicorn backend.app:app --reload
```

The API will be available at:  
`http://127.0.0.1:8000`

Interactive API docs:  
`http://127.0.0.1:8000/docs`

---

## 4. Tauri Desktop App Setup

Requires Node.js and Rust (see Prerequisites).

```bash
cd web/react-version
npm install
npm run tauri:dev
```

---

## 5. Web Client Setup

```bash
cd web/react-version
npm install
npm run dev
```

The dev server runs at `http://localhost:5173`.

---

## 6. Running the Full System

Use the startup script (recommended):

```bash
./start-dashboard.sh   # macOS / Linux
start-dashboard.bat    # Windows
```

Or run manually:

1. Start the backend API (from project root):
```bash
python -m uvicorn backend.app:app --reload
```

2. Launch the Tauri desktop app:
```bash
cd web/react-version
npm run tauri:dev
```

3. Or open the web client in a browser:
```bash
cd web/react-version
npm run dev
```

---

## 7. Common Issues

**uvicorn not found:**
```bash
pip install uvicorn
```

**ModuleNotFoundError:**
1. Make sure the virtual environment is activated
2. Run `pip install -r requirements.txt` from the project root
3. Run uvicorn from the project root (not from inside `backend/`)

**CORS errors in browser:**  
Ensure the backend is running and accessible at `http://127.0.0.1:8000`

---

## Scheduling & ML Plan

This project uses a hybrid approach:

- **Rule-based scheduler** enforces hard constraints and creates a valid schedule.
- **ML components** improve personalization:
  - Supervised model estimates stress from schedule features.
  - Exponential moving average (EMA) adapts scheduling decisions based on user feedback.
