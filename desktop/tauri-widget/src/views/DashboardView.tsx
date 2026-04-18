import { useCallback, useEffect, useRef, useState } from "react";
import { hideWidgetRobust, showWidgetRobust } from "../widgetInvoke";
import { emit } from "@tauri-apps/api/event";

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://localhost:8000";

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

type ScheduledItem = {
  task_id: number;
  title: string;
  start_time: string;   // "HH:MM"
  end_time: string;     // "HH:MM"
  energy_level: string;
  task_type: string;
  time_of_day: string;
  times_rescheduled: number;
};

type ScheduleResult = {
  date: string;
  scheduled: ScheduledItem[];
  overflow: ScheduledItem[];
  summary: {
    total_tasks: number;
    scheduled_count: number;
    overflow_count: number;
    total_hours: number;
  };
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

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type Props = {
  onSignOut: () => void;
};

export default function DashboardView({ onSignOut }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [schedule, setSchedule] = useState<ScheduleResult | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);

  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);
  const [email2FAEnabled, setEmail2FAEnabled] = useState<boolean | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(30);
  const [deadline, setDeadline] = useState("");
  const [importance, setImportance] = useState(3);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());

  useEffect(() => {
    const raw = sessionStorage.getItem("planner_session");
    const t = sessionStorage.getItem("access_token");
    if (!raw || !t) {
      onSignOut();
      return;
    }
    try {
      setSession(JSON.parse(raw));
    } catch {
      onSignOut();
    }
  }, [onSignOut]);

  const fetchTasks = useCallback(async () => {
    const t = sessionStorage.getItem("access_token");
    if (!t) {
      onSignOut();
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/tasks/`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.status === 401) {
        onSignOut();
        return;
      }
      const data = await res.json();
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      emit("tasks-updated").catch(() => {});
    } catch {
      setErr("Could not load tasks. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }, [onSignOut]);

  const fetchSchedule = useCallback(async () => {
    const t = sessionStorage.getItem("access_token");
    if (!t) return;
    setScheduleLoading(true);
    try {
      const res = await fetch(`${API_BASE}/schedules/today`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) {
        const data: ScheduleResult = await res.json();
        setSchedule(data);
      }
    } catch {
      // schedule is non-critical, fail silently
    } finally {
      setScheduleLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) {
      fetchTasks();
      fetchSchedule();
    }
  }, [session, fetchTasks, fetchSchedule]);

  const fetch2FAStatus = useCallback(async () => {
    const token = sessionStorage.getItem("access_token");
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/auth/2fa/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
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

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    const t = sessionStorage.getItem("access_token");
    if (!t) return onSignOut();
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    setCreating(true);
    setCreateErr(null);
    try {
      const res = await fetch(`${API_BASE}/tasks/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${t}`,
        },
        body: JSON.stringify({
          title: cleanTitle,
          duration_minutes: duration,
          deadline: deadline || null,
          importance,
        }),
      });
      if (res.status === 401) {
        onSignOut();
        return;
      }
      if (!res.ok) {
        const msg = await res.text();
        setCreateErr(msg || "Failed to create task.");
        return;
      }
      setTitle("");
      setDuration(30);
      setDeadline("");
      setImportance(3);
      setShowAddModal(false);
      await fetchTasks();
      await fetchSchedule();
      emit("tasks-updated").catch(() => {});
    } catch {
      setCreateErr("Failed to create task. Is the backend running?");
    } finally {
      setCreating(false);
    }
  }

  async function deleteTask(id: number) {
    const t = sessionStorage.getItem("access_token");
    if (!t) return onSignOut();
    const prev = tasks;
    setTasks((x) => x.filter((task) => task.id !== id));
    try {
      const res = await fetch(`${API_BASE}/tasks/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.status === 401) {
        onSignOut();
        return;
      }
      if (!res.ok) {
        setTasks(prev);
        setErr("Could not delete task.");
      } else {
        fetchSchedule();
        emit("tasks-updated").catch(() => {});
      }
    } catch {
      setTasks(prev);
      setErr("Could not delete task. Is the backend running?");
    }
  }

  async function signOut() {
    const refreshToken = sessionStorage.getItem("refresh_token");
    if (refreshToken) {
      try {
        await fetch(`${API_BASE}/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
      } catch {}
    }
    sessionStorage.clear();
    localStorage.clear();
    onSignOut();
  }

  if (!session) return null;

  const displayName = session.email?.split("@")[0] || "User";
  const show2FABanner =
    !bannerDismissed && totpEnabled === false && email2FAEnabled === false;

  const daysInMonth = getDaysInMonth(calYear, calMonth);
  const firstDay = getFirstDayOfMonth(calYear, calMonth);
  const calDays: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) calDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calDays.push(d);

  function tasksForDay(day: number): Task[] {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    // Tasks explicitly due on this date
    const byDeadline = tasks.filter((t) => t.deadline === dateStr);
    // For today: also include flexible tasks the ML scheduled (no deadline, placed by scheduler)
    const isToday =
      calYear === today.getFullYear() &&
      calMonth === today.getMonth() &&
      day === today.getDate();
    if (isToday && schedule) {
      const scheduledIds = new Set(schedule.scheduled.map((s) => s.task_id));
      const scheduledFlexible = tasks.filter(
        (t) => !t.deadline && scheduledIds.has(t.id)
      );
      // Merge, deduplicate by id
      const merged = [...byDeadline];
      for (const t of scheduledFlexible) {
        if (!merged.find((x: Task) => x.id === t.id)) merged.push(t);
      }
      return merged;
    }
    return byDeadline;
  }

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const upcomingTasks = [...tasks]
    .filter((t) => t.deadline && t.deadline >= todayStr)
    .sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));
  const noDeadlineTasks = tasks.filter((t) => !t.deadline);

  return (
    <div className="dashboard-wrap">
      <header className="dash-header">
        <div className="brand">Personal Analytics</div>
        <div className="user-info">
          <span className="header-greeting">{displayName}</span>
          <button
            className="widget-launch-btn widget-launch-btn--compact"
            type="button"
            onClick={() => {
              showWidgetRobust().catch(() => {});
            }}
            title="Open the floating task widget (also in sidebar & tray)"
          >
            📌 Task widget
          </button>
          <button
            className="ghost-btn"
            type="button"
            onClick={() => {
              hideWidgetRobust().catch(() => {});
            }}
          >
            Hide widget
          </button>
          <button className="signout-btn" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      {show2FABanner && (
        <div className="twofa-banner">
          <div className="twofa-banner-content">
            <span className="twofa-banner-icon">🔐</span>
            <div>
              <strong>Secure your account</strong>
              <span className="twofa-banner-text">
                {" "}
                — Two-factor authentication is not enabled. Enable it in the web app Account settings.
              </span>
            </div>
          </div>
          <button
            className="twofa-banner-dismiss"
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <main className="dash">
        <aside className="sidebar">
          <div className="side-title">Dashboard</div>
          <button className="side-pill" type="button">
            Taskboard
          </button>
          <button
            className="widget-launch-btn widget-launch-btn--sidebar"
            type="button"
            onClick={() => {
              showWidgetRobust().catch(() => {});
            }}
            title="Opens the small floating window with today’s tasks"
          >
            📌 Open task widget
          </button>
          <button className="side-link side-link-danger" type="button" onClick={signOut}>
            Sign out
          </button>
        </aside>

        <div className="dash-content">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h1 className="panel-title">My Tasks</h1>
                <p className="panel-sub">
                  {tasks.length} task{tasks.length !== 1 ? "s" : ""} total
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  className="widget-launch-btn widget-launch-btn--inline"
                  type="button"
                  onClick={() => {
                    showWidgetRobust().catch(() => {});
                  }}
                  title="Floating task list (stays on top)"
                >
                  📌 Widget
                </button>
                <button className="ghost-btn" type="button" onClick={fetchTasks}>
                  ↻ Refresh
                </button>
                <button
                  className="primary-btn"
                  type="button"
                  onClick={() => setShowAddModal(true)}
                >
                  + Add Task
                </button>
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
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                }}
                              >
                                <span
                                  style={{
                                    width: 7,
                                    height: 7,
                                    borderRadius: "50%",
                                    background: importanceDot(t.importance),
                                    display: "inline-block",
                                  }}
                                />
                                {importanceLabel(t.importance)}
                              </span>
                              <span>•</span>
                              <span>{t.duration_minutes} min</span>
                              <span>•</span>
                              <span className="deadline-badge">📅 {t.deadline}</span>
                            </div>
                          </div>
                          <button
                            className="danger-btn"
                            onClick={() => deleteTask(t.id)}
                          >
                            Delete
                          </button>
                        </article>
                      ))}
                    </>
                  )}
                  {noDeadlineTasks.length > 0 && (
                    <>
                      <div
                        className="task-group-label"
                        style={{
                          marginTop: upcomingTasks.length > 0 ? 16 : 0,
                        }}
                      >
                        No deadline
                      </div>
                      {noDeadlineTasks.map((t) => (
                        <article className="task" key={t.id}>
                          <div className="task-main">
                            <div className="task-title">{t.title}</div>
                            <div className="task-meta">
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                }}
                              >
                                <span
                                  style={{
                                    width: 7,
                                    height: 7,
                                    borderRadius: "50%",
                                    background: importanceDot(t.importance),
                                    display: "inline-block",
                                  }}
                                />
                                {importanceLabel(t.importance)}
                              </span>
                              <span>•</span>
                              <span>{t.duration_minutes} min</span>
                            </div>
                          </div>
                          <button
                            className="danger-btn"
                            onClick={() => deleteTask(t.id)}
                          >
                            Delete
                          </button>
                        </article>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          </section>

          <section className="panel schedule-panel">
            <div className="panel-head">
              <div>
                <h1 className="panel-title">Today's Schedule</h1>
                <p className="panel-sub">
                  {schedule
                    ? `${schedule.summary.scheduled_count} tasks scheduled · ${schedule.summary.total_hours}h planned`
                    : "Generating your ML schedule…"}
                </p>
              </div>
              <button className="ghost-btn" type="button" onClick={fetchSchedule}>
                ↻ Refresh
              </button>
            </div>

            {scheduleLoading && <div className="empty">Building schedule…</div>}

            {!scheduleLoading && schedule && schedule.scheduled.length === 0 && (
              <div className="empty">No tasks scheduled for today. Add some tasks to get started.</div>
            )}

            {!scheduleLoading && schedule && schedule.scheduled.length > 0 && (
              <div className="schedule-timeline">
                {schedule.scheduled.map((item) => {
                  const task = tasks.find((t) => t.id === item.task_id);
                  const imp = task?.importance ?? 3;
                  return (
                    <div key={item.task_id} className="schedule-block">
                      <div className="schedule-time">
                        <span className="schedule-start">{item.start_time}</span>
                        <span className="schedule-end">{item.end_time}</span>
                      </div>
                      <div
                        className="schedule-bar"
                        style={{ borderLeftColor: importanceDot(imp) }}
                      >
                        <div className="schedule-task-title">{item.title}</div>
                        <div className="schedule-task-meta">
                          <span
                            className="schedule-dot"
                            style={{ background: importanceDot(imp) }}
                          />
                          {importanceLabel(imp)}
                          <span className="schedule-sep">·</span>
                          {item.energy_level} energy
                          <span className="schedule-sep">·</span>
                          {item.time_of_day}
                          {item.task_type === "flexible" && (
                            <span className="schedule-ml-badge">ML placed</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {schedule.overflow.length > 0 && (
                  <div className="schedule-overflow">
                    <div className="schedule-overflow-label">
                      Didn't fit today ({schedule.overflow.length})
                    </div>
                    {schedule.overflow.map((item) => (
                      <div key={item.task_id} className="schedule-overflow-item">
                        {item.title}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="panel calendar-panel">
            <div className="calendar-header">
              <button
                className="cal-nav-btn"
                onClick={() =>
                  calMonth === 0
                    ? (setCalYear((y) => y - 1), setCalMonth(11))
                    : setCalMonth((m) => m - 1)
                }
              >
                ‹
              </button>
              <h2 className="calendar-title">
                {MONTH_NAMES[calMonth]} {calYear}
              </h2>
              <button
                className="cal-nav-btn"
                onClick={() =>
                  calMonth === 11
                    ? (setCalYear((y) => y + 1), setCalMonth(0))
                    : setCalMonth((m) => m + 1)
                }
              >
                ›
              </button>
            </div>

            <div className="calendar-grid">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                <div key={d} className="cal-day-name">
                  {d}
                </div>
              ))}
              {calDays.map((day, i) => {
                if (!day)
                  return (
                    <div
                      key={`empty-${i}`}
                      className="cal-day cal-day-empty"
                    />
                  );
                const dayTasks = tasksForDay(day);
                const isToday =
                  day === today.getDate() &&
                  calMonth === today.getMonth() &&
                  calYear === today.getFullYear();
                return (
                  <div
                    key={day}
                    className={`cal-day ${isToday ? "cal-day-today" : ""} ${dayTasks.length > 0 ? "cal-day-has-tasks" : ""}`}
                  >
                    <span className="cal-day-num">{day}</span>
                    {dayTasks.slice(0, 2).map((t) => (
                      <div
                        key={t.id}
                        className="cal-task-chip"
                        style={{
                          borderLeftColor: importanceDot(t.importance),
                        }}
                      >
                        {t.title}
                      </div>
                    ))}
                    {dayTasks.length > 2 && (
                      <div className="cal-task-more">
                        +{dayTasks.length - 2} more
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </main>

      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal" ref={modalRef}>
            <div className="modal-header">
              <h2 className="modal-title">Add New Task</h2>
              <button
                className="modal-close"
                onClick={() => setShowAddModal(false)}
              >
                ✕
              </button>
            </div>

            {createErr && (
              <div className="error" style={{ marginBottom: 16 }}>
                {createErr}
              </div>
            )}

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
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`importance-btn ${importance === n ? "importance-btn-active" : ""}`}
                      style={
                        { "--dot-color": importanceDot(n) } as React.CSSProperties
                      }
                      onClick={() => setImportance(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <div className="importance-label-text">
                  {importanceLabel(importance)}
                </div>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-btn"
                  disabled={creating || !title.trim()}
                >
                  {creating ? "Adding…" : "Add Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
