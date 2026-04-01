import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { API_BASE } from "../apiBase.ts";

type Task = {
  id: number;
  title: string;
  duration_minutes: number;
  deadline: string | null;
  importance?: number;
  completed?: boolean;
};

function importanceDot(n: number) {
  if (n >= 5) return "#ff6b6b";
  if (n === 4) return "#ffa94d";
  if (n === 3) return "#ffd43b";
  if (n === 2) return "#74c0fc";
  return "#6b7083";
}

function formatWidgetDate(d: Date) {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Second webview: `index.html?widget=1` — opened by Tauri tray / show_widget_window.
 */
export default function TauriFloatingWidget() {
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
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed"))))
      .then((data) => {
        setTasks(Array.isArray(data.tasks) ? data.tasks : []);
        setError(null);
      })
      .catch(() => setError("Could not load tasks"))
      .finally(() => setLoading(false));
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

    const u1 = listen("widget-token-updated", () => {
      if (cancelled) return;
      invoke<string | null>("get_widget_token")
        .then((t) => fetchWithToken(t))
        .catch(() => {});
    });
    const u2 = listen("tasks-updated", () => {
      if (cancelled) return;
      invoke<string | null>("get_widget_token")
        .then((t) => fetchWithToken(t))
        .catch(() => {});
    });

    return () => {
      cancelled = true;
      u1.then((fn) => fn());
      u2.then((fn) => fn());
    };
  }, [fetchWithToken]);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const todayTasks = tasks.filter((t) => !t.completed && t.deadline === todayStr);
  const noDateTasks = tasks.filter((t) => !t.completed && !t.deadline);
  const showList = todayTasks.length > 0 || noDateTasks.length > 0;

  return (
    <div className="tauri-float-widget-wrap">
      <main className="tauri-float-widget">
        <div className="tauri-float-widget-header">
          <div className="tauri-float-widget-drag" data-tauri-drag-region>
            <span className="tauri-float-widget-handle" aria-hidden>
              ⋮⋮
            </span>
            <div>
              <div className="tauri-float-widget-title">Today&apos;s plan</div>
              <div className="tauri-float-widget-date">{formatWidgetDate(today)}</div>
            </div>
          </div>
          <button
            type="button"
            className="tauri-float-widget-hide"
            onClick={() => invoke("hide_widget_window").catch(() => {})}
          >
            Hide
          </button>
        </div>
        <div className="tauri-float-widget-body">
          {loading && <div className="tauri-float-widget-status">Loading…</div>}
          {error && !loading && <div className="tauri-float-widget-status tauri-float-widget-err">{error}</div>}
          {!loading && !error && !showList && (
            <div className="tauri-float-widget-status">No tasks for today. Add tasks in the main window.</div>
          )}
          {!loading && !error && showList && (
            <div className="tauri-float-widget-list-wrap">
              {todayTasks.length > 0 && (
                <>
                  <div className="tauri-float-widget-section">Due today</div>
                  <ul className="tauri-float-widget-ul">
                    {todayTasks.map((t) => (
                      <li
                        key={t.id}
                        className="tauri-float-widget-li"
                        style={{ borderLeftColor: importanceDot(t.importance ?? 3) }}
                      >
                        <span className="tauri-float-widget-li-title">{t.title}</span>
                        <span className="tauri-float-widget-li-meta">{t.duration_minutes} min</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {noDateTasks.length > 0 && (
                <>
                  <div className="tauri-float-widget-section">No deadline</div>
                  <ul className="tauri-float-widget-ul">
                    {noDateTasks.slice(0, 8).map((t) => (
                      <li
                        key={t.id}
                        className="tauri-float-widget-li"
                        style={{ borderLeftColor: importanceDot(t.importance ?? 3) }}
                      >
                        <span className="tauri-float-widget-li-title">{t.title}</span>
                        <span className="tauri-float-widget-li-meta">{t.duration_minutes} min</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
