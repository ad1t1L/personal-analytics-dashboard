import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";


const API = "http://localhost:8000";

type Session = { email?: string; loginTime?: string };

type Task = {
  id: number;
  title: string;
  duration_minutes: number;
  deadline: string | null;
  importance: number;
  completed: boolean;
  created_at: string;
};

function importanceLabel(n: number) {
  if (n >= 5) return "Very high";
  if (n === 4) return "High";
  if (n === 3) return "Medium";
  if (n === 2) return "Low";
  return "Very low";
}

function getAuthHeaders(): HeadersInit {
  const token = sessionStorage.getItem("access_token");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export default function Dashboard() {
  const nav = useNavigate();

  const [session, setSession] = useState<Session | null>(null);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Create task form state
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState<number>(30);
  const [deadline, setDeadline] = useState<string>("");
  const [importance, setImportance] = useState<number>(3);
  const [creating, setCreating] = useState(false);

  // 2FA state
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);
  const [email2FAEnabled, setEmail2FAEnabled] = useState<boolean | null>(null);
  const [twoFASetup, setTwoFASetup] = useState<{ qr_base64: string; secret: string } | null>(null);
  const [twoFASetupCode, setTwoFASetupCode] = useState("");
  const [twoFADisableCode, setTwoFADisableCode] = useState("");
  const [twoFAMessage, setTwoFAMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [twoFALoading, setTwoFALoading] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem("planner_session");
    const t = sessionStorage.getItem("access_token");

    if (!raw || !t) {
      nav("/login", { replace: true });
      return;
    }

    try {
      setSession(JSON.parse(raw));
    } catch {
      sessionStorage.clear();
      nav("/login", { replace: true });
    }
  }, [nav]);

  async function fetchTasks() {
    const t = sessionStorage.getItem("access_token");
    if (!t) {
      nav("/login", { replace: true });
      return;
    }

    setLoading(true);
    setErr(null);

    try {
      const res = await fetch(`${API}/tasks/`, {
        headers: { Authorization: `Bearer ${t}` },
      });

      if (res.status === 401) {
        sessionStorage.clear();
        nav("/login", { replace: true });
        return;
      }

      const data = await res.json();
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
    } catch {
      setErr("Could not load tasks. Is the backend running on :8000?");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!session) return;
    fetchTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    const t = sessionStorage.getItem("access_token");
    if (!t) return nav("/login", { replace: true });

    const cleanTitle = title.trim();
    if (!cleanTitle) return;

    setCreating(true);
    setErr(null);

    try {
      const res = await fetch(`${API}/tasks/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${t}`,
        },
        body: JSON.stringify({
          title: cleanTitle,
          duration_minutes: duration,
          deadline: deadline ? deadline : null,
          importance,
        }),
      });

      if (res.status === 401) {
        sessionStorage.clear();
        nav("/login", { replace: true });
        return;
      }

      if (!res.ok) {
        const msg = await res.text();
        setErr(msg || "Failed to create task.");
        return;
      }

      setTitle("");
      setDuration(30);
      setDeadline("");
      setImportance(3);

      await fetchTasks();
    } catch {
      setErr("Failed to create task. Is the backend running?");
    } finally {
      setCreating(false);
    }
  }

  async function deleteTask(id: number) {
    const t = sessionStorage.getItem("access_token");
    if (!t) return nav("/login", { replace: true });

    // Optimistic UI (feels snappy)
    const prev = tasks;
    setTasks((x) => x.filter((t) => t.id !== id));

    try {
      const res = await fetch(`${API}/tasks/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${t}` },
      });

      if (res.status === 401) {
        sessionStorage.clear();
        nav("/login", { replace: true });
        return;
      }

      if (!res.ok) {
        setTasks(prev); // rollback
        setErr("Could not delete task.");
      }
    } catch {
      setTasks(prev); // rollback
      setErr("Could not delete task. Is the backend running?");
    }
  }

  const fetch2FAStatus = useCallback(async () => {
    const token = sessionStorage.getItem("access_token");
    if (!token) return;
    try {
      const res = await fetch(`${API}/auth/2fa/status`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setTotpEnabled(!!data.totp_enabled);
        setEmail2FAEnabled(!!data.email_2fa_enabled);
      }
    } catch {
      setTotpEnabled(false);
      setEmail2FAEnabled(false);
    }
  }, []);

  useEffect(() => {
    if (session) fetch2FAStatus();
  }, [session, fetch2FAStatus]);

  async function start2FASetup() {
    setTwoFAMessage(null);
    setTwoFALoading(true);
    try {
      const res = await fetch(`${API}/auth/2fa/setup`, { method: "POST", headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Setup failed");
      setTwoFASetup({ qr_base64: data.qr_base64, secret: data.secret });
      setTwoFASetupCode("");
    } catch (e) {
      setTwoFAMessage({ type: "err", text: e instanceof Error ? e.message : "Setup failed" });
    } finally {
      setTwoFALoading(false);
    }
  }

  async function confirm2FASetup() {
    const code = twoFASetupCode.replace(/\D/g, "");
    if (code.length !== 6) {
      setTwoFAMessage({ type: "err", text: "Enter the 6-digit code from your app." });
      return;
    }
    setTwoFALoading(true);
    setTwoFAMessage(null);
    try {
      const res = await fetch(`${API}/auth/2fa/verify`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Verification failed");
      setTwoFAMessage({ type: "ok", text: "2FA is now enabled." });
      setTwoFASetup(null);
      setTwoFASetupCode("");
      setTotpEnabled(true);
    } catch (e) {
      setTwoFAMessage({ type: "err", text: e instanceof Error ? e.message : "Invalid code." });
    } finally {
      setTwoFALoading(false);
    }
  }

  async function disable2FA() {
    const code = twoFADisableCode.replace(/\D/g, "");
    if (code.length !== 6) {
      setTwoFAMessage({ type: "err", text: "Enter your current 6-digit code." });
      return;
    }
    setTwoFALoading(true);
    setTwoFAMessage(null);
    try {
      const res = await fetch(`${API}/auth/2fa/disable`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Disable failed");
      setTwoFAMessage({ type: "ok", text: "Authenticator 2FA has been disabled." });
      setTwoFADisableCode("");
      setTotpEnabled(false);
    } catch (e) {
      setTwoFAMessage({ type: "err", text: e instanceof Error ? e.message : "Invalid code." });
    } finally {
      setTwoFALoading(false);
    }
  }

  async function enableEmail2FA() {
    setTwoFALoading(true);
    setTwoFAMessage(null);
    try {
      const res = await fetch(`${API}/auth/2fa/enable-email`, { method: "POST", headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Enable failed");
      setTwoFAMessage({ type: "ok", text: "Email 2FA is now enabled. You can request a code at login." });
      setEmail2FAEnabled(true);
    } catch (e) {
      setTwoFAMessage({ type: "err", text: e instanceof Error ? e.message : "Enable failed" });
    } finally {
      setTwoFALoading(false);
    }
  }

  async function disableEmail2FA() {
    setTwoFALoading(true);
    setTwoFAMessage(null);
    try {
      const res = await fetch(`${API}/auth/2fa/disable-email`, { method: "POST", headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Disable failed");
      setTwoFAMessage({ type: "ok", text: "Email 2FA has been disabled." });
      setEmail2FAEnabled(false);
    } catch (e) {
      setTwoFAMessage({ type: "err", text: e instanceof Error ? e.message : "Disable failed" });
    } finally {
      setTwoFALoading(false);
    }
  }

  async function signOut() {
    const refreshToken = sessionStorage.getItem("refresh_token");

    if (refreshToken) {
      try {
        await fetch(`${API}/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
      } catch {
        // ignore
      }
    }

    sessionStorage.clear();
    localStorage.clear();
    nav("/login", { replace: true });
  }

  if (!session) return null;

  return (
    <>
      <header>
        <div className="brand">📋 PlannerHub</div>
          <div className="user-info" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span>{`👋 Welcome, ${session.email ?? "User"}`}</span>
          <button className="ghost-btn" type="button" onClick={() => nav("/account")}>
            Account
          </button>
          <button className="signout-btn" onClick={signOut}>
            Sign Out
          </button>
        </div>
      </header>

      <main className="dash">
        <aside className="sidebar">
          <div className="side-title">TASK</div>

          <button className="side-pill" type="button">
            TASKBOARD
          </button>

          <button
            className="side-link"
            type="button"
            onClick={() => alert("Tags UI stub — add backend tags later.")}
            title="Hook this up after you add tags to the DB/API"
          >
            Add tag +
          </button>

          <div className="side-muted">
            Issue #22: Home page UI
            <br />
            (Sidebar + taskboard)
          </div>
        </aside>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h1 className="panel-title">Taskboard</h1>
              <p className="panel-sub">Create tasks with details for your day.</p>
            </div>
            <button className="ghost-btn" type="button" onClick={fetchTasks}>
              Refresh
            </button>
          </div>

          <form className="create" onSubmit={createTask}>
            <input
              className="input"
              placeholder="Task title…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
            />

            <div className="row">
              <label className="field">
                <span>Duration (min)</span>
                <input
                  className="input"
                  type="number"
                  min={5}
                  max={600}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                />
              </label>

              <label className="field">
                <span>Deadline</span>
                <input
                  className="input"
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                />
              </label>

              <label className="field">
                <span>Importance</span>
                <select
                  className="input"
                  value={importance}
                  onChange={(e) => setImportance(Number(e.target.value))}
                >
                  <option value={1}>1 (Very low)</option>
                  <option value={2}>2 (Low)</option>
                  <option value={3}>3 (Medium)</option>
                  <option value={4}>4 (High)</option>
                  <option value={5}>5 (Very high)</option>
                </select>
              </label>

              <button className="primary-btn" type="submit" disabled={creating}>
                {creating ? "Adding…" : "Add task"}
              </button>
            </div>
          </form>

          {err && <div className="error">{err}</div>}

          <div className="list">
            {loading ? (
              <div className="empty">Loading tasks…</div>
            ) : tasks.length === 0 ? (
              <div className="empty">No tasks yet. Add one above.</div>
            ) : (
              tasks.map((t) => (
                <article className="task" key={t.id}>
                  <div className="task-main">
                    <div className="task-title">{t.title}</div>
                    <div className="task-meta">
                      <span>{t.duration_minutes} min</span>
                      <span>•</span>
                      <span>{importanceLabel(t.importance)}</span>
                      {t.deadline ? (
                        <>
                          <span>•</span>
                          <span>Due {t.deadline}</span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <button className="danger-btn" onClick={() => deleteTask(t.id)}>
                    Delete
                  </button>
                </article>
              ))
            )}
          </div>

          <section className="security-section" style={{ marginTop: 32, padding: 24, border: "1px solid #333", borderRadius: 8 }}>
            <h2 style={{ marginTop: 0 }}>Security — Two-factor authentication</h2>
            {twoFAMessage && (
              <p style={{ color: twoFAMessage.type === "err" ? "#ff6b6b" : "#38d9a9", marginBottom: 12 }}>{twoFAMessage.text}</p>
            )}
            {(totpEnabled === null && email2FAEnabled === null) && <p>Loading…</p>}
            {(totpEnabled !== null || email2FAEnabled !== null) && (
            <>
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: "1rem", marginBottom: 8 }}>Authenticator app</h3>
              {totpEnabled === false && !twoFASetup && (
                <div>
                  <p>Use Google Authenticator, Authy, etc. to get a 6-digit code at login.</p>
                  <button type="button" onClick={start2FASetup} disabled={twoFALoading} className="submit-btn" style={{ marginTop: 8 }}>
                    Enable authenticator 2FA
                  </button>
                </div>
              )}
              {twoFASetup && (
                <div>
                  <p>Scan this QR code with your authenticator app, then enter the 6-digit code below.</p>
                  <img
                    src={`data:image/png;base64,${String(twoFASetup.qr_base64).replace(/\s/g, "")}`}
                    alt="2FA QR - scan with authenticator app"
                    style={{ display: "block", margin: "12px 0", width: 180, height: 180, border: "1px solid #444" }}
                  />
                  <p style={{ fontSize: "0.85rem", color: "#888", marginTop: 8 }}>
                    Can&apos;t scan? Enter this secret manually in your app: <code style={{ userSelect: "all", padding: "2px 6px", background: "#222" }}>{twoFASetup.secret}</code>
                  </p>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="000000"
                    maxLength={6}
                    value={twoFASetupCode}
                    onChange={(e) => setTwoFASetupCode(e.target.value.replace(/\D/g, ""))}
                    disabled={twoFALoading}
                    style={{ padding: 8, marginRight: 8, width: 100 }}
                  />
                  <button type="button" onClick={confirm2FASetup} disabled={twoFALoading || twoFASetupCode.length !== 6} className="submit-btn" style={{ marginRight: 8 }}>
                    Verify &amp; enable
                  </button>
                  <button type="button" onClick={() => { setTwoFASetup(null); setTwoFAMessage(null); }} disabled={twoFALoading} className="link-btn">
                    Cancel
                  </button>
                </div>
              )}
              {totpEnabled === true && !twoFASetup && (
                <div>
                  <p>Authenticator 2FA is <strong>on</strong>.</p>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Code to disable"
                    maxLength={6}
                    value={twoFADisableCode}
                    onChange={(e) => setTwoFADisableCode(e.target.value.replace(/\D/g, ""))}
                    disabled={twoFALoading}
                    style={{ padding: 8, marginRight: 8, width: 120 }}
                  />
                  <button type="button" onClick={disable2FA} disabled={twoFALoading || twoFADisableCode.length !== 6} className="submit-btn" style={{ background: "#666" }}>
                    Disable authenticator 2FA
                  </button>
                </div>
              )}
            </div>

            <div>
              <h3 style={{ fontSize: "1rem", marginBottom: 8 }}>Email code</h3>
              {email2FAEnabled === false && (
                <div>
                  <p>Receive a 6-digit code by email at login (uses the same email as in <code>email_utils.py</code>).</p>
                  <button type="button" onClick={enableEmail2FA} disabled={twoFALoading} className="submit-btn" style={{ marginTop: 8 }}>
                    Enable email 2FA
                  </button>
                </div>
              )}
              {email2FAEnabled === true && (
                <div>
                  <p>Email 2FA is <strong>on</strong>. You can request a code at login.</p>
                  <button type="button" onClick={disableEmail2FA} disabled={twoFALoading} className="submit-btn" style={{ background: "#666", marginTop: 8 }}>
                    Disable email 2FA
                  </button>
                </div>
              )}
            </div>
            </>
            )}
          </section>
        </section>
      </main>
    </>
  );
}
