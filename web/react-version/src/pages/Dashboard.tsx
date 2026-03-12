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

function importanceColor(n: number) {
  if (n >= 5) return { bg: "rgba(255,107,107,.15)", color: "#ff6b6b", border: "rgba(255,107,107,.35)" };
  if (n === 4) return { bg: "rgba(255,169,77,.15)", color: "#ffa94d", border: "rgba(255,169,77,.35)" };
  if (n === 3) return { bg: "rgba(255,212,59,.12)", color: "#ffd43b", border: "rgba(255,212,59,.3)" };
  if (n === 2) return { bg: "rgba(116,192,252,.12)", color: "#74c0fc", border: "rgba(116,192,252,.3)" };
  return { bg: "rgba(107,112,131,.12)", color: "#9099b0", border: "rgba(107,112,131,.3)" };
}

function importanceDot(n: number) { return importanceColor(n).color; }

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}
function dateStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const PRIORITY_FILTERS = [
  { label: "All", value: 0 },
  { label: "Very High", value: 5 },
  { label: "High", value: 4 },
  { label: "Medium", value: 3 },
  { label: "Low", value: 2 },
  { label: "Very Low", value: 1 },
];

type CalView = "month" | "week" | "agenda";

export default function Dashboard() {
  const nav = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);
  const [email2FAEnabled, setEmail2FAEnabled] = useState<boolean | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState<number>(30);
  const [deadline, setDeadline] = useState<string>("");
  const [importance, setImportance] = useState<number>(3);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDuration, setEditDuration] = useState<number>(30);
  const [editDeadline, setEditDeadline] = useState<string>("");
  const [editImportance, setEditImportance] = useState<number>(3);
  const [editing, setEditing] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  const editModalRef = useRef<HTMLDivElement>(null);

  const [priorityFilter, setPriorityFilter] = useState<number>(0);
  const [dragTaskId, setDragTaskId] = useState<number | null>(null);

  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [calView, setCalView] = useState<CalView>("month");
  const [weekStart, setWeekStart] = useState<Date>(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - d.getDay());
    return d;
  });

  useEffect(() => {
    const raw = sessionStorage.getItem("planner_session");
    const t = sessionStorage.getItem("access_token");
    if (!raw || !t) { nav("/login", { replace: true }); return; }
    try { setSession(JSON.parse(raw)); }
    catch { sessionStorage.clear(); nav("/login", { replace: true }); }
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
    } catch { setErr("Could not load tasks. Is the backend running on :8000?"); }
    finally { setLoading(false); }
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
    } catch { setTotpEnabled(false); setEmail2FAEnabled(false); }
  }, []);

  useEffect(() => { if (session) fetch2FAStatus(); }, [session, fetch2FAStatus]);

  useEffect(() => {
    if (!showAddModal) return;
    const handleClick = (e: MouseEvent) => { if (modalRef.current && !modalRef.current.contains(e.target as Node)) setShowAddModal(false); };
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowAddModal(false); };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("mousedown", handleClick); document.removeEventListener("keydown", handleKey); };
  }, [showAddModal]);

  useEffect(() => {
    if (!showEditModal) return;
    const handleClick = (e: MouseEvent) => { if (editModalRef.current && !editModalRef.current.contains(e.target as Node)) setShowEditModal(false); };
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowEditModal(false); };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("mousedown", handleClick); document.removeEventListener("keydown", handleKey); };
  }, [showEditModal]);

  function openEditModal(t: Task) {
    setEditTask(t); setEditTitle(t.title); setEditDuration(t.duration_minutes);
    setEditDeadline(t.deadline ?? ""); setEditImportance(t.importance);
    setEditErr(null); setShowEditModal(true);
  }

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
    } catch { setCreateErr("Failed to create task. Is the backend running?"); }
    finally { setCreating(false); }
  }

  async function saveEditTask(e: React.FormEvent) {
    e.preventDefault();
    if (!editTask) return;
    const t = sessionStorage.getItem("access_token");
    if (!t) return nav("/login", { replace: true });
    const cleanTitle = editTitle.trim();
    if (!cleanTitle) { setEditErr("Title cannot be empty."); return; }
    setEditing(true); setEditErr(null);
    try {
      const res = await fetch(`${API}/tasks/${editTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ title: cleanTitle, duration_minutes: editDuration, deadline: editDeadline || null, importance: editImportance }),
      });
      if (res.status === 401) { sessionStorage.clear(); nav("/login", { replace: true }); return; }
      if (!res.ok) { const msg = await res.text(); setEditErr(msg || "Failed to update task."); return; }
      setShowEditModal(false); setEditTask(null);
      await fetchTasks();
    } catch { setEditErr("Failed to update task. Is the backend running?"); }
    finally { setEditing(false); }
  }

  async function toggleComplete(id: number) {
    const t = sessionStorage.getItem("access_token");
    if (!t) return nav("/login", { replace: true });
    setTasks((prev) => prev.map((task) => task.id === id ? { ...task, completed: !task.completed } : task));
    try {
      const res = await fetch(`${API}/tasks/${id}/complete`, { method: "PATCH", headers: { Authorization: `Bearer ${t}` } });
      if (res.status === 401) { sessionStorage.clear(); nav("/login", { replace: true }); return; }
      if (!res.ok) await fetchTasks();
    } catch { await fetchTasks(); }
  }

  async function deleteTask(id: number) {
    const t = sessionStorage.getItem("access_token");
    if (!t) return nav("/login", { replace: true });
    const prev = tasks;
    setTasks((x) => x.filter((task) => task.id !== id));
    try {
      const res = await fetch(`${API}/tasks/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${t}` } });
      if (res.status === 401) { sessionStorage.clear(); nav("/login", { replace: true }); return; }
      if (!res.ok) { setTasks(prev); setErr("Could not delete task."); }
    } catch { setTasks(prev); setErr("Could not delete task. Is the backend running?"); }
  }

  async function rescheduleTask(id: number, newDeadline: string) {
    const t = sessionStorage.getItem("access_token");
    if (!t) return nav("/login", { replace: true });
    setTasks(prev => prev.map(task => task.id === id ? { ...task, deadline: newDeadline } : task));
    try {
      const res = await fetch(`${API}/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ deadline: newDeadline }),
      });
      if (!res.ok) await fetchTasks();
    } catch { await fetchTasks(); }
  }

  async function signOut() {
    const refreshToken = sessionStorage.getItem("refresh_token");
    if (refreshToken) {
      try {
        await fetch(`${API}/auth/logout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: refreshToken }) });
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

  const todayStr = toDateStr(today);

  const filteredTasks = priorityFilter === 0 ? tasks : tasks.filter(t => t.importance === priorityFilter);
  const overdueTasks = [...filteredTasks].filter(t => t.deadline && t.deadline < todayStr && !t.completed);
  const upcomingTasks = [...filteredTasks].filter(t => t.deadline && t.deadline >= todayStr && !t.completed).sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));
  const noDeadlineTasks = filteredTasks.filter(t => !t.deadline && !t.completed);
  const completedTasks = filteredTasks.filter(t => t.completed);

  function tasksForDateStr(ds: string): Task[] {
    return tasks.filter(t => t.deadline === ds);
  }

  // Calendar nav
  function prevMonth() {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); }
    else setCalMonth(m => m - 1);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); }
    else setCalMonth(m => m + 1);
  }
  function prevWeek() { setWeekStart(d => addDays(d, -7)); }
  function nextWeek() { setWeekStart(d => addDays(d, 7)); }

  // Week days
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEnd = addDays(weekStart, 6);

  // Agenda: next 30 days with tasks
  const agendaDays: { date: Date; dateStr: string; tasks: Task[] }[] = [];
  for (let i = 0; i < 60; i++) {
    const d = addDays(today, i);
    const ds = toDateStr(d);
    const dayTasks = tasks.filter(t => t.deadline === ds).sort((a, b) => b.importance - a.importance);
    if (dayTasks.length > 0) agendaDays.push({ date: d, dateStr: ds, tasks: dayTasks });
  }
  // Also include overdue in agenda
  const overdueAgenda = tasks.filter(t => t.deadline && t.deadline < todayStr && !t.completed).sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));

  // Month grid
  const daysInMonth = getDaysInMonth(calYear, calMonth);
  const firstDay = getFirstDayOfMonth(calYear, calMonth);
  const calDays: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) calDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calDays.push(d);

  function PriorityBadge({ n }: { n: number }) {
    const c = importanceColor(n);
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "2px 8px", borderRadius: 99, fontSize: "0.75rem", fontWeight: 600,
        background: c.bg, color: c.color, border: `1px solid ${c.border}`, whiteSpace: "nowrap",
      }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.color, display: "inline-block", flexShrink: 0 }} />
        {importanceLabel(n)}
      </span>
    );
  }

  function TaskCard({ t }: { t: Task }) {
    return (
      <article className={`task ${t.completed ? "task-completed" : ""}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
          <div className="checkbox-wrapper-26">
            <input type="checkbox" id={`cb-${t.id}`} checked={t.completed} onChange={() => toggleComplete(t.id)} />
            <label htmlFor={`cb-${t.id}`}><div className="tick_mark"></div></label>
          </div>
          <div className="task-main">
            <div className="task-title" style={{ textDecoration: t.completed ? "line-through" : "none", opacity: t.completed ? 0.5 : 1 }}>{t.title}</div>
            <div className="task-meta">
              <PriorityBadge n={t.importance} />
              <span>•</span>
              <span>{formatDuration(t.duration_minutes)}</span>
              {t.deadline && <><span>•</span><span className="deadline-badge">📅 {t.deadline}</span></>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {!t.completed && <button className="ghost-btn" style={{ fontSize: "0.8rem" }} onClick={() => openEditModal(t)}>Edit</button>}
          <button className="danger-btn" onClick={() => deleteTask(t.id)}>Delete</button>
        </div>
      </article>
    );
  }

  // ── Calendar Views ──

  function MonthView() {
    return (
      <>
        <div className="calendar-header">
          <button className="cal-nav-btn" onClick={prevMonth}>‹</button>
          <h2 className="calendar-title">{MONTH_NAMES[calMonth]} {calYear}</h2>
          <button className="cal-nav-btn" onClick={nextMonth}>›</button>
        </div>
        <div className="calendar-grid">
          {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => <div key={d} className="cal-day-name">{d}</div>)}
          {calDays.map((day, i) => {
            if (!day) return <div key={`empty-${i}`} className="cal-day cal-day-empty" />;
            const ds = dateStr(calYear, calMonth, day);
            const dayTasks = tasksForDateStr(ds);
            const isToday = ds === todayStr;
            const isOverdue = ds < todayStr && dayTasks.some(t => !t.completed);
            return (
              <div
                key={day}
                className={`cal-day ${isToday ? "cal-day-today" : ""} ${dayTasks.length > 0 ? "cal-day-has-tasks" : ""} ${isOverdue ? "cal-day-overdue" : ""}`}
                onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLDivElement).classList.add("cal-day-drag-over"); }}
                onDragLeave={e => { (e.currentTarget as HTMLDivElement).classList.remove("cal-day-drag-over"); }}
                onDrop={e => {
                  e.preventDefault();
                  (e.currentTarget as HTMLDivElement).classList.remove("cal-day-drag-over");
                  if (dragTaskId !== null) { rescheduleTask(dragTaskId, ds); setDragTaskId(null); }
                }}
              >
                <span className="cal-day-num">{day}</span>
                {dayTasks.slice(0, 2).map(t => (
                  <div
                    key={t.id}
                    className="cal-task-chip"
                    style={{ borderLeftColor: importanceDot(t.importance), opacity: t.completed ? 0.4 : 1, cursor: "grab" }}
                    draggable
                    onDragStart={() => setDragTaskId(t.id)}
                    onDragEnd={() => setDragTaskId(null)}
                  >{t.title}</div>
                ))}
                {dayTasks.length > 2 && <div className="cal-task-more">+{dayTasks.length - 2} more</div>}
              </div>
            );
          })}
        </div>
      </>
    );
  }

  function WeekView() {
    const weekLabel = `${DAY_NAMES[weekStart.getDay()]} ${MONTH_NAMES[weekStart.getMonth()].slice(0,3)} ${weekStart.getDate()} – ${DAY_NAMES[weekEnd.getDay()]} ${MONTH_NAMES[weekEnd.getMonth()].slice(0,3)} ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`;
    return (
      <>
        <div className="calendar-header">
          <button className="cal-nav-btn" onClick={prevWeek}>‹</button>
          <h2 className="calendar-title" style={{ fontSize: "0.95rem" }}>{weekLabel}</h2>
          <button className="cal-nav-btn" onClick={nextWeek}>›</button>
        </div>
        <div className="week-grid">
          {weekDays.map((d, i) => {
            const ds = toDateStr(d);
            const dayTasks = tasksForDateStr(ds);
            const isToday = ds === todayStr;
            const isOverdue = ds < todayStr && dayTasks.some(t => !t.completed);
            return (
              <div key={i} className={`week-col ${isToday ? "week-col-today" : ""} ${isOverdue ? "week-col-overdue" : ""}`}
                onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLDivElement).classList.add("cal-day-drag-over"); }}
                onDragLeave={e => { (e.currentTarget as HTMLDivElement).classList.remove("cal-day-drag-over"); }}
                onDrop={e => {
                  e.preventDefault();
                  (e.currentTarget as HTMLDivElement).classList.remove("cal-day-drag-over");
                  if (dragTaskId !== null) { rescheduleTask(dragTaskId, ds); setDragTaskId(null); }
                }}
              >
                <div className="week-col-header">
                  <span className="week-day-name">{DAY_NAMES[d.getDay()]}</span>
                  <span className={`week-day-num ${isToday ? "week-day-num-today" : ""}`}>{d.getDate()}</span>
                </div>
                <div className="week-col-tasks">
                  {dayTasks.length === 0
                    ? <div className="week-empty">—</div>
                    : dayTasks.map(t => (
                      <div key={t.id} className="week-task-chip" style={{ borderLeftColor: importanceDot(t.importance), opacity: t.completed ? 0.4 : 1, cursor: "grab" }}
                        draggable onDragStart={() => setDragTaskId(t.id)} onDragEnd={() => setDragTaskId(null)}
                      >
                        <span style={{ textDecoration: t.completed ? "line-through" : "none" }}>{t.title}</span>
                        <span className="week-task-meta">{importanceLabel(t.importance)} · {formatDuration(t.duration_minutes)}</span>
                      </div>
                    ))
                  }
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  function AgendaView() {
    return (
      <>
        <div className="calendar-header">
          <h2 className="calendar-title">Upcoming Tasks</h2>
        </div>
        <div className="agenda-list">
          {overdueAgenda.length > 0 && (
            <div className="agenda-group">
              <div className="agenda-date-label" style={{ color: "#ff6b6b" }}>⚠ Overdue</div>
              {overdueAgenda.map(t => (
                <div key={t.id} className="agenda-task" style={{ borderLeftColor: importanceDot(t.importance) }}>
                  <div className="agenda-task-title" style={{ textDecoration: t.completed ? "line-through" : "none", opacity: t.completed ? 0.5 : 1 }}>{t.title}</div>
                  <div className="agenda-task-meta">
                    <PriorityBadge n={t.importance} />
                    <span>{formatDuration(t.duration_minutes)}</span>
                    <span className="deadline-badge">📅 {t.deadline}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {agendaDays.length === 0 && overdueAgenda.length === 0 && (
            <div className="empty" style={{ marginTop: 12 }}>No upcoming tasks with deadlines.</div>
          )}
          {agendaDays.map(({ date, dateStr: ds, tasks: dayTasks }) => {
            const isToday = ds === todayStr;
            const isTomorrow = ds === toDateStr(addDays(today, 1));
            const label = isToday ? "Today" : isTomorrow ? "Tomorrow" : `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;
            return (
              <div key={ds} className="agenda-group">
                <div className={`agenda-date-label ${isToday ? "agenda-date-today" : ""}`}>{label}</div>
                {dayTasks.map(t => (
                  <div key={t.id} className="agenda-task" style={{ borderLeftColor: importanceDot(t.importance) }}>
                    <div className="agenda-task-title" style={{ textDecoration: t.completed ? "line-through" : "none", opacity: t.completed ? 0.5 : 1 }}>{t.title}</div>
                    <div className="agenda-task-meta">
                      <PriorityBadge n={t.importance} />
                      <span>{formatDuration(t.duration_minutes)}</span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </>
    );
  }

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

            <div className="priority-filter-bar">
              {PRIORITY_FILTERS.map(f => {
                const active = priorityFilter === f.value;
                const c = f.value === 0 ? null : importanceColor(f.value);
                return (
                  <button
                    key={f.value}
                    className={`priority-filter-btn${active ? " priority-filter-btn-active" : ""}`}
                    style={active && c ? { background: c.bg, color: c.color, borderColor: c.border }
                      : active ? { background: "rgba(108,99,255,.15)", color: "#6c63ff", borderColor: "rgba(108,99,255,.4)" }
                      : {}}
                    onClick={() => setPriorityFilter(f.value)}
                  >
                    {f.value !== 0 && <span style={{ width: 6, height: 6, borderRadius: "50%", background: active && c ? c.color : "var(--muted)", display: "inline-block", flexShrink: 0 }} />}
                    {f.label}
                  </button>
                );
              })}
            </div>

            {err && <div className="error">{err}</div>}

            <div className="list">
              {loading ? (
                <div className="empty">Loading tasks…</div>
              ) : filteredTasks.length === 0 ? (
                <div className="empty">
                  <div style={{ fontSize: "2rem", marginBottom: 8 }}>📋</div>
                  {priorityFilter !== 0 ? `No ${importanceLabel(priorityFilter).toLowerCase()} priority tasks.` : <>No tasks yet. Click <strong>+ Add Task</strong> to get started.</>}
                </div>
              ) : (
                <>
                  {overdueTasks.length > 0 && (<><div className="task-group-label" style={{ color: "#ff6b6b" }}>⚠ Overdue</div>{overdueTasks.map(t => <TaskCard key={t.id} t={t} />)}</>)}
                  {upcomingTasks.length > 0 && (<><div className="task-group-label" style={{ marginTop: overdueTasks.length > 0 ? 16 : 0 }}>Upcoming deadlines</div>{upcomingTasks.map(t => <TaskCard key={t.id} t={t} />)}</>)}
                  {noDeadlineTasks.length > 0 && (<><div className="task-group-label" style={{ marginTop: (overdueTasks.length > 0 || upcomingTasks.length > 0) ? 16 : 0 }}>No deadline</div>{noDeadlineTasks.map(t => <TaskCard key={t.id} t={t} />)}</>)}
                  {completedTasks.length > 0 && (<><div className="task-group-label" style={{ marginTop: 16, color: "#69db7c" }}>✓ Completed</div>{completedTasks.map(t => <TaskCard key={t.id} t={t} />)}</>)}
                </>
              )}
            </div>
          </section>

          <section className="panel calendar-panel">
            <div className="cal-view-switcher">
              {(["month","week","agenda"] as CalView[]).map(v => (
                <button key={v} className={`cal-view-btn${calView === v ? " cal-view-btn-active" : ""}`} onClick={() => setCalView(v)}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            {calView === "month" && <MonthView />}
            {calView === "week" && <WeekView />}
            {calView === "agenda" && <AgendaView />}
          </section>
        </div>
      </main>

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
                <input className="input" placeholder="What needs to be done?" value={title} onChange={e => setTitle(e.target.value)} maxLength={120} autoFocus />
              </div>
              <div className="modal-row">
                <div className="modal-field">
                  <label>Duration (min)</label>
                  <input className="input" type="number" min={5} max={600} value={duration || ""} onChange={e => setDuration(parseInt(e.target.value) || 0)} onBlur={() => { if (!duration || duration < 5) setDuration(5); }} />
                </div>
                <div className="modal-field">
                  <label>Deadline</label>
                  <input className="input" type="date" value={deadline} onChange={e => setDeadline(e.target.value)} />
                </div>
              </div>
              <div className="modal-field">
                <label>Importance</label>
                <div className="importance-picker">
                  {[1,2,3,4,5].map(n => (
                    <button key={n} type="button" className={`importance-btn ${importance === n ? "importance-btn-active" : ""}`} style={{ "--dot-color": importanceDot(n) } as React.CSSProperties} onClick={() => setImportance(n)}>{n}</button>
                  ))}
                </div>
                <div className="importance-label-text">{importanceLabel(importance)}</div>
              </div>
              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="primary-btn" disabled={creating || !title.trim()}>{creating ? "Adding…" : "Add Task"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditModal && editTask && (
        <div className="modal-overlay">
          <div className="modal" ref={editModalRef}>
            <div className="modal-header">
              <h2 className="modal-title">Edit Task</h2>
              <button className="modal-close" onClick={() => setShowEditModal(false)}>✕</button>
            </div>
            {editErr && <div className="error" style={{ marginBottom: 16 }}>{editErr}</div>}
            <form onSubmit={saveEditTask}>
              <div className="modal-field">
                <label>Task title</label>
                <input className="input" placeholder="Task title" value={editTitle} onChange={e => setEditTitle(e.target.value)} maxLength={120} autoFocus />
              </div>
              <div className="modal-row">
                <div className="modal-field">
                  <label>Duration (min)</label>
                  <input className="input" type="number" min={5} max={600} value={editDuration || ""} onChange={e => setEditDuration(parseInt(e.target.value) || 0)} onBlur={() => { if (!editDuration || editDuration < 5) setEditDuration(5); }} />
                </div>
                <div className="modal-field">
                  <label>Deadline</label>
                  <input className="input" type="date" value={editDeadline} onChange={e => setEditDeadline(e.target.value)} />
                </div>
              </div>
              <div className="modal-field">
                <label>Importance</label>
                <div className="importance-picker">
                  {[1,2,3,4,5].map(n => (
                    <button key={n} type="button" className={`importance-btn ${editImportance === n ? "importance-btn-active" : ""}`} style={{ "--dot-color": importanceDot(n) } as React.CSSProperties} onClick={() => setEditImportance(n)}>{n}</button>
                  ))}
                </div>
                <div className="importance-label-text">{importanceLabel(editImportance)}</div>
              </div>
              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setShowEditModal(false)}>Cancel</button>
                <button type="submit" className="primary-btn" disabled={editing || !editTitle.trim()}>{editing ? "Saving…" : "Save Changes"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}