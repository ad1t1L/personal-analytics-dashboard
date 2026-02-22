import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

type Tab = "login" | "signup";

type ToastType = "success" | "error" | "warn";

type ToastState = {
  show: boolean;
  type?: ToastType;
  icon?: string;
  msg?: string;
};

type FieldErrors = Record<string, { invalid: boolean; msg: string }>;

type StrengthState = {
  show: boolean;
  width: string;
  bg: string;
  label: string;
};

const API = "http://localhost:8000";

function isValidEmail(email: string) {
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRe.test(email);
}

export default function Login() {
  const nav = useNavigate();

  const [tab, setTab] = useState<Tab>("login");

  // Login form state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  // Signup form state
  const [suName, setSuName] = useState("");
  const [suEmail, setSuEmail] = useState("");
  const [suPass, setSuPass] = useState("");
  const [suConfirm, setSuConfirm] = useState("");

  // UI states
  const [loginToast, setLoginToast] = useState<ToastState>({ show: false });
  const [signupToast, setSignupToast] = useState<ToastState>({ show: false });

  const [loginLoading, setLoginLoading] = useState(false);
  const [signupLoading, setSignupLoading] = useState(false);

  const [loginSuccess, setLoginSuccess] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  // Validation
  const [loginFields, setLoginFields] = useState<FieldErrors>({
    email: { invalid: false, msg: "This field is required" },
    pass: { invalid: false, msg: "This field is required" },
  });

  const [signupFields, setSignupFields] = useState<FieldErrors>({
    name: { invalid: false, msg: "Full name is required" },
    email: { invalid: false, msg: "A valid email is required" },
    pass: { invalid: false, msg: "Password must be at least 8 characters" },
    confirm: { invalid: false, msg: "Passwords do not match" },
  });

  // Password visibility
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [showSuPw, setShowSuPw] = useState(false);
  const [showSuConfirmPw, setShowSuConfirmPw] = useState(false);

  // Lockout (after 5 failures)
  const [failCount, setFailCount] = useState(0);
  const [lockUntil, setLockUntil] = useState<number>(0);
  const [lockLeft, setLockLeft] = useState<number>(30);

  // Strength meter
  const [strength, setStrength] = useState<StrengthState>({
    show: false,
    width: "20%",
    bg: "#ff6b6b",
    label: "Weak",
  });

  const isLocked = useMemo(() => Date.now() < lockUntil, [lockUntil]);

  useEffect(() => {
    // If already signed in, go to dashboard
    const token = sessionStorage.getItem("access_token");
    if (token) nav("/dashboard", { replace: true });
  }, [nav]);

  useEffect(() => {
    if (!lockUntil) return;

    const id = window.setInterval(() => {
      const left = Math.ceil((lockUntil - Date.now()) / 1000);
      if (left <= 0) {
        window.clearInterval(id);
        setLockUntil(0);
        setFailCount(0);
        setLockLeft(30);
      } else {
        setLockLeft(left);
      }
    }, 1000);

    return () => window.clearInterval(id);
  }, [lockUntil]);

  function clearToasts() {
    setLoginToast({ show: false });
    setSignupToast({ show: false });
  }

  function switchTab(next: Tab) {
    setTab(next);
    clearToasts();
    setLoginSuccess(false);
    setSignupSuccess(false);

    setLoginFields((p) => ({
      ...p,
      email: { ...p.email, invalid: false },
      pass: { ...p.pass, invalid: false },
    }));
    setSignupFields((p) => ({
      ...p,
      name: { ...p.name, invalid: false },
      email: { ...p.email, invalid: false },
      pass: { ...p.pass, invalid: false },
      confirm: { ...p.confirm, invalid: false },
    }));
  }

  function showToast(which: "login" | "signup", type: ToastType, icon: string, msg: string) {
    const toast: ToastState = { show: true, type, icon, msg };
    if (which === "login") setLoginToast(toast);
    else setSignupToast(toast);
  }

  function startLockout(seconds: number) {
    setLockLeft(seconds);
    setLockUntil(Date.now() + seconds * 1000);
  }

  function updateStrength(val: string) {
    if (!val) {
      setStrength((s) => ({ ...s, show: false }));
      return;
    }

    let score = 0;
    if (val.length >= 8) score++;
    if (/[A-Z]/.test(val)) score++;
    if (/[0-9]/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;

    const map = [
      { w: "20%", bg: "#ff6b6b", lbl: "Very weak" },
      { w: "40%", bg: "#ffa94d", lbl: "Weak" },
      { w: "65%", bg: "#ffd43b", lbl: "Fair" },
      { w: "85%", bg: "#69db7c", lbl: "Good" },
      { w: "100%", bg: "#38d9a9", lbl: "Strong 💪" },
    ];

    const pick = map[Math.max(0, score - 1)];
    setStrength({ show: true, width: pick.w, bg: pick.bg, label: pick.lbl });
  }

  async function onLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isLocked) return;

    clearToasts();

    const email = loginEmail.trim();
    const pass = loginPass;

    // Client-side validation
    let ok = true;

    if (!email) {
      ok = false;
      setLoginFields((p) => ({
        ...p,
        email: { invalid: true, msg: "Email is required" },
      }));
    } else {
      setLoginFields((p) => ({ ...p, email: { ...p.email, invalid: false } }));
    }

    if (!pass) {
      ok = false;
      setLoginFields((p) => ({
        ...p,
        pass: { invalid: true, msg: "Password is required" },
      }));
    } else {
      setLoginFields((p) => ({ ...p, pass: { ...p.pass, invalid: false } }));
    }

    if (!ok) {
      showToast("login", "error", "⚠️", "Please fill in all required fields.");
      return;
    }

    setLoginLoading(true);

    try {
      // OAuth2PasswordRequestForm expects form data, not JSON
      const formData = new URLSearchParams();
      formData.append("username", email);
      formData.append("password", pass);

      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      const data = await res.json();

      if (!res.ok) {
        // 401 = wrong credentials, 403 = not verified
        const nextFails = failCount + 1;
        setFailCount(nextFails);

        if (res.status === 403) {
          showToast("login", "warn", "📧", "Please verify your email before logging in.");
        } else {
          const remaining = 5 - nextFails;
          const msg =
            remaining > 0
              ? `Incorrect email or password. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`
              : "Too many failed attempts.";
          showToast("login", "error", "🔐", msg);
          setLoginFields((p) => ({
            ...p,
            pass: { invalid: true, msg: "Incorrect email or password" },
          }));
        }

        if (nextFails >= 5) startLockout(30);
        return;
      }

      // Success — store tokens
      setFailCount(0);
      sessionStorage.setItem("access_token", data.access_token);
      sessionStorage.setItem("refresh_token", data.refresh_token);

      // Store user info for dashboard display
      const session = { email, loginTime: new Date().toISOString() };
      sessionStorage.setItem("planner_session", JSON.stringify(session));

      if (rememberMe) {
        localStorage.setItem("access_token", data.access_token);
        localStorage.setItem("refresh_token", data.refresh_token);
        localStorage.setItem("planner_session", JSON.stringify(session));
      } else {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        localStorage.removeItem("planner_session");
      }

      setLoginSuccess(true);
      setTimeout(() => nav("/dashboard", { replace: true }), 1800);

    } catch {
      showToast("login", "error", "❌", "Could not connect to server. Is the backend running?");
    } finally {
      setLoginLoading(false);
    }
  }

  function onForgotPassword() {
    nav("/forgot-password");
  }

  async function onSignupSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearToasts();

    const name = suName.trim();
    const email = suEmail.trim();
    const pass = suPass;
    const confirm = suConfirm;

    let ok = true;

    if (!name) {
      ok = false;
      setSignupFields((p) => ({
        ...p,
        name: { invalid: true, msg: "Full name is required" },
      }));
    } else {
      setSignupFields((p) => ({ ...p, name: { ...p.name, invalid: false } }));
    }

    if (!email || !isValidEmail(email)) {
      ok = false;
      setSignupFields((p) => ({
        ...p,
        email: { invalid: true, msg: "Enter a valid email address" },
      }));
    } else {
      setSignupFields((p) => ({ ...p, email: { ...p.email, invalid: false } }));
    }

    if (pass.length < 8) {
      ok = false;
      setSignupFields((p) => ({
        ...p,
        pass: { invalid: true, msg: "Password must be at least 8 characters" },
      }));
    } else if (!pass.match(/[A-Z]/)) {
      ok = false;
      setSignupFields((p) => ({
        ...p,
        pass: { invalid: true, msg: "Password must contain at least one uppercase letter" },
      }));
    } else if (!pass.match(/[0-9]/)) {
      ok = false;
      setSignupFields((p) => ({
        ...p,
        pass: { invalid: true, msg: "Password must contain at least one number" },
      }));
    } else {
      setSignupFields((p) => ({ ...p, pass: { ...p.pass, invalid: false } }));
    }

    if (pass !== confirm) {
      ok = false;
      setSignupFields((p) => ({
        ...p,
        confirm: { invalid: true, msg: "Passwords do not match" },
      }));
    } else {
      setSignupFields((p) => ({ ...p, confirm: { ...p.confirm, invalid: false } }));
    }

    if (!ok) {
      showToast("signup", "error", "⚠️", "Please correct the errors above.");
      return;
    }

    setSignupLoading(true);

    try {
      const res = await fetch(`${API}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password: pass }),
      });

      const data = await res.json();

      if (!res.ok) {
        // Surface any validation errors from the backend
        const detail = data.detail ?? "Registration failed. Please try again.";
        showToast("signup", "error", "❌", detail);
        return;
      }

      setSignupSuccess(true);
      setTimeout(() => resetSignup(), 2200);

    } catch {
      showToast("signup", "error", "❌", "Could not connect to server. Is the backend running?");
    } finally {
      setSignupLoading(false);
    }
  }

  function resetSignup() {
    setSuName("");
    setSuEmail("");
    setSuPass("");
    setSuConfirm("");
    setSignupSuccess(false);
    setSignupToast({ show: false });
    updateStrength("");
    switchTab("login");
  }

  return (
    <div className="login-layout">
      {/* LEFT */}
      <div className="left-panel">
        <div className="grid-bg"></div>

        <div className="brand">
          <div className="brand-icon">📋</div>
          <span className="brand-name">PlannerHub</span>
        </div>

        <div className="hero-text">
          <h1>
            Your plans,
            <br />
            <span>beautifully organized.</span>
          </h1>
          <p>
            Stay on top of every task, deadline, and goal — all from one clean, powerful dashboard.
          </p>

          <ul className="feature-list">
            <li>
              <span className="dot"></span> Smart task boards with drag &amp; drop
            </li>
            <li>
              <span className="dot"></span> Calendar sync &amp; deadline reminders
            </li>
            <li>
              <span className="dot"></span> Team collaboration &amp; sharing
            </li>
            <li>
              <span className="dot"></span> Real-time progress analytics
            </li>
          </ul>
        </div>
      </div>

      {/* RIGHT */}
      <div className="right-panel">
        <div className="auth-box">
          {/* Tab bar */}
          <div className="tab-bar">
            <button
              className={`tab-btn ${tab === "login" ? "active" : ""}`}
              type="button"
              onClick={() => switchTab("login")}
            >
              Sign In
            </button>
            <button
              className={`tab-btn ${tab === "signup" ? "active" : ""}`}
              type="button"
              onClick={() => switchTab("signup")}
            >
              Create Account
            </button>
          </div>

          {/* LOGIN */}
          {tab === "login" && !loginSuccess && (
            <div id="panel-login">
              <div className="form-title">Welcome back 👋</div>
              <div className="form-sub">Sign in to your PlannerHub dashboard</div>

              <div className={`lockout-bar ${isLocked ? "show" : ""}`}>
                Too many failed attempts. Try again in{" "}
                <span className="lockout-timer">{lockLeft}</span>s
              </div>

              <div className={`toast ${loginToast.show ? "show" : ""} ${loginToast.type ?? ""}`}>
                <span className="toast-icon">{loginToast.icon ?? ""}</span>
                <span>{loginToast.msg ?? ""}</span>
              </div>

              <form noValidate onSubmit={onLoginSubmit}>
                <div className={`field ${loginFields.email.invalid ? "invalid" : ""}`}>
                  <label htmlFor="login-email">Email</label>
                  <div className="input-wrap">
                    <span className="icon">✉</span>
                    <input
                      autoComplete="username"
                      id="login-email"
                      type="text"
                      placeholder="you@example.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      disabled={loginLoading || isLocked}
                    />
                  </div>
                  <span className="field-error">{loginFields.email.msg}</span>
                </div>

                <div className={`field ${loginFields.pass.invalid ? "invalid" : ""}`}>
                  <label htmlFor="login-password">Password</label>
                  <div className="input-wrap">
                    <span className="icon">🔑</span>
                    <input
                      autoComplete="current-password"
                      id="login-password"
                      type={showLoginPw ? "text" : "password"}
                      placeholder="••••••••"
                      value={loginPass}
                      onChange={(e) => setLoginPass(e.target.value)}
                      disabled={loginLoading || isLocked}
                    />
                    <button
                      className="icon-right"
                      type="button"
                      onClick={() => setShowLoginPw((v) => !v)}
                      disabled={loginLoading || isLocked}
                    >
                      {showLoginPw ? "🙈" : "👁"}
                    </button>
                  </div>
                  <span className="field-error">{loginFields.pass.msg}</span>
                </div>

                <div className="row-between">
                  <label className="remember-wrap">
                    <input
                      id="remember-me"
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      disabled={loginLoading || isLocked}
                    />{" "}
                    Remember me
                  </label>
                  <button
                    className="link-btn"
                    type="button"
                    onClick={onForgotPassword}
                    disabled={loginLoading || isLocked}
                  >
                    Forgot password?
                  </button>
                </div>

                <button
                  className={`submit-btn ${loginLoading ? "loading" : ""}`}
                  type="submit"
                  disabled={loginLoading || isLocked}
                >
                  <span className="btn-text">Sign In</span>
                  <div className="spinner"></div>
                </button>
              </form>

              <div className="switch-text">
                Don't have an account?{" "}
                <button type="button" onClick={() => switchTab("signup")}>
                  Create one free
                </button>
              </div>
            </div>
          )}

          {/* LOGIN SUCCESS */}
          {tab === "login" && loginSuccess && (
            <div className="success-screen show">
              <div className="success-circle">✓</div>
              <h2>You're in!</h2>
              <p>Secure session created. Taking you to your dashboard…</p>
              <button className="submit-btn" type="button" onClick={() => nav("/dashboard", { replace: true })}>
                Go to Dashboard →
              </button>
            </div>
          )}

          {/* SIGNUP */}
          {tab === "signup" && !signupSuccess && (
            <div id="panel-signup">
              <div className="form-title">Create account</div>
              <div className="form-sub">Join PlannerHub — free forever</div>

              <div className={`toast ${signupToast.show ? "show" : ""} ${signupToast.type ?? ""}`}>
                <span className="toast-icon">{signupToast.icon ?? ""}</span>
                <span>{signupToast.msg ?? ""}</span>
              </div>

              <form noValidate onSubmit={onSignupSubmit}>
                <div className={`field ${signupFields.name.invalid ? "invalid" : ""}`}>
                  <label htmlFor="su-name">Full Name</label>
                  <div className="input-wrap">
                    <span className="icon">👤</span>
                    <input
                      autoComplete="name"
                      id="su-name"
                      type="text"
                      placeholder="Alex Johnson"
                      value={suName}
                      onChange={(e) => setSuName(e.target.value)}
                      disabled={signupLoading}
                    />
                  </div>
                  <span className="field-error">{signupFields.name.msg}</span>
                </div>

                <div className={`field ${signupFields.email.invalid ? "invalid" : ""}`}>
                  <label htmlFor="su-email">Email Address</label>
                  <div className="input-wrap">
                    <span className="icon">✉</span>
                    <input
                      autoComplete="email"
                      id="su-email"
                      type="email"
                      placeholder="you@example.com"
                      value={suEmail}
                      onChange={(e) => setSuEmail(e.target.value)}
                      disabled={signupLoading}
                    />
                  </div>
                  <span className="field-error">{signupFields.email.msg}</span>
                </div>

                <div className={`field ${signupFields.pass.invalid ? "invalid" : ""}`}>
                  <label htmlFor="su-password">Password</label>
                  <div className="input-wrap">
                    <span className="icon">🔑</span>
                    <input
                      autoComplete="new-password"
                      id="su-password"
                      type={showSuPw ? "text" : "password"}
                      placeholder="Min. 8 characters"
                      value={suPass}
                      onChange={(e) => {
                        setSuPass(e.target.value);
                        updateStrength(e.target.value);
                      }}
                      disabled={signupLoading}
                    />
                    <button
                      className="icon-right"
                      type="button"
                      onClick={() => setShowSuPw((v) => !v)}
                      disabled={signupLoading}
                    >
                      {showSuPw ? "🙈" : "👁"}
                    </button>
                  </div>
                  <span className="field-error">{signupFields.pass.msg}</span>

                  <div className={`strength-bar ${strength.show ? "show" : ""}`}>
                    <div className="strength-track">
                      <div
                        className="strength-fill"
                        style={{ width: strength.width, background: strength.bg }}
                      ></div>
                    </div>
                    <div className="strength-label">{strength.label}</div>
                  </div>
                </div>

                <div className={`field ${signupFields.confirm.invalid ? "invalid" : ""}`}>
                  <label htmlFor="su-confirm">Confirm Password</label>
                  <div className="input-wrap">
                    <span className="icon">🔒</span>
                    <input
                      autoComplete="new-password"
                      id="su-confirm"
                      type={showSuConfirmPw ? "text" : "password"}
                      placeholder="Repeat your password"
                      value={suConfirm}
                      onChange={(e) => setSuConfirm(e.target.value)}
                      disabled={signupLoading}
                    />
                    <button
                      className="icon-right"
                      type="button"
                      onClick={() => setShowSuConfirmPw((v) => !v)}
                      disabled={signupLoading}
                    >
                      {showSuConfirmPw ? "🙈" : "👁"}
                    </button>
                  </div>
                  <span className="field-error">{signupFields.confirm.msg}</span>
                </div>

                <button
                  className={`submit-btn ${signupLoading ? "loading" : ""}`}
                  type="submit"
                  disabled={signupLoading}
                >
                  <span className="btn-text">Create Account</span>
                  <div className="spinner"></div>
                </button>
              </form>

              <div className="switch-text">
                Already have an account?{" "}
                <button type="button" onClick={() => switchTab("login")}>
                  Sign in
                </button>
              </div>
            </div>
          )}

          {/* SIGNUP SUCCESS */}
          {tab === "signup" && signupSuccess && (
            <div className="success-screen show">
              <div className="success-circle">🎉</div>
              <h2>Account created!</h2>
              <p>Check your email for a verification link, then sign in.</p>
              <button className="submit-btn" type="button" onClick={resetSignup}>
                Sign In →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
