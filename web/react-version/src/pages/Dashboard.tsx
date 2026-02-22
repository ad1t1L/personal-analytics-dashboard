import { useEffect, useMemo, useState } from "react";
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

  const token = useMemo(() => sessionStorage.getItem("access_token"), []);

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
        <div className="user-info">
          <span>{`👋 Welcome, ${session.email ?? "User"}`}</span>
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
        </section>
      </main>
    </>
  );
}
