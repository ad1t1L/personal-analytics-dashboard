import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hideWidgetRobust } from "./widgetInvoke";
import { listen } from "@tauri-apps/api/event";
import "./App.css";
import LoginView from "./views/LoginView";
import DashboardView from "./views/DashboardView";

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://localhost:8000";

type Task = {
  id: number;
  title: string;
  duration_minutes: number;
  deadline: string | null;
  importance?: number;
  completed?: boolean;
};

function formatWidgetDate(d: Date) {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

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

function WidgetContent() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWithToken = useCallback((token: string | null) => {
    if (!token) {
      setLoading(false);
      setError("Sign in in the main window");
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/tasks/`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load"))))
      .then((data) => {
        setTasks(Array.isArray(data.tasks) ? data.tasks : []);
        setError(null);
      })
      .catch(() => {
        setError("Could not load tasks");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;

    invoke<string | null>("get_widget_token")
      .then((token) => {
        if (!cancelled) fetchWithToken(token);
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          setError("Sign in in the main window");
        }
      });

    const unlistenToken = listen("widget-token-updated", () => {
      if (cancelled) return;
      invoke<string | null>("get_widget_token").then((t) => fetchWithToken(t)).catch(() => {});
    });
    const unlistenTasks = listen("tasks-updated", () => {
      if (cancelled) return;
      invoke<string | null>("get_widget_token").then((t) => fetchWithToken(t)).catch(() => {});
    });

    return () => {
      cancelled = true;
      unlistenToken.then((fn) => fn());
      unlistenTasks.then((fn) => fn());
    };
  }, [fetchWithToken]);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const todayTasks = tasks.filter((t) => t.deadline === todayStr);
  const noDateTasks = tasks.filter((t) => !t.deadline);
  const showList = todayTasks.length > 0 || noDateTasks.length > 0;

  return (
    <div className="widget-wrap">
      <main className="widget">
        <div className="widgetHeader">
          <div className="widgetHeaderDrag" data-tauri-drag-region>
            <span className="widgetDragHandle" aria-hidden>⋮⋮</span>
            <div className="widgetHeaderTitles">
              <span className="widgetTitle">Today&apos;s plan</span>
              <span className="widgetDate">{formatWidgetDate(today)}</span>
            </div>
          </div>
          <button
            type="button"
            className="widgetHideBtn"
            onClick={() => {
              hideWidgetRobust().catch(() => {});
            }}
            aria-label="Hide widget"
            title="Hide widget"
          >
            Hide
          </button>
        </div>

        <div className="widgetBody">
          {loading && <div className="widgetStatus">Loading…</div>}
          {error && !loading && <div className="widgetStatus widgetError">{error}</div>}
          {!loading && !error && !showList && (
            <div className="widgetStatus">No tasks for today. Open the app to add some.</div>
          )}
          {!loading && !error && showList && (
            <div className="widgetPlan">
              {todayTasks.length > 0 && (
                <>
                  <div className="widgetSectionLabel">Due today</div>
                  <ul className="widgetTaskList">
                    {todayTasks.map((t) => (
                      <li key={t.id} className="widgetTask" style={{ borderLeftColor: importanceDot(t.importance ?? 3) }}>
                        <div className="widgetTaskMain">
                          <span className="widgetTaskTitle">{t.title}</span>
                          <div className="widgetTaskMeta">
                            <span className="widgetTaskImportance" style={{ color: importanceDot(t.importance ?? 3) }}>
                              ● {importanceLabel(t.importance ?? 3)}
                            </span>
                            <span>·</span>
                            <span>{t.duration_minutes} min</span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {noDateTasks.length > 0 && (
                <>
                  <div className="widgetSectionLabel">No deadline</div>
                  <ul className="widgetTaskList">
                    {noDateTasks.slice(0, 5).map((t) => (
                      <li key={t.id} className="widgetTask" style={{ borderLeftColor: importanceDot(t.importance ?? 3) }}>
                        <div className="widgetTaskMain">
                          <span className="widgetTaskTitle">{t.title}</span>
                          <div className="widgetTaskMeta">
                            <span className="widgetTaskImportance" style={{ color: importanceDot(t.importance ?? 3) }}>
                              ● {importanceLabel(t.importance ?? 3)}
                            </span>
                            <span>·</span>
                            <span>{t.duration_minutes} min</span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {noDateTasks.length > 5 && (
                    <div className="widgetMore">+{noDateTasks.length - 5} more</div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function App() {
  const isWidget = new URLSearchParams(window.location.search).get("widget") === "1";

  if (isWidget) {
    return <WidgetContent />;
  }

  const accessToken =
    sessionStorage.getItem("access_token") || localStorage.getItem("access_token") || "";

  // Sync token to Rust so the widget window can get it (widget has separate storage).
  useEffect(() => {
    if (!accessToken) return;
    invoke("set_widget_token", { token: accessToken }).catch(() => {});
  }, [accessToken]);

  if (!accessToken) {
    return (
      <LoginView
        onAuthed={() => {
          // Simple "route": re-render will show the main app once token exists.
          window.location.reload();
        }}
      />
    );
  }

  function handleSignOut() {
    invoke("set_widget_token", { token: null }).catch(() => {});
    sessionStorage.removeItem("access_token");
    sessionStorage.removeItem("refresh_token");
    sessionStorage.removeItem("planner_session");
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("planner_session");
    window.location.reload();
  }

  return (
    <DashboardView onSignOut={handleSignOut} />
  );
}

export default App;
