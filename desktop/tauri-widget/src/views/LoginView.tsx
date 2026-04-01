import { useMemo, useState } from "react";

type Tab = "login" | "signup";

type Props = {
  onAuthed: () => void;
};

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://localhost:8000";

function isValidEmail(email: string) {
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRe.test(email);
}

export default function LoginView({ onAuthed }: Props) {
  const [tab, setTab] = useState<Tab>("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const [name, setName] = useState("");
  const [suEmail, setSuEmail] = useState("");
  const [suPassword, setSuPassword] = useState("");
  const [suConfirm, setSuConfirm] = useState("");

  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ kind: "error" | "success"; msg: string } | null>(null);

  const canSubmitLogin = useMemo(() => {
    return isValidEmail(email.trim()) && password.length > 0 && !loading;
  }, [email, password, loading]);

  const canSubmitSignup = useMemo(() => {
    return (
      name.trim().length > 0 &&
      isValidEmail(suEmail.trim()) &&
      suPassword.length >= 8 &&
      suPassword === suConfirm &&
      !loading
    );
  }, [name, suEmail, suPassword, suConfirm, loading]);

  async function onLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    setToast(null);
    const em = email.trim();
    if (!isValidEmail(em) || !password) {
      setToast({ kind: "error", msg: "Enter a valid email and password." });
      return;
    }

    setLoading(true);
    try {
      const formData = new URLSearchParams();
      formData.append("username", em);
      formData.append("password", password);

      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setToast({ kind: "error", msg: data?.detail ?? "Login failed. Check your credentials." });
        return;
      }

      // Basic token storage (mirrors the web app behavior).
      // Always write to localStorage so the widget window can read the token.
      const session = { email: em, loginTime: new Date().toISOString() };
      const token = data.access_token ?? "";
      const refresh = data.refresh_token ?? "";
      sessionStorage.setItem("access_token", token);
      sessionStorage.setItem("refresh_token", refresh);
      sessionStorage.setItem("planner_session", JSON.stringify(session));
      localStorage.setItem("access_token", token);
      localStorage.setItem("refresh_token", refresh);
      localStorage.setItem("planner_session", JSON.stringify(session));

      setToast({ kind: "success", msg: "Signed in. Opening dashboard…" });
      onAuthed();
    } catch (err) {
      const msg =
        err instanceof Error
          ? `Could not connect to the backend: ${err.message}`
          : "Could not connect to the backend. Is it running?";
      setToast({ kind: "error", msg });
    } finally {
      setLoading(false);
    }
  }

  async function onSignupSubmit(e: React.FormEvent) {
    e.preventDefault();
    setToast(null);

    const nm = name.trim();
    const em = suEmail.trim();

    if (!nm || !isValidEmail(em)) {
      setToast({ kind: "error", msg: "Enter a name and a valid email." });
      return;
    }
    if (suPassword.length < 8) {
      setToast({ kind: "error", msg: "Password must be at least 8 characters." });
      return;
    }
    if (!/[A-Z]/.test(suPassword)) {
      setToast({
        kind: "error",
        msg: "Password must contain at least one uppercase letter.",
      });
      return;
    }
    if (!/[0-9]/.test(suPassword)) {
      setToast({
        kind: "error",
        msg: "Password must contain at least one number.",
      });
      return;
    }
    if (suPassword !== suConfirm) {
      setToast({ kind: "error", msg: "Passwords do not match." });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nm, email: em, password: suPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        let msg = "Could not create account.";
        const detail = (data as any)?.detail;
        if (typeof detail === "string") {
          msg = detail;
        } else if (Array.isArray(detail) && detail[0]?.msg) {
          msg = String(detail[0].msg);
        }
        setToast({ kind: "error", msg });
        return;
      }

      setToast({ kind: "success", msg: "Account created. Check your email to verify, then sign in." });
      setTab("login");
      setEmail(em);
      setPassword("");
    } catch {
      setToast({ kind: "error", msg: "Could not connect to the backend. Is it running?" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="loginLayout">
        <div className="loginLeft">
        <div className="loginBrand">
          <img className="loginBrandIcon" alt="App icon" src="/tauri.svg" />
          <div className="loginBrandName">Personal Analytics</div>
        </div>
        <div className="loginHero">
          <h1>
            Insights,
            <br />
            <span>at a glance.</span>
          </h1>
          <p className="muted">
            Sign in to sync analytics, manage your account, and keep the desktop widget up to date.
          </p>
          <ul className="loginBullets">
            <li>Frameless always-on-top widget mode</li>
            <li>System tray toggle</li>
            <li>Cross-platform (Windows / macOS / Linux)</li>
          </ul>
        </div>
        </div>

      <div className="loginRight">
        <div className="loginCard">
          <div className="loginTabs">
            <button
              type="button"
              className={`loginTab ${tab === "login" ? "active" : ""}`}
              onClick={() => {
                setTab("login");
                setToast(null);
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              className={`loginTab ${tab === "signup" ? "active" : ""}`}
              onClick={() => {
                setTab("signup");
                setToast(null);
              }}
            >
              Create account
            </button>
          </div>

          {toast && (
            <div className={`loginToast ${toast.kind}`}>
              <span>{toast.msg}</span>
            </div>
          )}

          {tab === "login" ? (
            <form onSubmit={onLoginSubmit} className="loginForm">
              <label className="loginLabel">
                Email
                <input
                  className="loginInput"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                  placeholder="you@example.com"
                  disabled={loading}
                />
              </label>

              <label className="loginLabel">
                Password
                <div className="loginPwRow">
                  <input
                    className="loginInput"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.currentTarget.value)}
                    placeholder="••••••••"
                    type={showPw ? "text" : "password"}
                    disabled={loading}
                  />
                  <button
                    className="button subtle loginPwToggle"
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    disabled={loading}
                  >
                    {showPw ? "Hide" : "Show"}
                  </button>
                </div>
              </label>

              <label className="loginRemember">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.currentTarget.checked)}
                  disabled={loading}
                />
                Remember me
              </label>

              <button className="button loginSubmit" type="submit" disabled={!canSubmitLogin}>
                {loading ? "Signing in…" : "Sign in"}
              </button>
            </form>
          ) : (
            <form onSubmit={onSignupSubmit} className="loginForm">
              <label className="loginLabel">
                Full name
                <input
                  className="loginInput"
                  value={name}
                  onChange={(e) => setName(e.currentTarget.value)}
                  placeholder="Alex Johnson"
                  disabled={loading}
                />
              </label>
              <label className="loginLabel">
                Email
                <input
                  className="loginInput"
                  autoComplete="email"
                  value={suEmail}
                  onChange={(e) => setSuEmail(e.currentTarget.value)}
                  placeholder="you@example.com"
                  disabled={loading}
                />
              </label>
              <label className="loginLabel">
                Password
                <input
                  className="loginInput"
                  autoComplete="new-password"
                  value={suPassword}
                  onChange={(e) => setSuPassword(e.currentTarget.value)}
                  placeholder="At least 8 characters"
                  type="password"
                  disabled={loading}
                />
              </label>
              <label className="loginLabel">
                Confirm password
                <input
                  className="loginInput"
                  autoComplete="new-password"
                  value={suConfirm}
                  onChange={(e) => setSuConfirm(e.currentTarget.value)}
                  placeholder="Repeat password"
                  type="password"
                  disabled={loading}
                />
              </label>
              <button className="button loginSubmit" type="submit" disabled={!canSubmitSignup}>
                {loading ? "Creating…" : "Create account"}
              </button>
            </form>
          )}

          <div className="loginWidgetHint">
            <strong>Task widget:</strong> After you sign in, look for{" "}
            <strong>📌 Task widget</strong> in the top bar, sidebar, or task panel — or use the{" "}
            <strong>system tray</strong> menu (Show Widget).
          </div>

          <div className="loginFooter">
            Backend URL: <code>{API_BASE}</code>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

