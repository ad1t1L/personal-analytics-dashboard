# Setup: .venv and MySQL

## 1. Create and use the virtual environment

From the project root (`personal-analytics-dashboard`):

```bash
# Create .venv
python -m venv .venv

# Activate (Windows PowerShell)
.\.venv\Scripts\Activate.ps1

# Activate (Windows CMD)
.\.venv\Scripts\activate.bat

# Activate (Linux/macOS)
source .venv/bin/activate

# Install backend dependencies
pip install -r requirements.txt
```

## 2. Run with SQLite (local dev)

By default, if `DATABASE_URL` is not set, the app uses `database/app.db`. If you have `DATABASE_URL` in `.env` (e.g. for MySQL) but want SQLite locally, set `USE_SQLITE=1` in `.env`:

```bash
uvicorn backend.app:app --reload
```

If you already have an existing `database/app.db` and are adding 2FA, add the new columns and table (e.g. in SQLite shell or any SQL client):

```sql
ALTER TABLE users ADD COLUMN totp_secret VARCHAR(32);
ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN email_2fa_enabled BOOLEAN NOT NULL DEFAULT 0;
-- Then create email_2fa_codes (see database/schema.sql) or let SQLAlchemy create it on first run.
```

## 3. Run with MySQL

1. **Create a MySQL database** (e.g. `plannerhub`).

2. **Optional: run the reference schema** (SQLAlchemy can also create tables on first run):
   ```bash
   mysql -u user -p plannerhub < database/schema_mysql.sql
   ```

3. **Set `DATABASE_URL`** and start the app:

   **Windows PowerShell:**
   ```powershell
   $env:DATABASE_URL = "mysql+pymysql://USER:PASSWORD@localhost:3306/plannerhub"
   uvicorn backend.app:app --reload
   ```

   **Or use a `.env` file** (create in project root; add `.env` to `.gitignore` if needed):
   ```
   DATABASE_URL=mysql+pymysql://USER:PASSWORD@localhost:3306/plannerhub
   ```
   Then load it before running (e.g. `pip install python-dotenv` and in `backend/config.py` add `load_dotenv()` and use `os.environ.get("DATABASE_URL", ...)` — or set the variable in your shell).

4. **Run the backend** from the project root:
   ```bash
   uvicorn backend.app:app --reload
   ```

5. **Run the React frontend** (from `web/react-version`):
   ```bash
   npm install
   npm run dev
   ```

## 2FA (authenticator app and email)

- **Enable:** Sign in → Dashboard → Security → “Enable 2FA” → scan QR with Google Authenticator / Authy → enter 6-digit code → Verify.
- **Login with 2FA:** After entering password, you’ll be asked for the 6-digit code from the app.
- **Disable:** Dashboard → Security → enter current code → “Disable 2FA”.
