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

// ── Star rating component ──────────────────────────────────────────────────────
function StarRating({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="star-rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`star-btn ${n <= (hover || value) ? "star-btn-filled" : ""}`}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(value === n ? 0 : n)}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// ── Stress dot scale (1-5) ─────────────────────────────────────────────────────
function StressScale({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="stress-scale">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`stress-dot ${value === n ? "stress-dot-active" : ""}`}
          data-level={n}
          onClick={() => onChange(value === n ? 0 : n)}
          aria-label={`Stress level ${n}`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

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

  // Task completion survey modal (#38)
  const [showTaskSurvey, setShowTaskSurvey] = useState(false);
  const [surveyTaskId, setSurveyTaskId] = useState<number | null>(null);
  const [surveyTaskTitle, setSurveyTaskTitle] = useState("");
  const [surveyFeeling, setSurveyFeeling] = useState<string>("");
  const [surveySatisfaction, setSurveySatisfaction] = useState<number>(0);
  const [submittingTaskSurvey, setSubmittingTaskSurvey] = useState(false);
  const taskSurveyRef = useRef<HTMLDivElement>(null);

  // End-of-day survey modal (#40)
  const [showEODModal, setShowEODModal] = useState(false);
  const [eodStressMorning, setEodStressMorning] = useState<number>(0);
  const [eodStressAfternoon, setEodStressAfternoon] = useState<number>(0);
  const [eodStressEvening, setEodStressEvening] = useState<number>(0);
  const [eodOverall, setEodOverall] = useState<number>(0);
  const [eodNotes, setEodNotes] = useState("");
  const [submittingEOD, setSubmittingEOD] = useState(false);
  const [eodSuccess, setEodSuccess] = useState(false);
  const eodModalRef = useRef<HTMLDivElement>(null);

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
      setTasks(Array.isArray(data.tasks) ? data.tasks.filter((t: Task) => !t.completed) : []);
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

  // Close Add Task modal on outside click / Escape
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

  useEffect(() => {
    if (!showAddModal) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowAddModal(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [showAddModal]);

  // Close Task Survey modal on outside click / Escape
  useEffect(() => {
    if (!showTaskSurvey) return;
    function handleClick(e: MouseEvent) {
      if (taskSurveyRef.current && !taskSurveyRef.current.contains(e.target as Node)) {
        setShowTaskSurvey(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showTaskSurvey]);

  useEffect(() => {
    if (!showTaskSurvey) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowTaskSurvey(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [showTaskSurvey]);

  // Close EOD modal on outside click / Escape
  useEffect(() => {
    if (!showEODModal) return;
    function handleClick(e: MouseEvent) {
      if (eodModalRef.current && !eodModalRef.current.contains(e.target as Node)) {
        setShowEODModal(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showEODModal]);

  useEffect(() => {
    if (!showEODModal) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowEODModal(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [showEODModal]);

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

  async function completeTask(id: number, taskTitle: string) {
    const t = sessionStorage.getItem("access_token");
    if (!t) return nav("/login", { replace: true });

    // Optimistically remove from active list
    setTasks((prev) => prev.filter((task) => task.id !== id));

    try {
      const res = await fetch(`${API}/tasks/${id}/complete`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.status === 401) { sessionStorage.clear(); nav("/login", { replace: true }); return; }
      if (!res.ok) {
        await fetchTasks();
        return;
      }
    } catch {
      await fetchTasks();
      return;
    }

    // Open task completion survey
    setSurveyTaskId(id);
    setSurveyTaskTitle(taskTitle);
    setSurveyFeeling("");
    setSurveySatisfaction(0);
    setShowTaskSurvey(true);
  }

  async function submitTaskSurvey() {
    const t = sessionStorage.getItem("access_token");
    if (!t || !surveyTaskId) { setShowTaskSurvey(false); return; }
    setSubmittingTaskSurvey(true);
    try {
      await fetch(`${API}/feedback/task-feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({
          task_id:      surveyTaskId,
          feeling:      surveyFeeling || null,
          satisfaction: surveySatisfaction || null,
        }),
      });
    } catch {}
    setSubmittingTaskSurvey(false);
    setShowTaskSurvey(false);
  }

  async function openEODModal() {
    const t = sessionStorage.getItem("access_token");
    if (!t) return;

    // Reset state before pre-filling
    setEodStressMorning(0);
    setEodStressAfternoon(0);
    setEodStressEvening(0);
    setEodOverall(0);
    setEodNotes("");
    setEodSuccess(false);
    setShowEODModal(true);

    try {
      const res = await fetch(`${API}/feedback/daily-feedback/today`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.feedback) {
          setEodStressMorning(data.feedback.stress_morning   || 0);
          setEodStressAfternoon(data.feedback.stress_afternoon || 0);
          setEodStressEvening(data.feedback.stress_evening   || 0);
          setEodOverall(data.feedback.overall_rating         || 0);
          setEodNotes(data.feedback.notes                    || "");
        }
      }
    } catch {}
  }

  async function submitEOD(e: React.FormEvent) {
    e.preventDefault();
    const t = sessionStorage.getItem("access_token");
    if (!t) return;
    setSubmittingEOD(true);
    try {
      await fetch(`${API}/feedback/daily-feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({
          stress_morning:   eodStressMorning   || null,
          stress_afternoon: eodStressAfternoon || null,
          stress_evening:   eodStressEvening   || null,
          overall_rating:   eodOverall         || null,
          notes:            eodNotes           || null,
        }),
      });
      setEodSuccess(true);
      setTimeout(() => setShowEODModal(false), 1400);
    } catch {}
    setSubmittingEOD(false);
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

  // ── Task card actions ────────────────────────────────────────────────────────
  function TaskActions({ task }: { task: Task }) {
    return (
      <div className="task-actions">
        <button
          className="complete-btn"
          onClick={() => completeTask(task.id, task.title)}
          title="Mark as complete"
          aria-label="Mark as complete"
        >
          ✓
        </button>
        <button className="danger-btn" onClick={() => deleteTask(task.id)}>Delete</button>
      </div>
    );
  }

  return (
    <>
      <header>
        <div className="brand">📋 PlannerHub</div>
        <div className="user-info">
          <span className="header-greeting">👋 {displayName}</span>
          <button className="eod-btn" type="button" onClick={openEODModal}>
            End of Day Check-In
          </button>
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
                          <TaskActions task={t} />
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
                          <TaskActions task={t} />
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

      {/* ── Add Task Modal ──────────────────────────────────────────────────────── */}
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

      {/* ── Task Completion Survey Modal (#38) ──────────────────────────────────── */}
      {showTaskSurvey && (
        <div className="modal-overlay">
          <div className="modal survey-modal" ref={taskSurveyRef}>
            <div className="modal-header">
              <h2 className="modal-title">Task Complete 🎉</h2>
              <button className="modal-close" onClick={() => setShowTaskSurvey(false)}>✕</button>
            </div>

            <p className="survey-task-name">"{surveyTaskTitle}"</p>
            <p className="survey-subtitle">Quick check-in — how did that go?</p>

            <div className="survey-section">
              <div className="survey-label">How did that task feel?</div>
              <div className="feeling-pills">
                {(["drained", "neutral", "energized"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`feeling-pill feeling-pill-${f} ${surveyFeeling === f ? "feeling-pill-active" : ""}`}
                    onClick={() => setSurveyFeeling(surveyFeeling === f ? "" : f)}
                  >
                    {f === "drained" ? "😓" : f === "neutral" ? "😐" : "⚡"}
                    {" "}{f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="survey-section">
              <div className="survey-label">Satisfaction</div>
              <StarRating value={surveySatisfaction} onChange={setSurveySatisfaction} />
              <div className="survey-hint">
                {surveySatisfaction === 0 ? "Tap a star to rate" :
                 surveySatisfaction === 1 ? "Not satisfied" :
                 surveySatisfaction === 2 ? "Slightly satisfied" :
                 surveySatisfaction === 3 ? "Satisfied" :
                 surveySatisfaction === 4 ? "Very satisfied" : "Extremely satisfied"}
              </div>
            </div>

            <div className="modal-actions" style={{ marginTop: 8 }}>
              <button type="button" className="ghost-btn" onClick={() => setShowTaskSurvey(false)}>
                Skip
              </button>
              <button
                type="button"
                className="primary-btn"
                onClick={submitTaskSurvey}
                disabled={submittingTaskSurvey}
              >
                {submittingTaskSurvey ? "Saving…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── End of Day Survey Modal (#40) ───────────────────────────────────────── */}
      {showEODModal && (
        <div className="modal-overlay">
          <div className="modal survey-modal eod-modal" ref={eodModalRef}>
            <div className="modal-header">
              <h2 className="modal-title">End of Day Check-In</h2>
              <button className="modal-close" onClick={() => setShowEODModal(false)}>✕</button>
            </div>

            {eodSuccess ? (
              <div className="eod-success">
                <div className="eod-success-icon">✓</div>
                <div className="eod-success-text">Check-in saved! See you tomorrow.</div>
              </div>
            ) : (
              <form onSubmit={submitEOD}>
                <p className="survey-subtitle" style={{ marginBottom: 20 }}>
                  Rate your stress levels throughout the day to help adapt your schedule.
                </p>

                <div className="survey-section">
                  <div className="survey-label">Stress levels by time of day</div>
                  <div className="stress-hint-row">
                    <span className="stress-hint">1 = Very relaxed</span>
                    <span className="stress-hint">5 = Very stressed</span>
                  </div>

                  <div className="stress-period-row">
                    <span className="stress-period-label">🌅 Morning</span>
                    <StressScale value={eodStressMorning} onChange={setEodStressMorning} />
                  </div>
                  <div className="stress-period-row">
                    <span className="stress-period-label">☀️ Afternoon</span>
                    <StressScale value={eodStressAfternoon} onChange={setEodStressAfternoon} />
                  </div>
                  <div className="stress-period-row">
                    <span className="stress-period-label">🌙 Evening</span>
                    <StressScale value={eodStressEvening} onChange={setEodStressEvening} />
                  </div>
                </div>

                <div className="survey-section">
                  <div className="survey-label">Overall day rating</div>
                  <StarRating value={eodOverall} onChange={setEodOverall} />
                  <div className="survey-hint">
                    {eodOverall === 0 ? "How was your day overall?" :
                     eodOverall === 1 ? "Rough day" :
                     eodOverall === 2 ? "Below average" :
                     eodOverall === 3 ? "Average" :
                     eodOverall === 4 ? "Good day" : "Great day!"}
                  </div>
                </div>

                <div className="survey-section">
                  <div className="survey-label">Notes <span className="survey-label-optional">(optional)</span></div>
                  <textarea
                    className="input eod-notes"
                    placeholder="Anything notable about today?"
                    value={eodNotes}
                    onChange={(e) => setEodNotes(e.target.value)}
                    rows={3}
                    maxLength={500}
                  />
                </div>

                <div className="modal-actions" style={{ marginTop: 4 }}>
                  <button type="button" className="ghost-btn" onClick={() => setShowEODModal(false)}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="primary-btn"
                    disabled={submittingEOD}
                  >
                    {submittingEOD ? "Saving…" : "Save Check-In"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
