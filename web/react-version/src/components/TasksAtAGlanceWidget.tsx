import { useEffect } from "react";

export type GlanceTask = {
  id: number;
  title: string;
  duration_minutes: number;
  deadline: string | null;
  importance: number;
  completed: boolean;
};

function importanceLabel(n: number) {
  if (n >= 5) return "Critical";
  if (n === 4) return "High";
  if (n === 3) return "Medium";
  if (n === 2) return "Low";
  return "Very low";
}

function importanceAccent(n: number) {
  if (n >= 5) return "#ff6b6b";
  if (n === 4) return "#ffa94d";
  if (n === 3) return "#ffd43b";
  if (n === 2) return "#74c0fc";
  return "#9099b0";
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysStr(base: string, days: number): string {
  const [y, m, day] = base.split("-").map(Number);
  const d = new Date(y, m - 1, day);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Section = { key: string; label: string; emoji: string; tasks: GlanceTask[]; tone: "danger" | "accent" | "warn" | "muted" | "success" };

function buildSections(tasks: GlanceTask[]): Section[] {
  const t0 = todayStr();
  const weekEnd = addDaysStr(t0, 7);
  const open = tasks.filter((t) => !t.completed);
  const byPri = (a: GlanceTask, b: GlanceTask) => b.importance - a.importance || a.title.localeCompare(b.title);

  const overdue = open.filter((t) => t.deadline && t.deadline < t0).sort(byPri);
  const dueToday = open.filter((t) => t.deadline === t0).sort(byPri);
  const thisWeek = open
    .filter((t) => t.deadline && t.deadline > t0 && t.deadline <= weekEnd)
    .sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? "") || byPri(a, b));
  const later = open.filter((t) => t.deadline && t.deadline > weekEnd).sort(byPri);
  const anytime = open.filter((t) => !t.deadline).sort(byPri);

  const out: Section[] = [
    { key: "overdue", label: "Needs attention", emoji: "⚠️", tasks: overdue, tone: "danger" },
    { key: "today", label: "Due today", emoji: "📌", tasks: dueToday, tone: "accent" },
    { key: "week", label: "Next 7 days", emoji: "📆", tasks: thisWeek, tone: "warn" },
    { key: "later", label: "Later", emoji: "🗓️", tasks: later, tone: "muted" },
    { key: "anytime", label: "No deadline", emoji: "✨", tasks: anytime, tone: "success" },
  ];
  return out.filter((s) => s.tasks.length > 0);
}

type Props = {
  open: boolean;
  onClose: () => void;
  tasks: GlanceTask[];
  loading: boolean;
};

export default function TasksAtAGlanceWidget({ open, onClose, tasks, loading }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const openCount = tasks.filter((t) => !t.completed).length;
  const sections = buildSections(tasks);
  const totalMinutes = tasks.filter((t) => !t.completed).reduce((s, t) => s + (t.duration_minutes || 0), 0);

  return (
    <div className="tasks-glance-root" role="dialog" aria-modal="true" aria-labelledby="tasks-glance-title">
      <button type="button" className="tasks-glance-backdrop" onClick={onClose} aria-label="Close overlay" />
      <div className="tasks-glance-panel">
        <div className="tasks-glance-glow" aria-hidden />
        <header className="tasks-glance-header">
          <div>
            <h2 id="tasks-glance-title" className="tasks-glance-title">
              Tasks at a glance
            </h2>
            <p className="tasks-glance-sub">
              {loading
                ? "Loading…"
                : `${openCount} open · ~${formatDuration(Math.max(totalMinutes, 5))} planned`}
            </p>
          </div>
          <button type="button" className="tasks-glance-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="tasks-glance-body">
          {loading ? (
            <div className="tasks-glance-empty">Loading your tasks…</div>
          ) : openCount === 0 ? (
            <div className="tasks-glance-celebrate">
              <span className="tasks-glance-celebrate-icon" aria-hidden>
                ✓
              </span>
              <p className="tasks-glance-celebrate-title">You&apos;re all caught up</p>
              <p className="tasks-glance-celebrate-hint">No open tasks right now. Add one from the taskboard when you&apos;re ready.</p>
            </div>
          ) : sections.length === 0 ? (
            <div className="tasks-glance-empty">No open tasks to show.</div>
          ) : (
            sections.map((sec) => (
              <section key={sec.key} className={`tasks-glance-section tasks-glance-section--${sec.tone}`}>
                <h3 className="tasks-glance-section-label">
                  <span className="tasks-glance-section-emoji">{sec.emoji}</span>
                  {sec.label}
                  <span className="tasks-glance-section-count">{sec.tasks.length}</span>
                </h3>
                <ul className="tasks-glance-list">
                  {sec.tasks.map((t) => (
                    <li key={t.id} className="tasks-glance-row">
                      <span className="tasks-glance-pri" style={{ background: importanceAccent(t.importance) }} title={importanceLabel(t.importance)} />
                      <div className="tasks-glance-row-main">
                        <span className="tasks-glance-row-title">{t.title}</span>
                        <span className="tasks-glance-row-meta">
                          <span className="tasks-glance-pill">{formatDuration(t.duration_minutes)}</span>
                          <span className="tasks-glance-pill tasks-glance-pill--muted">{importanceLabel(t.importance)}</span>
                          {t.deadline && sec.key !== "today" && sec.key !== "overdue" && (
                            <span className="tasks-glance-pill tasks-glance-pill--date">{t.deadline}</span>
                          )}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
