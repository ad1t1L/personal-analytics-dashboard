import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

const API = "http://localhost:8000";

type Session = { email?: string; loginTime?: string; name?: string };

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

function importanceDot(n: number) {
  if (n >= 5) return "#ff6b6b";
  if (n === 4) return "#ffa94d";
  if (n === 3) return "#ffd43b";
  if (n === 2) return "#74c0fc";
  return "#6b7083";
}

function getAuthHeaders(): HeadersInit {
  const token = sessionStorage.getItem("access_token");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

export default function Dashboard() {
  const nav = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // 2FA banner
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);
  const [email2FAEnabled, setEmail2FAEnabled] = useState<boolean | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Add task modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState<number>(30);
  const [deadline, setDeadline] = useState<string>("");
  const [importance, setImportance] = useState<number>(3);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Calendar
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());

  useEffect(() => {
    const raw = sessionStorage.getItem("planner_session");
    const t = sessionStorage.getItem("access_token");
    if (!raw || !t) { nav("/login", { replace: true }); return; }
    try {
      setSession(JSON.parse(raw));
    } catch {
      sessionStorage.clear();
      nav("/login", { replace: true });
    }
  }, [nav]);

  async function fetchTasks() {
    const t = sessionStorage.getItem("access_token");
    if (!t) { nav("/login", { replace: true }); return; }
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`${API}/tasks/`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.status === 401) { sessionStorage.clear(); nav("/login", { replace: true }); return; }
      const data = await res.json();
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
    } catch {
      setErr("Could not load tasks. Is the backend running on :8000?");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (session) fetchTasks(); }, [session]);

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

  useEffect(() => { if (session) fetch2FAStatus(); }, [session, fetch2FAStatus]);

  // Close modal on outside click
  useEffect(() => {
    if (!showAddModal) return;
    function handleClick(e: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setShowAddModal(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showAddModal]);

  // Close modal on Escape
  useEffect(() => {
    if (!showAddModal) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowAddModal(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [showAddModal]);

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    const t = sessionStorage.getItem("access_token");
    if (!t) return nav("/login", { replace: true });
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    setCreating(true); setCreateErr(null);
    try {
      const res = await fetch(`${API}/tasks/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ title: cleanTitle, duration_minutes: duration, deadline: deadline || null, importance }),
      });
      if (res.status === 401) { sessionStorage.clear(); nav("/login", { replace: true }); return; }
      if (!res.ok) { const msg = await res.text(); setCreateErr(msg || "Failed to create task."); return; }
      setTitle(""); setDuration(30); setDeadline(""); setImportance(3);
      setShowAddModal(false);
      await fetchTasks();
    } catch {
      setCreateErr("Failed to create task. Is the backend running?");
    } finally {
      setCreating(false);
    }
  }

  async function deleteTask(id: number) {
    const t = sessionStorage.getItem("access_token");
    if (!t) return nav("/login", { replace: true });
    const prev = tasks;
    setTasks((x) => x.filter((task) => task.id !== id));
    try {
      const res = await fetch(`${API}/tasks/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.status === 401) { sessionStorage.clear(); nav("/login", { replace: true }); return; }
      if (!res.ok) { setTasks(prev); setErr("Could not delete task."); }
    } catch {
      setTasks(prev);
      setErr("Could not delete task. Is the backend running?");
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
      } catch {}
    }
    sessionStorage.clear(); localStorage.clear();
    nav("/login", { replace: true });
  }

  if (!session) return null;

  const profileRaw = localStorage.getItem("planner_profile");
  const profile = profileRaw ? JSON.parse(profileRaw) : null;
  const displayName = profile?.fullName?.trim() || session.email?.split("@")[0] || "User";

  const show2FABanner = !bannerDismissed && totpEnabled === false && email2FAEnabled === false;

  // Calendar helpers
  const daysInMonth = getDaysInMonth(calYear, calMonth);
  const firstDay = getFirstDayOfMonth(calYear, calMonth);
  const calDays: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) calDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calDays.push(d);

  function tasksForDay(day: number): Task[] {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return tasks.filter((t) => t.deadline === dateStr);
  }

  function prevMonth() {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); }
    else setCalMonth(m => m - 1);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); }
    else setCalMonth(m => m + 1);
  }

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const upcomingTasks = [...tasks]
    .filter(t => t.deadline && t.deadline >= todayStr)
    .sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));
  const noDeadlineTasks = tasks.filter(t => !t.deadline);

  return (
    <>
      <header>
        <div className="brand">📋 PlannerHub</div>
        <div className="user-info">
          <span className="header-greeting">👋 {displayName}</span>
          <button className="ghost-btn" type="button" onClick={() => nav("/account")}>Account</button>
          <button className="signout-btn" onClick={signOut}>Sign Out</button>
        </div>
      </header>

      {/* 2FA Banner */}
      {show2FABanner && (
        <div className="twofa-banner">
          <div className="twofa-banner-content">
            <span className="twofa-banner-icon">🔐</span>
            <div>
              <strong>Secure your account</strong>
              <span className="twofa-banner-text"> — Two-factor authentication is not enabled. Enable it in your </span>
              <button className="twofa-banner-link" onClick={() => nav("/account")}>Account settings</button>.
            </div>
          </div>
          <button className="twofa-banner-dismiss" onClick={() => setBannerDismissed(true)} aria-label="Dismiss">✕</button>
        </div>
      )}

      <main className="dash">
        <aside className="sidebar">
          <div className="side-title">Dashboard</div>
          <button className="side-pill" type="button">Taskboard</button>
          <button className="side-link" type="button" onClick={() => nav("/account")}>Account settings</button>
          <button className="side-link side-link-danger" type="button" onClick={signOut}>Sign out</button>
        </aside>

        <div className="dash-content">
          {/* Tasks Panel */}
          <section className="panel">
            <div className="panel-head">
              <div>
                <h1 className="panel-title">My Tasks</h1>
                <p className="panel-sub">{tasks.length} task{tasks.length !== 1 ? "s" : ""} total</p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="ghost-btn" type="button" onClick={fetchTasks}>↻ Refresh</button>
                <button className="primary-btn" type="button" onClick={() => setShowAddModal(true)}>+ Add Task</button>
              </div>
            </div>

            {err && <div className="error">{err}</div>}

            <div className="list">
              {loading ? (
                <div className="empty">Loading tasks…</div>
              ) : tasks.length === 0 ? (
                <div className="empty">
                  <div style={{ fontSize: "2rem", marginBottom: 8 }}>📋</div>
                  No tasks yet. Click <strong>+ Add Task</strong> to get started.
                </div>
              ) : (
                <>
                  {upcomingTasks.length > 0 && (
                    <>
                      <div className="task-group-label">Upcoming deadlines</div>
                      {upcomingTasks.map((t) => (
                        <article className="task" key={t.id}>
                          <div className="task-main">
                            <div className="task-title">{t.title}</div>
                            <div className="task-meta">
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <span style={{ width: 7, height: 7, borderRadius: "50%", background: importanceDot(t.importance), display: "inline-block" }}></span>
                                {importanceLabel(t.importance)}
                              </span>
                              <span>•</span>
                              <span>{t.duration_minutes} min</span>
                              <span>•</span>
                              <span className="deadline-badge">📅 {t.deadline}</span>
                            </div>
                          </div>
                          <button className="danger-btn" onClick={() => deleteTask(t.id)}>Delete</button>
                        </article>
                      ))}
                    </>
                  )}
                  {noDeadlineTasks.length > 0 && (
                    <>
                      <div className="task-group-label" style={{ marginTop: upcomingTasks.length > 0 ? 16 : 0 }}>No deadline</div>
                      {noDeadlineTasks.map((t) => (
                        <article className="task" key={t.id}>
                          <div className="task-main">
                            <div className="task-title">{t.title}</div>
                            <div className="task-meta">
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <span style={{ width: 7, height: 7, borderRadius: "50%", background: importanceDot(t.importance), display: "inline-block" }}></span>
                                {importanceLabel(t.importance)}
                              </span>
                              <span>•</span>
                              <span>{t.duration_minutes} min</span>
                            </div>
                          </div>
                          <button className="danger-btn" onClick={() => deleteTask(t.id)}>Delete</button>
                        </article>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          </section>

          {/* Calendar Panel */}
          <section className="panel calendar-panel">
            <div className="calendar-header">
              <button className="cal-nav-btn" onClick={prevMonth}>‹</button>
              <h2 className="calendar-title">{MONTH_NAMES[calMonth]} {calYear}</h2>
              <button className="cal-nav-btn" onClick={nextMonth}>›</button>
            </div>

            <div className="calendar-grid">
              {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => (
                <div key={d} className="cal-day-name">{d}</div>
              ))}
              {calDays.map((day, i) => {
                if (!day) return <div key={`empty-${i}`} className="cal-day cal-day-empty" />;
                const dayTasks = tasksForDay(day);
                const isToday = day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();
                return (
                  <div key={day} className={`cal-day ${isToday ? "cal-day-today" : ""} ${dayTasks.length > 0 ? "cal-day-has-tasks" : ""}`}>
                    <span className="cal-day-num">{day}</span>
                    {dayTasks.slice(0, 2).map(t => (
                      <div key={t.id} className="cal-task-chip" style={{ borderLeftColor: importanceDot(t.importance) }}>
                        {t.title}
                      </div>
                    ))}
                    {dayTasks.length > 2 && (
                      <div className="cal-task-more">+{dayTasks.length - 2} more</div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </main>

      {/* Add Task Modal */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal" ref={modalRef}>
            <div className="modal-header">
              <h2 className="modal-title">Add New Task</h2>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>✕</button>
            </div>

            {createErr && <div className="error" style={{ marginBottom: 16 }}>{createErr}</div>}

            <form onSubmit={createTask}>
              <div className="modal-field">
                <label>Task title</label>
                <input
                  className="input"
                  placeholder="What needs to be done?"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  autoFocus
                />
              </div>

              <div className="modal-row">
                <div className="modal-field">
                  <label>Duration (min)</label>
                  <input
                    className="input"
                    type="number"
                    min={5}
                    max={600}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                  />
                </div>
                <div className="modal-field">
                  <label>Deadline</label>
                  <input
                    className="input"
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-field">
                <label>Importance</label>
                <div className="importance-picker">
                  {[1,2,3,4,5].map(n => (
                    <button
                      key={n}
                      type="button"
                      className={`importance-btn ${importance === n ? "importance-btn-active" : ""}`}
                      style={{ "--dot-color": importanceDot(n) } as React.CSSProperties}
                      onClick={() => setImportance(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <div className="importance-label-text">{importanceLabel(importance)}</div>
              </div>

              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn" disabled={creating || !title.trim()}>
                  {creating ? "Adding…" : "Add Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
