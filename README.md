
# Personal Analytics Dashboard

A cross-platform personal analytics and scheduling application that generates daily schedules, adapts to user feedback, and optimizes workload over time using a hybrid rule-based and machine learning approach.

This project includes:
- A web-based dashboard
- A Windows desktop application
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

- **Web Client (HTML / CSS / JavaScript)**  
  Provides an interactive browser-based dashboard.

- **Desktop Client (Python GUI)**  
  Windows application that communicates with the same backend API.

All computation is centralized in the backend to ensure consistency across platforms.

---

## Project Structure

personal-analytics-dashboard/
├── backend/ # API, scheduler, ML logic
├── web/ # Browser-based UI
├── desktop/ # Windows application and widget
├── database/ # SQLite database file + schema
├── docs/ # Design and project documentation
└── README.md

---

## Installation & Setup

Follow these steps to install **all required dependencies** and run the project locally.

---

## 1 Prerequisites

### Python
- Python **3.10 or newer** is required.
- Download from: https://www.python.org/downloads/

 **IMPORTANT (Windows users)**  
During installation, make sure to check:

Add Python to PATH:

Verify installation:
```bash ```
python --version 

## 2 Clone the Repository

git clone https://github.com/ITSC-4155-Spring-2026-Team-11/personal-analytics-dashboard.git
cd personal-analytics-dashboard

## Quick Start (recommended)

On a fresh machine with Python 3.10+ and Node.js installed, you can run:

```bash
./start-dashboard.sh
```

The script will:
- create/use a Python virtual environment
- install backend dependencies
- build the React frontend if `web/react-version/dist/` is missing
- start the API and open the app (Tauri if available, otherwise browser)

On Windows:

```bat
start-dashboard.bat
```

## 3 Backend Setup (API Server)

Navigate to the backend directory:
cd backend


(Optional but recommended) Create a virtual environment:
python -m venv venv


Activate the virtual environment:

Windows:
venv\Scripts\activate


macOS / Linux:
source venv/bin/activate


Install dependencies from root:
pip install -r requirements.txt


Start the backend server:
uvicorn app:app --reload


The API will be available at:
http://127.0.0.1:8000


Interactive API docs:
http://127.0.0.1:8000/docs

## 4 Desktop Application Setup (PyQt)

cd web/react-version
npm run build
npm run tauri dev

## 5 Web Client Setup

navigate to the react-version directory:
cd web/react-version

Run: 

npm install
npm run build
npm run dev

## 6 Running the Full System

Use the startup script:

./start-dashboard.sh

Or run everything separately.

1. Start the backend API:

python -m uvicorn backend.app:app --reload

2. Run the desktop app:

cd web/react-version
npm run build
npm run tauri dev

3. Open the web client:

Navigate to the react directory and run npm install (only needed one time, the first time you run the program)

run: npm run dev

## 7 Common Issues

-- uvicorn not found:
pip install uvicorn

-- ModuleNotFoundError

Make sure:
1. Virtual environment is activated

2. Dependencies are installed

3. You are running commands from the correct directory

-- CORS errors in browser

Ensure the backend is running and accessible at:
http://127.0.0.1:8000


### 
1) Backend (API)
```bash ```
cd backend
pip install -r requirements.txt
uvicorn app:app --reload

API runs at:

http://127.0.0.1:8000

Docs UI:

http://127.0.0.1:8000/docs

2) Web Client

Open:
web/index.html

3) Desktop Client

# Start backend:
cd desktop
uvicorn app:app --reload

# Start desktop:
cd web/react-version
npm run tauri dev

---

### Scheduling & ML Plan

This project uses a hybrid approach:

Rule-based scheduler enforces hard constraints and creates a valid schedule.

ML components improve personalization:

Supervised model estimates stress from schedule features.

Exponential moving average (EMA) adapts scheduling decisions based on user feedback.