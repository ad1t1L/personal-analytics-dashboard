import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const API = "http://localhost:8000";

type Session = { email?: string; loginTime?: string };

type Profile = {
  fullName: string;
  email: string;
};

function isValidEmail(email: string) {
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRe.test(email);
}

function formatLoginTime(raw?: string) {
  if (!raw) return "Not available";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString();
}

export default function Account() {
  const nav = useNavigate();

  const [session, setSession] = useState<Session | null>(null);

  // editable form
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");

  // saved profile (display)
  const [savedProfile, setSavedProfile] = useState<Profile | null>(null);

  // ui state
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("planner_session");
    const t = sessionStorage.getItem("access_token");

    if (!raw || !t) {
      nav("/login", { replace: true });
      return;
    }

    try {
      const s = JSON.parse(raw) as Session;
      setSession(s);

      // load existing profile (if any)
      const saved = localStorage.getItem("planner_profile");
      if (saved) {
        const p = JSON.parse(saved) as Profile;
        setSavedProfile(p);

        // prefill form with saved values
        setFullName(p.fullName ?? "");
        setEmail(p.email ?? s.email ?? "");
      } else {
        // no saved profile yet — use session email as default in form
        setSavedProfile({
          fullName: "",
          email: s.email ?? "",
        });

        setFullName("");
        setEmail(s.email ?? "");
      }
    } catch {
      sessionStorage.clear();
      nav("/login", { replace: true });
    }
  }, [nav]);

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

  function goDashboard() {
    nav("/dashboard");
  }

  function goChangePassword() {
    nav("/forgot-password");
  }

  function copyEmail(value?: string) {
    const e = (value ?? email ?? session?.email ?? "").trim();
    if (!e) return;

    navigator.clipboard?.writeText(e).then(
      () => {
        setErr(null);
        setMsg("Copied ✅");
        window.setTimeout(() => setMsg(null), 1500);
      },
      () => setErr("Could not copy email.")
    );
  }

  function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);

    const cleanName = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) return setErr("Email is required.");
    if (!isValidEmail(cleanEmail)) return setErr("Enter a valid email address.");

    setSaving(true);

    try {
      const nextProfile: Profile = { fullName: cleanName, email: cleanEmail };

      // store locally (UI-only “update”)
      localStorage.setItem("planner_profile", JSON.stringify(nextProfile));
      setSavedProfile(nextProfile);

      // update planner_session so header + app reflects new email
      const prevRaw = sessionStorage.getItem("planner_session");
      const prev = prevRaw ? (JSON.parse(prevRaw) as Session) : {};
      const nextSession: Session = { ...prev, email: cleanEmail };

      sessionStorage.setItem("planner_session", JSON.stringify(nextSession));
      if (localStorage.getItem("planner_session")) {
        localStorage.setItem("planner_session", JSON.stringify(nextSession));
      }

      setSession(nextSession);

      setMsg("Profile updated ✅");
      window.setTimeout(() => setMsg(null), 2200);
    } catch {
      setErr("Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  if (!session || !savedProfile) return null;

  const displayName = savedProfile.fullName?.trim() ? savedProfile.fullName.trim() : "User";
  const displayEmail = savedProfile.email?.trim() ? savedProfile.email.trim() : session.email ?? "Not available";

  return (
    <>
      <header>
        <div className="brand">📋 PlannerHub</div>

        <div className="user-info">
          <span>{`👋 Welcome, ${displayEmail}`}</span>

          <button className="ghost-btn" type="button" onClick={goDashboard} style={{ marginRight: 10 }}>
            Dashboard
          </button>

          <button className="signout-btn" onClick={signOut}>
            Sign Out
          </button>
        </div>
      </header>

      <main className="dash">
        <aside className="sidebar">
          <div className="side-title">ACCOUNT</div>

          <button className="side-pill" type="button">
            PROFILE
          </button>

          <button className="side-link" type="button" onClick={goChangePassword}>
            Change password
          </button>

          <button className="side-link" type="button" onClick={signOut}>
            Sign out
          </button>

          <div className="side-muted">
            User Story:
            <br />
            View + update profile info
            <br />
            (UI-only save for now)
          </div>
        </aside>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h1 className="panel-title">Account</h1>
              <p className="panel-sub">View and update your profile information.</p>
            </div>

            <button className="ghost-btn" type="button" onClick={() => copyEmail(displayEmail)}>
              Copy email
            </button>
          </div>

          {err && <div className="error">{err}</div>}
          {msg && (
            <div className="error" style={{ borderStyle: "solid" }}>
              {msg}
            </div>
          )}

          {/* PROFILE OVERVIEW */}
          <div className="list" style={{ marginTop: 0 }}>
            <article className="task" style={{ alignItems: "center" }}>
              <div>
                <div className="task-title">Name</div>
                <div className="task-meta" style={{ marginTop: 4 }}>
                  <span>{displayName}</span>
                </div>
              </div>
              <button className="ghost-btn" type="button" onClick={() => setFullName(savedProfile.fullName ?? "")}>
                Edit
              </button>
            </article>

            <article className="task" style={{ alignItems: "center" }}>
              <div>
                <div className="task-title">Email</div>
                <div className="task-meta" style={{ marginTop: 4 }}>
                  <span>{displayEmail}</span>
                </div>
              </div>
              <button className="ghost-btn" type="button" onClick={() => copyEmail(displayEmail)}>
                Copy
              </button>
            </article>

            <article className="task" style={{ alignItems: "center" }}>
              <div>
                <div className="task-title">Last login</div>
                <div className="task-meta" style={{ marginTop: 4 }}>
                  <span>{formatLoginTime(session.loginTime)}</span>
                </div>
              </div>
              <button className="ghost-btn" type="button" onClick={goDashboard}>
                Go to dashboard
              </button>
            </article>
          </div>

          {/* EDIT PROFILE */}
          <div className="create" style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <h2 style={{ margin: 0 }}>Edit profile</h2>
                <p className="panel-sub" style={{ marginTop: 6 }}>
                  Changes save locally for now (backend hookup later).
                </p>
              </div>
            </div>

            <form onSubmit={saveProfile}>
              <div className="row" style={{ gridTemplateColumns: "1fr 1fr 140px" }}>
                <label className="field">
                  <span>Full name</span>
                  <input
                    className="input"
                    placeholder="Enter your name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    maxLength={80}
                  />
                </label>

                <label className="field">
                  <span>Email</span>
                  <input
                    className="input"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    maxLength={120}
                  />
                </label>

                <button className="primary-btn" type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </div>

          {/* SECURITY */}
          <div className="create" style={{ marginTop: 14 }}>
            <h2 style={{ margin: "0 0 6px" }}>Security</h2>
            <p className="panel-sub" style={{ marginTop: 0 }}>
              Quick actions (flows already exist in your app).
            </p>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="ghost-btn" type="button" onClick={goChangePassword}>
                Change password
              </button>
              <button className="danger-btn" type="button" onClick={signOut}>
                Sign out
              </button>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}