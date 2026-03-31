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
  task_type: string | null;
  fixed_start: string | null;
  fixed_end: string | null;
  location: string | null;
  energy_level: string | null;
  preferred_time: string | null;
  recurrence: string | null;
  recurrence_days: string | null;
};

function importanceLabel(n: number) {
  if (n >= 5) return "Critical";
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

function getDaysInMonth(year: number, month: number) { return new Date(year, month + 1, 0).getDate(); }
function getFirstDayOfMonth(year: number, month: number) { return new Date(year, month, 1).getDay(); }
function calDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function addDays(date: Date, days: number): Date { const d = new Date(date); d.setDate(d.getDate() + days); return d; }
function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function formatDateLabel(ds: string) {
  const [y, m, d] = ds.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function calcDuration(start: string, end: string): number | null {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const computed = (eh * 60 + em) - (sh * 60 + sm);
  return computed > 0 ? computed : null;
}

// Converts raw backend error responses into friendly user-facing messages
function friendlyError(raw: string, fallback: string): string {
  try {
    const data = JSON.parse(raw);
    const detail = data?.detail;
    if (typeof detail === "string") {
      if (detail.includes("fixed_start") || detail.includes("fixed_end")) return "Please fill in both a start time and end time.";
      if (detail.includes("recurrence_days")) return "Please select at least one day for weekly recurrence.";
      if (detail.includes("title")) return "Task name cannot be empty.";
      if (detail.includes("task_type")) return "Please select a valid task type.";
      if (detail.includes("energy_level")) return "Please select a valid energy level.";
      if (detail.includes("importance")) return "Importance must be between 1 and 5.";
      return detail;
    }
  } catch {}
  return fallback;
}

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const HOURS = Array.from({ length: 17 }, (_, i) => i + 6);

const PRIORITY_FILTERS = [
  { label: "All", value: 0 }, { label: "Critical", value: 5 }, { label: "High", value: 4 },
  { label: "Medium", value: 3 }, { label: "Low", value: 2 }, { label: "Very Low", value: 1 },
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

type CalView = "month" | "week" | "agenda";
const TASK_TYPES = [
  { value: "set_time", label: "Set time",  desc: "Appointment, class, meeting — specific start time" },
  { value: "due_by",   label: "Due by",    desc: "Homework, errand — flexible when, needs done by a date" },
  { value: "flexible", label: "Flexible",  desc: "No deadline — do it whenever" },
];

const ENERGY_OPTIONS = [
  { value: "light",    label: "Light",    desc: "Walking, watching a show" },
  { value: "moderate", label: "Moderate", desc: "Cooking, shopping" },
  { value: "intense",  label: "Intense",  desc: "Studying, exercise, deep work" },
];

const PREF_TIME_OPTIONS = [
  { value: "morning", label: "Morning" }, { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" }, { value: "none", label: "No preference" },
];

const RECURRENCE_OPTIONS = [
  { value: "once", label: "One time" }, { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" },
];

const WEEKDAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function blankForm(prefillDate?: string, prefillHour?: number) {
  return {
    title: "",
    task_type: prefillHour !== undefined ? "set_time" : "" as string,
    fixed_start: prefillHour !== undefined ? `${String(prefillHour).padStart(2,"0")}:00` : "",
    fixed_end: prefillHour !== undefined ? `${String(Math.min(prefillHour+1,23)).padStart(2,"0")}:00` : "",
    location: "",
    deadline: prefillDate ?? "",
    duration_minutes: prefillHour !== undefined ? 60 : 30,
    importance: 3,
    energy_level: "moderate",
    preferred_time: "none",
    recurrence: "once",
    recurrence_days: [] as number[],
  };
}

type TaskForm = ReturnType<typeof blankForm>;

// ── TaskFormFields — module-level to prevent focus loss on re-render ─────────

interface TaskFormFieldsProps {
  f: TaskForm;
  setF: (f: TaskForm) => void;
  err: string | null;
  showOpt: boolean; setShowOpt: (v: boolean) => void;
  showRec: boolean; setShowRec: (v: boolean) => void;
}

function TaskFormFields({ f, setF, err: formErr, showOpt, setShowOpt, showRec, setShowRec }: TaskFormFieldsProps) {
  function upd(patch: Partial<TaskForm>) { setF({ ...f, ...patch }); }
  function toggleDay(d: number) {
    const days = f.recurrence_days.includes(d) ? f.recurrence_days.filter(x => x !== d) : [...f.recurrence_days, d];
    upd({ recurrence_days: days });
  }

  // For set_time tasks: auto-calculate duration when start or end changes
  const isSetTime = f.task_type === "set_time";
  const durationAutoFilled = isSetTime && !!(f.fixed_start && f.fixed_end);

  function handleStartChange(newStart: string) {
    const patch: Partial<TaskForm> = { fixed_start: newStart };
    if (newStart && f.fixed_end) {
      const computed = calcDuration(newStart, f.fixed_end);
      if (computed) patch.duration_minutes = computed;
    }
    upd(patch);
  }

  function handleEndChange(newEnd: string) {
    const patch: Partial<TaskForm> = { fixed_end: newEnd };
    if (f.fixed_start && newEnd) {
      const computed = calcDuration(f.fixed_start, newEnd);
      if (computed) patch.duration_minutes = computed;
    }
    upd(patch);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {formErr && <div className="error">{formErr}</div>}
      <div className="modal-field">
        <label>Task name</label>
        <input className="input" placeholder="What needs to be done?" value={f.title} onChange={e => upd({ title: e.target.value })} maxLength={120} autoFocus />
      </div>
      <div className="modal-field">
        <label>Task type <span style={{ color: "var(--error)" }}>*</span></label>
        <div className="type-picker">
          {TASK_TYPES.map(tt => (
            <button key={tt.value} type="button" className={`type-btn ${f.task_type === tt.value ? "type-btn-active" : ""}`} onClick={() => upd({ task_type: tt.value })}>
              <span className="type-btn-label">{tt.label}</span>
              <span className="type-btn-desc">{tt.desc}</span>
            </button>
          ))}
        </div>
      </div>
      {f.task_type === "set_time" && (
        <div style={{ padding: 14, background: "rgba(108,99,255,.06)", borderRadius: 10, border: "1px solid rgba(108,99,255,.2)", display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="modal-field">
            <label>Date</label>
            <input className="input" type="date" value={f.deadline} onChange={e => upd({ deadline: e.target.value })} />
          </div>
          <div className="modal-row">
            <div className="modal-field">
              <label>Start time</label>
              <input className="input" type="time" value={f.fixed_start} onChange={e => handleStartChange(e.target.value)} />
            </div>
            <div className="modal-field">
              <label>End time</label>
              <input className="input" type="time" value={f.fixed_end} onChange={e => handleEndChange(e.target.value)} />
            </div>
          </div>
          <div className="modal-field">
            <label>Location <span style={{ color: "var(--muted)", fontWeight: 400 }}>(optional)</span></label>
            <input className="input" placeholder="e.g. Library, Zoom, Room 204" value={f.location} onChange={e => upd({ location: e.target.value })} />
          </div>
        </div>
      )}
      {f.task_type === "due_by" && (
        <div style={{ padding: 14, background: "rgba(255,169,77,.06)", borderRadius: 10, border: "1px solid rgba(255,169,77,.2)", display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="modal-field">
            <label>Deadline date</label>
            <input className="input" type="date" value={f.deadline} onChange={e => upd({ deadline: e.target.value })} />
          </div>
          <div className="modal-field">
            <label>Due by time <span style={{ color: "var(--muted)", fontWeight: 400 }}>(optional)</span></label>
            <input className="input" type="time" value={f.fixed_end} onChange={e => upd({ fixed_end: e.target.value })} />
          </div>
        </div>
      )}
      {f.task_type && (
        <>
          <div className="modal-row">
            <div className="modal-field">
              <label>
                Duration (minutes)
                {durationAutoFilled && (
                  <span style={{ fontSize: "0.7rem", color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}>auto-filled</span>
                )}
              </label>
              <input
                className="input"
                type="number"
                min={5}
                max={600}
                value={f.duration_minutes || ""}
                readOnly={durationAutoFilled}
                style={durationAutoFilled ? { opacity: 0.55, cursor: "not-allowed" } : {}}
                onChange={e => upd({ duration_minutes: parseInt(e.target.value) || 0 })}
                onBlur={() => { if (!durationAutoFilled && (!f.duration_minutes || f.duration_minutes < 5)) upd({ duration_minutes: 5 }); }}
              />
              {f.duration_minutes >= 60 && <div style={{ fontSize: "0.75rem", color: "var(--accent2)", marginTop: 4 }}>{formatDuration(f.duration_minutes)}</div>}
            </div>
            <div className="modal-field">
              <label>Importance</label>
              <div className="importance-picker" style={{ marginTop: 4 }}>
                {[1,2,3,4,5].map(n => (
                  <button key={n} type="button" className={`importance-btn ${f.importance === n ? "importance-btn-active" : ""}`} style={{ "--dot-color": importanceDot(n) } as React.CSSProperties} onClick={() => upd({ importance: n })}>{n}</button>
                ))}
              </div>
              <div className="importance-label-text">{importanceLabel(f.importance)}</div>
            </div>
          </div>
          <div className="collapsible-section">
            <button type="button" className="collapsible-toggle" onClick={() => setShowOpt(!showOpt)}>
              <span>Optional preferences</span>
              <span style={{ fontSize: "0.72rem", color: "var(--muted)", marginLeft: 8 }}>we'll learn these over time</span>
              <span className="collapsible-arrow">{showOpt ? "▲" : "▼"}</span>
            </button>
            {showOpt && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 12 }}>
                <div className="modal-field">
                  <label>Energy required <span style={{ color: "var(--muted)", fontWeight: 400 }}>(optional)</span></label>
                  <div className="pill-group">
                    {ENERGY_OPTIONS.map(e => (
                      <button key={e.value} type="button" className={`pill-btn ${f.energy_level === e.value ? "pill-btn-active" : ""}`} onClick={() => upd({ energy_level: e.value })}>
                        <span>{e.label}</span><span className="pill-btn-sub">{e.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="modal-field">
                  <label>Preferred time of day <span style={{ color: "var(--muted)", fontWeight: 400 }}>(optional)</span></label>
                  <div className="pill-group pill-group-row">
                    {PREF_TIME_OPTIONS.map(p => (
                      <button key={p.value} type="button" className={`pill-btn-sm ${f.preferred_time === p.value ? "pill-btn-sm-active" : ""}`} onClick={() => upd({ preferred_time: p.value })}>{p.label}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="collapsible-section">
            <button type="button" className="collapsible-toggle" onClick={() => setShowRec(!showRec)}>
              <span>Recurrence</span>
              <span style={{ fontSize: "0.72rem", color: "var(--muted)", marginLeft: 8 }}>one time by default</span>
              <span className="collapsible-arrow">{showRec ? "▲" : "▼"}</span>
            </button>
            {showRec && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
                <div className="pill-group pill-group-row">
                  {RECURRENCE_OPTIONS.map(r => (
                    <button key={r.value} type="button" className={`pill-btn-sm ${f.recurrence === r.value ? "pill-btn-sm-active" : ""}`} onClick={() => upd({ recurrence: r.value })}>{r.label}</button>
                  ))}
                </div>
                {f.recurrence === "weekly" && (
                  <div className="modal-field">
                    <label>Which days</label>
                    <div className="day-picker">
                      {WEEKDAY_LABELS.map((dl, i) => (
                        <button key={i} type="button" className={`day-btn ${f.recurrence_days.includes(i) ? "day-btn-active" : ""}`} onClick={() => toggleDay(i)}>{dl}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

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
  const [form, setForm] = useState<TaskForm>(blankForm());
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [showOptional, setShowOptional] = useState(false);
  const [showRecurrence, setShowRecurrence] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  const [showTaskSurvey, setShowTaskSurvey] = useState(false);
  const [surveyTaskId, setSurveyTaskId] = useState<number | null>(null);
  const [surveyTaskTitle, setSurveyTaskTitle] = useState("");
  const [surveyFeeling, setSurveyFeeling] = useState<string>("");
  const [surveySatisfaction, setSurveySatisfaction] = useState<number>(0);
  const [submittingTaskSurvey, setSubmittingTaskSurvey] = useState(false);
  const taskSurveyRef = useRef<HTMLDivElement>(null);

  const [showEODModal, setShowEODModal] = useState(false);
  const [eodStressMorning, setEodStressMorning] = useState<number>(0);
  const [eodStressAfternoon, setEodStressAfternoon] = useState<number>(0);
  const [eodStressEvening, setEodStressEvening] = useState<number>(0);
  const [eodBoredomMorning, setEodBoredomMorning] = useState<number>(0);
  const [eodBoredomAfternoon, setEodBoredomAfternoon] = useState<number>(0);
  const [eodBoredomEvening, setEodBoredomEvening] = useState<number>(0);
  const [eodOverall, setEodOverall] = useState<number>(0);
  const [eodNotes, setEodNotes] = useState("");
  const [submittingEOD, setSubmittingEOD] = useState(false);
  const [eodSuccess, setEodSuccess] = useState(false);

  // ── Schedule state ────────────────────────────────────────────────────────
  type ScheduledItem = {
    task_id: number; title: string; start_time: string; end_time: string;
    time_of_day: string; energy_level: string; task_type: string;
  };
  type ScheduleData = {
    date: string;
    scheduled: ScheduledItem[];
    overflow: { task_id: number; title: string; energy_level: string }[];
    summary: { total_tasks: number; scheduled_count: number; overflow_count: number; total_hours: number };
  };
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const eodModalRef = useRef<HTMLDivElement>(null);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editTaskId, setEditTaskId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<TaskForm>(blankForm());
  const [editing, setEditing] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [showEditOptional, setShowEditOptional] = useState(false);
  const [showEditRecurrence, setShowEditRecurrence] = useState(false);
  const editModalRef = useRef<HTMLDivElement>(null);

  const [priorityFilter, setPriorityFilter] = useState<number>(0);
  const [dragTaskId, setDragTaskId] = useState<number | null>(null);
  const [dayPopup, setDayPopup] = useState<string | null>(null);
  const dayPopupRef = useRef<HTMLDivElement>(null);
  const [dayPopupSchedule, setDayPopupSchedule] = useState<ScheduleData | null>(null);

  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [calView, setCalView] = useState<CalView>("month");
  const [weekStart, setWeekStart] = useState<Date>(() => {
    const d = new Date(today); d.setDate(d.getDate() - d.getDay()); return d;
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

  async function fetchSchedule() {
    const t = sessionStorage.getItem("access_token");
    if (!t) return;
    setScheduleLoading(true);
    try {
      const res = await fetch(`${API}/schedules/today`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.ok) setSchedule(await res.json());
    } catch {}
    finally { setScheduleLoading(false); }
  }

  useEffect(() => { if (session) { fetchTasks(); fetchSchedule(); } }, [session]);

  const fetch2FAStatus = useCallback(async () => {
    const token = sessionStorage.getItem("access_token");
    if (!token) return;
    try {
      const res = await fetch(`${API}/auth/2fa/status`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) { const data = await res.json(); setTotpEnabled(!!data.totp_enabled); setEmail2FAEnabled(!!data.email_2fa_enabled); }
    } catch { setTotpEnabled(false); setEmail2FAEnabled(false); }
  }, []);

  useEffect(() => { if (session) fetch2FAStatus(); }, [session, fetch2FAStatus]);

  function useModalDismiss(show: boolean, ref: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
    useEffect(() => {
      if (!show) return;
      const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
      const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
      document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
      return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
    }, [show]);
  }

  useModalDismiss(showAddModal, modalRef, () => setShowAddModal(false));
  useModalDismiss(showEditModal, editModalRef, () => setShowEditModal(false));
  useModalDismiss(!!dayPopup, dayPopupRef, () => setDayPopup(null));

  useEffect(() => {
    if (!dayPopup) { setDayPopupSchedule(null); return; }
    const t = sessionStorage.getItem("access_token");
    if (!t) return;
    fetch(`${API}/schedules/date/${dayPopup}`, { headers: { Authorization: `Bearer ${t}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => setDayPopupSchedule(data ?? null))
      .catch(() => setDayPopupSchedule(null));
  }, [dayPopup]);

  function openAddModal(prefillDate?: string, prefillHour?: number) {
    setForm(blankForm(prefillDate, prefillHour));
    setCreateErr(null); setShowOptional(false); setShowRecurrence(false);
    setShowAddModal(true);
  }

  function openEditModal(t: Task) {
    setEditTaskId(t.id);
    const reverseEnergyMap: Record<string, string> = { "low": "light", "medium": "moderate", "high": "intense" };
    const reverseTypeMap:   Record<string, string> = { "fixed": "set_time", "semi": "due_by", "flexible": "flexible" };
    const reverseRecurMap:  Record<string, string> = { "none": "once", "daily": "daily", "weekly": "weekly" };

    setEditForm({
      title: t.title, task_type: reverseTypeMap[t.task_type ?? "flexible"] ?? t.task_type ?? "flexible",
      fixed_start: t.fixed_start ?? "", fixed_end: t.fixed_end ?? "",
      location: t.location ?? "", deadline: t.deadline ?? "",
      duration_minutes: t.duration_minutes, importance: t.importance,
      energy_level: reverseEnergyMap[t.energy_level ?? "medium"] ?? t.energy_level ?? "moderate",
      preferred_time: t.preferred_time ?? "none",
      recurrence: reverseRecurMap[t.recurrence ?? "none"] ?? t.recurrence ?? "once",
      recurrence_days: t.recurrence_days ? t.recurrence_days.split(",").map(Number) : [],
    });
    setEditErr(null); setShowEditOptional(false); setShowEditRecurrence(false);
    setShowEditModal(true);
  }

  function formToPayload(f: TaskForm) {
    const energyMap: Record<string, string> = { "light": "low", "moderate": "medium", "intense": "high" };
    const taskTypeMap: Record<string, string> = { "set_time": "fixed", "due_by": "semi", "flexible": "flexible" };
    const recurrenceMap: Record<string, string> = { "once": "none", "daily": "daily", "weekly": "weekly" };

    return {
      title: f.title.trim(),
      duration_minutes: f.duration_minutes || 30,
      deadline: (f.task_type === "due_by" || f.task_type === "set_time") ? (f.deadline || null) : null,
      importance: f.importance,
      task_type:    taskTypeMap[f.task_type]    ?? f.task_type,
      fixed_start: f.task_type === "set_time" ? (f.fixed_start || null) : null,
      fixed_end: (f.task_type === "set_time" || f.task_type === "due_by") ? (f.fixed_end || null) : null,
      location: f.task_type === "set_time" ? (f.location || null) : null,
      energy_level: energyMap[f.energy_level]  ?? f.energy_level,
      preferred_time: f.preferred_time || "none",
      recurrence:   recurrenceMap[f.recurrence] ?? f.recurrence,
      recurrence_days: f.recurrence === "weekly" && f.recurrence_days.length > 0 ? f.recurrence_days.join(",") : null,
    };
  }

  function getRecurrenceDates(f: TaskForm): string[] {
    const baseDate = f.deadline || toDateStr(today);
    const [y, mo, d] = baseDate.split("-").map(Number);
    const start = new Date(y, mo - 1, d);

    if (f.recurrence === "once" || !f.recurrence) return [baseDate];

    if (f.recurrence === "daily") {
      return Array.from({ length: 30 }, (_, i) => toDateStr(addDays(start, i)));
    }

    if (f.recurrence === "weekly") {
      if (f.recurrence_days.length === 0) return [];
      const jsWeekdays = f.recurrence_days.map(d => d === 6 ? 0 : d + 1);
      const dates: string[] = [];
      for (let i = 0; i < 30; i++) {
        const date = addDays(start, i);
        if (jsWeekdays.includes(date.getDay())) dates.push(toDateStr(date));
      }
      return dates;
    }

    return [baseDate];
  }

  // Close Task Survey modal on outside click / Escape
  useEffect(() => {
    if (!showTaskSurvey) return;
    function handleClick(e: MouseEvent) {
      if (taskSurveyRef.current && !taskSurveyRef.current.contains(e.target as Node)) setShowTaskSurvey(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showTaskSurvey]);

  useEffect(() => {
    if (!showTaskSurvey) return;
    function handleKey(e: KeyboardEvent) { if (e.key === "Escape") setShowTaskSurvey(false); }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [showTaskSurvey]);

  // Close EOD modal on outside click / Escape
  useEffect(() => {
    if (!showEODModal) return;
    function handleClick(e: MouseEvent) {
      if (eodModalRef.current && !eodModalRef.current.contains(e.target as Node)) setShowEODModal(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showEODModal]);

  useEffect(() => {
    if (!showEODModal) return;
    function handleKey(e: KeyboardEvent) { if (e.key === "Escape") setShowEODModal(false); }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [showEODModal]);

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    if (!form.task_type) { setCreateErr("Please select a task type."); return; }
    if (!form.title.trim()) { setCreateErr("Task name is required."); return; }
    if (form.task_type === "set_time" && (!form.fixed_start || !form.fixed_end)) {
      setCreateErr("Please fill in both a start time and end time."); return;
    }
    if (form.recurrence === "weekly" && form.recurrence_days.length === 0) {
      setCreateErr("Please select at least one day for weekly recurrence."); return;
    }
    const t = sessionStorage.getItem("access_token");
    if (!t) return nav("/login", { replace: true });
    setCreating(true); setCreateErr(null);
    try {
      const dates = getRecurrenceDates(form);
      const basePayload = formToPayload(form);
      for (const date of dates) {
        const deadline = (form.task_type === "due_by" || form.task_type === "set_time")
          ? date
          : (form.recurrence !== "once" ? date : null);
        const payload = { ...basePayload, deadline };
        const res = await fetch(`${API}/tasks/`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(payload) });
        if (res.status === 401) { sessionStorage.clear(); nav("/login", { replace: true }); return; }
        if (!res.ok) { setCreateErr(friendlyError(await res.text(), "Failed to create task.")); return; }
      }
      setShowAddModal(false); await fetchTasks();
    } catch { setCreateErr("Failed to create task. Is the backend running?"); }
    finally { setCreating(false); }
  }

  async function saveEditTask(e: React.FormEvent) {
    e.preventDefault();
    if (!editTaskId) return;
    if (!editForm.task_type) { setEditErr("Please select a task type."); return; }
    if (!editForm.title.trim()) { setEditErr("Task name is required."); return; }
    if (editForm.task_type === "set_time" && (!editForm.fixed_start || !editForm.fixed_end)) {
      setEditErr("Please fill in both a start time and end time."); return;
    }
    if (editForm.recurrence === "weekly" && editForm.recurrence_days.length === 0) {
      setEditErr("Please select at least one day for weekly recurrence."); return;
    }
    const t = sessionStorage.getItem("access_token");
    if (!t) return nav("/login", { replace: true });
    setEditing(true); setEditErr(null);
    try {
      const res = await fetch(`${API}/tasks/${editTaskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify(formToPayload(editForm)),
      });
      if (res.status === 401) { sessionStorage.clear(); nav("/login", { replace: true }); return; }
      if (!res.ok) { setEditErr(friendlyError(await res.text(), "Failed to update task.")); return; }
      setShowEditModal(false); await fetchTasks();
    } catch { setEditErr("Failed to update task. Is the backend running?"); }
    finally { setEditing(false); }
  }

  const [confirmDelete, setConfirmDelete] = useState<Task | null>(null);

  async function deleteTask(id: number) {
    const t = sessionStorage.getItem("access_token");
    if (!t) return nav("/login", { replace: true });
    const prev = tasks;
    setTasks(x => x.filter(task => task.id !== id));
    try {
      const res = await fetch(`${API}/tasks/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${t}` } });
      if (res.status === 401) { sessionStorage.clear(); nav("/login", { replace: true }); return; }
      if (!res.ok) { setTasks(prev); setErr("Could not delete task."); }
    } catch { setTasks(prev); setErr("Could not delete task."); }
  }

  async function deleteAllRecurring(task: Task) {
    const t = sessionStorage.getItem("access_token");
    if (!t) return nav("/login", { replace: true });
    const key = task.title.trim();
    const toDelete = tasks.filter(tk =>
      tk.title.trim() === key &&
      tk.task_type === task.task_type &&
      tk.fixed_start === task.fixed_start &&
      tk.recurrence === task.recurrence &&
      tk.duration_minutes === task.duration_minutes
    );
    setTasks(prev => prev.filter(tk => !toDelete.find(d => d.id === tk.id)));
    try {
      await Promise.all(toDelete.map(tk =>
        fetch(`${API}/tasks/${tk.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${t}` } })
      ));
      await fetchTasks();
    } catch { setErr("Could not delete all recurring tasks."); await fetchTasks(); }
  }

  function handleDeleteClick(task: Task) {
    if (task.recurrence && task.recurrence !== "none") {
      setConfirmDelete(task);
    } else {
      deleteTask(task.id);
    }
  }

  async function rescheduleTask(id: number, newDeadline: string) {
    const t = sessionStorage.getItem("access_token");
    if (!t) return nav("/login", { replace: true });
    setTasks(prev => prev.map(task => task.id === id ? { ...task, deadline: newDeadline } : task));
    try {
      const res = await fetch(`${API}/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ deadline: newDeadline }) });
      if (!res.ok) await fetchTasks();
    } catch { await fetchTasks(); }
  }

  async function completeTask(id: number, taskTitle: string) {
    const t = sessionStorage.getItem("access_token");
    if (!t) return nav("/login", { replace: true });
    setTasks((prev) => prev.filter((task) => task.id !== id));
    try {
      const res = await fetch(`${API}/tasks/${id}/complete`, { method: "PATCH", headers: { Authorization: `Bearer ${t}` } });
      if (res.status === 401) { sessionStorage.clear(); nav("/login", { replace: true }); return; }
      if (!res.ok) { await fetchTasks(); return; }
    } catch { await fetchTasks(); return; }
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
      await fetch(`${API}/feedback/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({
          task_id:      surveyTaskId,
          date:         toDateStr(new Date()),
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
    setEodStressMorning(0); setEodStressAfternoon(0); setEodStressEvening(0);
    setEodBoredomMorning(0); setEodBoredomAfternoon(0); setEodBoredomEvening(0);
    setEodOverall(0); setEodNotes(""); setEodSuccess(false);
    setShowEODModal(true);
    try {
      const res = await fetch(`${API}/feedback/daily/${toDateStr(new Date())}`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.ok) {
        const data = await res.json();
        if (data.exists && data.data) {
          setEodStressMorning(data.data.stress_morning     || 0);
          setEodStressAfternoon(data.data.stress_afternoon || 0);
          setEodStressEvening(data.data.stress_evening     || 0);
          setEodBoredomMorning(data.data.boredom_morning   || 0);
          setEodBoredomAfternoon(data.data.boredom_afternoon || 0);
          setEodBoredomEvening(data.data.boredom_evening   || 0);
          setEodOverall(data.data.overall_rating           || 0);
          setEodNotes(data.data.notes                      || "");
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
      await fetch(`${API}/feedback/daily`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({
          date:              toDateStr(new Date()),
          stress_morning:    eodStressMorning    || null,
          boredom_morning:   eodBoredomMorning   || null,
          stress_afternoon:  eodStressAfternoon  || null,
          boredom_afternoon: eodBoredomAfternoon || null,
          stress_evening:    eodStressEvening    || null,
          boredom_evening:   eodBoredomEvening   || null,
          overall_rating:    eodOverall          || null,
          notes:             eodNotes            || null,
        }),
      });
      setEodSuccess(true);
      fetchSchedule();
      setTimeout(() => setShowEODModal(false), 1400);
    } catch {}
    setSubmittingEOD(false);
  }

  async function signOut() {
    const rt = sessionStorage.getItem("refresh_token");
    if (rt) { try { await fetch(`${API}/auth/logout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: rt }) }); } catch {} }
    sessionStorage.clear(); localStorage.clear(); nav("/login", { replace: true });
  }

  if (!session) return null;

  const profileRaw = localStorage.getItem("planner_profile");
  const profile = profileRaw ? JSON.parse(profileRaw) : null;
  const displayName = profile?.fullName?.trim() || session.email?.split("@")[0] || "User";
  const show2FABanner = !bannerDismissed && totpEnabled === false && email2FAEnabled === false;
  const todayStr = toDateStr(today);

  const filteredTasks = priorityFilter === 0 ? tasks : tasks.filter(t => t.importance === priorityFilter);

  function dedupeForList(taskList: Task[]): Task[] {
    const seen = new Map<string, Task>();
    const sorted = [...taskList].sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
    for (const t of sorted) {
      if (t.recurrence && t.recurrence !== "none") {
        const key = `${t.title.trim()}__${t.task_type}__${t.fixed_start ?? ""}__${t.recurrence}`;
        if (!seen.has(key)) seen.set(key, t);
      } else {
        seen.set(String(t.id), t);
      }
    }
    return Array.from(seen.values());
  }

  const overdueTasks = dedupeForList(filteredTasks.filter(t => t.deadline && t.deadline < todayStr && !t.completed));
  const upcomingTasks = dedupeForList([...filteredTasks.filter(t => t.deadline && t.deadline >= todayStr && !t.completed)]).sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));
  const noDeadlineTasks = dedupeForList(filteredTasks.filter(t => !t.deadline && !t.completed));
  const completedTasks = dedupeForList(filteredTasks.filter(t => t.completed));

  function tasksForDate(ds: string) { return tasks.filter(t => t.deadline === ds); }

  function prevMonth() { if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); } else setCalMonth(m => m - 1); }
  function nextMonth() { if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); } else setCalMonth(m => m + 1); }
  function prevWeek() { setWeekStart(d => addDays(d, -7)); }
  function nextWeek() { setWeekStart(d => addDays(d, 7)); }

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEnd = addDays(weekStart, 6);

  const agendaDays: { date: Date; dateStr: string; tasks: Task[] }[] = [];
  for (let i = 0; i < 60; i++) {
    const d = addDays(today, i); const ds = toDateStr(d);
    const dt = tasks.filter(t => t.deadline === ds).sort((a, b) => b.importance - a.importance);
    if (dt.length > 0) agendaDays.push({ date: d, dateStr: ds, tasks: dt });
  }
  const overdueAgenda = tasks.filter(t => t.deadline && t.deadline < todayStr && !t.completed).sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));

  const daysInMonth = getDaysInMonth(calYear, calMonth);
  const firstDay = getFirstDayOfMonth(calYear, calMonth);
  const calDays: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) calDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calDays.push(d);

  function PriorityBadge({ n }: { n: number }) {
    const c = importanceColor(n);
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 99, fontSize: "0.75rem", fontWeight: 600, background: c.bg, color: c.color, border: `1px solid ${c.border}`, whiteSpace: "nowrap" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.color, display: "inline-block", flexShrink: 0 }} />
        {importanceLabel(n)}
      </span>
    );
  }

  function TaskCard({ t }: { t: Task }) {
    const displayDuration = (() => {
      if (t.task_type === "fixed" && t.fixed_start && t.fixed_end) {
        const computed = calcDuration(t.fixed_start, t.fixed_end);
        return computed ?? t.duration_minutes;
      }
      return t.duration_minutes;
    })();

    return (
      <article className={`task ${t.completed ? "task-completed" : ""}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
          <div className="checkbox-wrapper-26">
            <input type="checkbox" id={`cb-${t.id}`} checked={t.completed} onChange={() => completeTask(t.id, t.title)} />
            <label htmlFor={`cb-${t.id}`}><div className="tick_mark"></div></label>
          </div>
          <div className="task-main">
            <div className="task-title" style={{ textDecoration: t.completed ? "line-through" : "none", opacity: t.completed ? 0.5 : 1 }}>{t.title}</div>
            <div className="task-meta">
              <PriorityBadge n={t.importance} />
              <span>•</span><span>{formatDuration(displayDuration)}</span>
              {t.task_type === "fixed" && t.fixed_start && <><span>•</span><span style={{ color: "var(--accent2)" }}>🕐 {t.fixed_start}{t.fixed_end ? `–${t.fixed_end}` : ""}</span></>}
              {t.deadline && <><span>•</span><span className="deadline-badge">📅 {t.deadline}</span></>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {!t.completed && <button className="ghost-btn" style={{ fontSize: "0.8rem" }} onClick={() => openEditModal(t)}>Edit</button>}
          <button className="danger-btn" onClick={() => handleDeleteClick(t)}>Delete</button>
        </div>
      </article>
    );
  }

  function DayPopup() {
    if (!dayPopup) return null;
    const dayTasks = tasksForDate(dayPopup);

    const PX_PER_MIN = 1.2;
    const HOUR_HEIGHT = 60 * PX_PER_MIN;
    const START_HOUR = 6;
    const totalHeight = HOURS.length * HOUR_HEIGHT;

    function timeToMinutes(hhmm: string) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }
    function to12h(hhmm: string) {
      const [h, m] = hhmm.split(":").map(Number);
      const ampm = h >= 12 ? "PM" : "AM";
      const h12 = h % 12 || 12;
      return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
    }

    const scheduleMap = new Map<number, { start_time: string; end_time: string }>();
    if (dayPopupSchedule) {
      for (const item of dayPopupSchedule.scheduled) {
        if (item.start_time && item.end_time) scheduleMap.set(item.task_id, { start_time: item.start_time, end_time: item.end_time });
      }
    }

    type PositionedTask = Task & { col: number; totalCols: number; startMin: number; endMin: number; timeLabel: string };

    const timedTasksRaw: { task: Task; startMin: number; endMin: number; timeLabel: string }[] = [];
    const allDayTasksList: Task[] = [];

    for (const t of dayTasks) {
      const scheduled = scheduleMap.get(t.id);
      if (t.task_type === "fixed" && t.fixed_start) {
        const startMin = timeToMinutes(t.fixed_start);
        const endMin = t.fixed_end ? timeToMinutes(t.fixed_end) : startMin + t.duration_minutes;
        timedTasksRaw.push({ task: t, startMin, endMin, timeLabel: `${to12h(t.fixed_start)}–${t.fixed_end ? to12h(t.fixed_end) : "?"}` });
      } else if (scheduled) {
        const startMin = timeToMinutes(scheduled.start_time);
        const endMin = timeToMinutes(scheduled.end_time);
        timedTasksRaw.push({ task: t, startMin, endMin, timeLabel: `${to12h(scheduled.start_time)}–${to12h(scheduled.end_time)}` });
      } else if (t.task_type === "semi" && t.fixed_end && !t.fixed_start) {
        const endMin = timeToMinutes(t.fixed_end);
        const startMin = Math.max(endMin - t.duration_minutes, START_HOUR * 60);
        timedTasksRaw.push({ task: t, startMin, endMin, timeLabel: `due by ${to12h(t.fixed_end)}` });
      } else {
        allDayTasksList.push(t);
      }
    }

    timedTasksRaw.sort((a, b) => a.startMin - b.startMin);

    const positioned: PositionedTask[] = timedTasksRaw.map(({ task, startMin, endMin, timeLabel }) => ({
      ...task, startMin, endMin, timeLabel, col: 0, totalCols: 1,
    }));

    positioned.forEach((task, i) => {
      const usedCols = new Set<number>();
      for (let j = 0; j < i; j++) {
        if (positioned[j].endMin > task.startMin && positioned[j].startMin < task.endMin) usedCols.add(positioned[j].col);
      }
      let col = 0;
      while (usedCols.has(col)) col++;
      task.col = col;
    });

    positioned.forEach((task, i) => {
      let maxCol = task.col;
      positioned.forEach((other, j) => {
        if (i !== j && other.endMin > task.startMin && other.startMin < task.endMin) maxCol = Math.max(maxCol, other.col);
      });
      task.totalCols = maxCol + 1;
    });

    return (
      <div className="modal-overlay">
        <div className="day-popup" ref={dayPopupRef}>
          <div className="modal-header">
            <h2 className="modal-title" style={{ fontSize: "1rem" }}>{formatDateLabel(dayPopup)}</h2>
            <button className="modal-close" onClick={() => setDayPopup(null)}>✕</button>
          </div>

          {allDayTasksList.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>No specific time</div>
              {allDayTasksList.map(t => (
                <div key={t.id} className="day-allday-chip" style={{ borderLeftColor: importanceDot(t.importance) }}>
                  <span style={{ fontWeight: 600, fontSize: "0.84rem" }}>{t.title}</span>
                  <span style={{ fontSize: "0.74rem", color: "var(--muted)", marginLeft: 10 }}>{importanceLabel(t.importance)} · {formatDuration(t.duration_minutes)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto", position: "relative" }} className="day-hour-grid">
            <div style={{ position: "relative", height: totalHeight }}>
              {HOURS.map((hour, idx) => {
                const hLabel = hour === 12 ? "12 PM" : hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
                return (
                  <div key={hour} style={{ position: "absolute", top: idx * HOUR_HEIGHT, left: 0, right: 0, height: HOUR_HEIGHT, display: "flex", alignItems: "flex-start", cursor: "pointer" }}
                    onClick={() => { setDayPopup(null); openAddModal(dayPopup, hour); }}
                  >
                    <div style={{ width: 56, flexShrink: 0, fontSize: "0.68rem", fontWeight: 600, color: "var(--muted)", paddingTop: 2, textAlign: "right", paddingRight: 10 }}>{hLabel}</div>
                    <div style={{ flex: 1, borderTop: "1px solid var(--border)", height: "100%" }} />
                  </div>
                );
              })}
              {positioned.map(t => {
                const topPx = (t.startMin - START_HOUR * 60) * PX_PER_MIN;
                const heightPx = Math.max((t.endMin - t.startMin) * PX_PER_MIN, 24);
                const colWidth = `calc((100% - 56px) / ${t.totalCols})`;
                const leftOffset = `calc(56px + ${t.col} * (100% - 56px) / ${t.totalCols})`;
                const c = importanceColor(t.importance);
                return (
                  <div key={t.id}
                    style={{ position: "absolute", top: topPx, left: leftOffset, width: colWidth, height: heightPx, background: c.bg, borderLeft: `3px solid ${importanceDot(t.importance)}`, borderRadius: 6, padding: "4px 8px", cursor: "pointer", overflow: "hidden", boxSizing: "border-box", zIndex: 2, border: `1px solid ${c.border}`, borderLeftWidth: 3 }}
                    onClick={e => { e.stopPropagation(); openEditModal(t); setDayPopup(null); }}
                  >
                    <div style={{ fontWeight: 700, fontSize: "0.8rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</div>
                    {heightPx > 30 && <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: 2 }}>{t.timeLabel}</div>}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ marginTop: 14, flexShrink: 0 }}>
            <button className="primary-btn" style={{ width: "100%" }} onClick={() => { setDayPopup(null); openAddModal(dayPopup); }}>+ Add task for this day</button>
          </div>
        </div>
      </div>
    );
  }

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
            if (!day) return <div key={`e-${i}`} className="cal-day cal-day-empty" />;
            const ds = calDateStr(calYear, calMonth, day);
            const dt = tasksForDate(ds);
            const isToday = ds === todayStr;
            const isOverdue = ds < todayStr && dt.some(t => !t.completed);
            return (
              <div key={day} className={`cal-day ${isToday ? "cal-day-today" : ""} ${dt.length > 0 ? "cal-day-has-tasks" : ""} ${isOverdue ? "cal-day-overdue" : ""}`}
                style={{ cursor: "pointer" }} onClick={() => setDayPopup(ds)}
                onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLDivElement).classList.add("cal-day-drag-over"); }}
                onDragLeave={e => { (e.currentTarget as HTMLDivElement).classList.remove("cal-day-drag-over"); }}
                onDrop={e => { e.preventDefault(); (e.currentTarget as HTMLDivElement).classList.remove("cal-day-drag-over"); if (dragTaskId !== null) { rescheduleTask(dragTaskId, ds); setDragTaskId(null); } }}
              >
                <span className="cal-day-num">{day}</span>
                {dt.slice(0, 2).map(t => (
                  <div key={t.id} className="cal-task-chip" style={{ borderLeftColor: importanceDot(t.importance), opacity: t.completed ? 0.4 : 1, cursor: "grab" }}
                    draggable onDragStart={e => { e.stopPropagation(); setDragTaskId(t.id); }} onDragEnd={() => setDragTaskId(null)}
                    onClick={e => e.stopPropagation()}
                  >{t.title}</div>
                ))}
                {dt.length > 2 && <div className="cal-task-more">+{dt.length - 2} more</div>}
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
            const dt = tasksForDate(ds);
            const isToday = ds === todayStr;
            const isOverdue = ds < todayStr && dt.some(t => !t.completed);
            return (
              <div key={i} className={`week-col ${isToday ? "week-col-today" : ""} ${isOverdue ? "week-col-overdue" : ""}`}
                style={{ cursor: "pointer" }} onClick={() => setDayPopup(ds)}
                onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLDivElement).classList.add("cal-day-drag-over"); }}
                onDragLeave={e => { (e.currentTarget as HTMLDivElement).classList.remove("cal-day-drag-over"); }}
                onDrop={e => { e.preventDefault(); (e.currentTarget as HTMLDivElement).classList.remove("cal-day-drag-over"); if (dragTaskId !== null) { rescheduleTask(dragTaskId, ds); setDragTaskId(null); } }}
              >
                <div className="week-col-header">
                  <span className="week-day-name">{DAY_NAMES[d.getDay()]}</span>
                  <span className={`week-day-num ${isToday ? "week-day-num-today" : ""}`}>{d.getDate()}</span>
                </div>
                <div className="week-col-tasks">
                  {dt.length === 0 ? <div className="week-empty">—</div>
                    : dt.map(t => (
                      <div key={t.id} className="week-task-chip" style={{ borderLeftColor: importanceDot(t.importance), opacity: t.completed ? 0.4 : 1, cursor: "grab" }}
                        draggable onDragStart={e => { e.stopPropagation(); setDragTaskId(t.id); }} onDragEnd={() => setDragTaskId(null)}
                        onClick={e => e.stopPropagation()}
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
        <div className="calendar-header"><h2 className="calendar-title">Upcoming Tasks</h2></div>
        <div className="agenda-list">
          {overdueAgenda.length > 0 && (
            <div className="agenda-group">
              <div className="agenda-date-label" style={{ color: "#ff6b6b" }}>⚠ Overdue</div>
              {overdueAgenda.map(t => (
                <div key={t.id} className="agenda-task" style={{ borderLeftColor: importanceDot(t.importance) }}>
                  <div className="agenda-task-title">{t.title}</div>
                  <div className="agenda-task-meta"><PriorityBadge n={t.importance} /><span>{formatDuration(t.duration_minutes)}</span><span className="deadline-badge">📅 {t.deadline}</span></div>
                </div>
              ))}
            </div>
          )}
          {agendaDays.length === 0 && overdueAgenda.length === 0 && <div className="empty" style={{ marginTop: 12 }}>No upcoming tasks with deadlines.</div>}
          {agendaDays.map(({ date, dateStr: ds, tasks: dt }) => {
            const isToday = ds === todayStr;
            const isTomorrow = ds === toDateStr(addDays(today, 1));
            const label = isToday ? "Today" : isTomorrow ? "Tomorrow" : `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;
            return (
              <div key={ds} className="agenda-group" style={{ cursor: "pointer" }} onClick={() => setDayPopup(ds)}>
                <div className={`agenda-date-label ${isToday ? "agenda-date-today" : ""}`}>{label}</div>
                {dt.map(t => (
                  <div key={t.id} className="agenda-task" style={{ borderLeftColor: importanceDot(t.importance) }}>
                    <div className="agenda-task-title">{t.title}</div>
                    <div className="agenda-task-meta"><PriorityBadge n={t.importance} /><span>{formatDuration(t.duration_minutes)}</span></div>
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
          <button className="eod-btn" type="button" onClick={openEODModal}>End of Day Check-In</button>
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
          <button className="twofa-banner-dismiss" onClick={() => setBannerDismissed(true)}>✕</button>
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
                <p className="panel-sub">{dedupeForList(tasks).length} task{dedupeForList(tasks).length !== 1 ? "s" : ""} total</p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="ghost-btn" type="button" onClick={fetchTasks}>↻ Refresh</button>
                <button className="primary-btn" type="button" onClick={() => openAddModal()}>+ Add Task</button>
              </div>
            </div>
            <div className="priority-filter-bar">
              {PRIORITY_FILTERS.map(f => {
                const active = priorityFilter === f.value;
                const c = f.value === 0 ? null : importanceColor(f.value);
                return (
                  <button key={f.value} className={`priority-filter-btn${active ? " priority-filter-btn-active" : ""}`}
                    style={active && c ? { background: c.bg, color: c.color, borderColor: c.border } : active ? { background: "rgba(108,99,255,.15)", color: "#6c63ff", borderColor: "rgba(108,99,255,.4)" } : {}}
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
              {loading ? <div className="empty">Loading tasks…</div>
                : filteredTasks.length === 0 ? (
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

          <section className="panel schedule-panel">
            <div className="panel-head">
              <div>
                <h1 className="panel-title">Today's Schedule</h1>
                <p className="panel-sub">
                  {schedule ? `${schedule.summary.scheduled_count} tasks · ${schedule.summary.total_hours}h planned` : "ML-optimized for your day"}
                </p>
              </div>
              <button className="ghost-btn" type="button" onClick={fetchSchedule} style={{ fontSize: "0.82rem" }}>↻ Refresh</button>
            </div>
            {scheduleLoading ? (
              <div className="empty" style={{ padding: "24px 0" }}>Building your schedule…</div>
            ) : !schedule ? (
              <div className="empty" style={{ padding: "24px 0" }}>
                <div style={{ fontSize: "1.5rem", marginBottom: 8 }}>📅</div>
                Could not load schedule. Make sure the backend is running.
              </div>
            ) : schedule.scheduled.length === 0 && schedule.overflow.length === 0 ? (
              <div className="empty" style={{ padding: "24px 0" }}>
                <div style={{ fontSize: "1.5rem", marginBottom: 8 }}>✅</div>
                No tasks to schedule today. Add some tasks to get started.
              </div>
            ) : (
              <div className="schedule-list">
                {schedule.scheduled.map((item) => {
                  const energyIcon = item.energy_level === "high" ? "🔥" : item.energy_level === "medium" ? "⚡" : "🌿";
                  const todColor = item.time_of_day === "morning" ? "#ffd43b" : item.time_of_day === "afternoon" ? "#74c0fc" : "#b197fc";
                  return (
                    <div key={item.task_id} className="schedule-item">
                      <div className="schedule-time-col">
                        <span className="schedule-start">{item.start_time}</span>
                        <span className="schedule-end">{item.end_time}</span>
                      </div>
                      <div className="schedule-bar" style={{ background: todColor }} />
                      <div className="schedule-info">
                        <div className="schedule-title">{item.title}</div>
                        <div className="schedule-meta">
                          <span>{energyIcon} {item.energy_level}</span>
                          <span>•</span>
                          <span style={{ color: todColor, fontWeight: 600 }}>{item.time_of_day}</span>
                          {item.task_type === "fixed" && <><span>•</span><span style={{ color: "var(--accent2)" }}>Fixed</span></>}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {schedule.overflow.length > 0 && (
                  <div className="schedule-overflow">
                    <div className="schedule-overflow-label">⚠ Didn't fit today</div>
                    {schedule.overflow.map((item) => (
                      <div key={item.task_id} className="schedule-overflow-item">
                        <span>{item.title}</span>
                        <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>{item.energy_level}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
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
          <div className="modal modal-tall" ref={modalRef}>
            <div className="modal-header">
              <h2 className="modal-title">Add New Task</h2>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>✕</button>
            </div>
            <form onSubmit={createTask} style={{ overflowY: "auto", maxHeight: "calc(80vh - 80px)", paddingRight: 4 }}>
              <TaskFormFields f={form} setF={setForm} err={createErr} showOpt={showOptional} setShowOpt={setShowOptional} showRec={showRecurrence} setShowRec={setShowRecurrence} />
              <div className="modal-actions" style={{ marginTop: 20 }}>
                <button type="button" className="ghost-btn" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="primary-btn" disabled={creating || !form.title.trim() || !form.task_type}>{creating ? "Adding…" : "Add Task"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditModal && editTaskId && (
        <div className="modal-overlay">
          <div className="modal modal-tall" ref={editModalRef}>
            <div className="modal-header">
              <h2 className="modal-title">Edit Task</h2>
              <button className="modal-close" onClick={() => setShowEditModal(false)}>✕</button>
            </div>
            <form onSubmit={saveEditTask} style={{ overflowY: "auto", maxHeight: "calc(80vh - 80px)", paddingRight: 4 }}>
              <TaskFormFields f={editForm} setF={setEditForm} err={editErr} showOpt={showEditOptional} setShowOpt={setShowEditOptional} showRec={showEditRecurrence} setShowRec={setShowEditRecurrence} />
              <div className="modal-actions" style={{ marginTop: 20 }}>
                <button type="button" className="ghost-btn" onClick={() => setShowEditModal(false)}>Cancel</button>
                <button type="submit" className="primary-btn" disabled={editing || !editForm.title.trim() || !editForm.task_type}>{editing ? "Saving…" : "Save Changes"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Task Completion Survey Modal ─────────────────────────────────────────── */}
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
                  <button key={f} type="button"
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
              <button type="button" className="ghost-btn" onClick={() => setShowTaskSurvey(false)}>Skip</button>
              <button type="button" className="primary-btn" onClick={submitTaskSurvey} disabled={submittingTaskSurvey}>
                {submittingTaskSurvey ? "Saving…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      <DayPopup />

      {/* Confirm delete recurring modal */}
      {confirmDelete && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h2 className="modal-title">Delete task</h2>
              <button className="modal-close" onClick={() => setConfirmDelete(null)}>✕</button>
            </div>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "0 0 20px" }}>
              <strong style={{ color: "var(--text)" }}>{confirmDelete.title}</strong> is a recurring task. Do you want to delete just this instance or all occurrences?
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="danger-btn" style={{ width: "100%", padding: "10px" }} onClick={() => { deleteTask(confirmDelete.id); setConfirmDelete(null); }}>
                Delete this instance only
              </button>
              <button className="danger-btn" style={{ width: "100%", padding: "10px", background: "rgba(255,107,107,.2)" }} onClick={() => { deleteAllRecurring(confirmDelete); setConfirmDelete(null); }}>
                Delete all occurrences
              </button>
              <button className="ghost-btn" style={{ width: "100%" }} onClick={() => setConfirmDelete(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── End of Day Survey Modal ──────────────────────────────────────────────── */}
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
                  <div className="survey-label">Boredom / engagement by time of day</div>
                  <div className="stress-hint-row">
                    <span className="stress-hint">1 = Very engaged</span>
                    <span className="stress-hint">5 = Very bored</span>
                  </div>
                  <div className="stress-period-row">
                    <span className="stress-period-label">🌅 Morning</span>
                    <StressScale value={eodBoredomMorning} onChange={setEodBoredomMorning} />
                  </div>
                  <div className="stress-period-row">
                    <span className="stress-period-label">☀️ Afternoon</span>
                    <StressScale value={eodBoredomAfternoon} onChange={setEodBoredomAfternoon} />
                  </div>
                  <div className="stress-period-row">
                    <span className="stress-period-label">🌙 Evening</span>
                    <StressScale value={eodBoredomEvening} onChange={setEodBoredomEvening} />
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
                  <button type="button" className="ghost-btn" onClick={() => setShowEODModal(false)}>Cancel</button>
                  <button type="submit" className="primary-btn" disabled={submittingEOD}>
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