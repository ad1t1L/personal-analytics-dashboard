import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import "../login.css";

const API = "http://localhost:8000";

type StrengthState = {
  show: boolean;
  width: string;
  bg: string;
  label: string;
};

function updateStrengthCalc(val: string): StrengthState {
  if (!val) return { show: false, width: "20%", bg: "#ff6b6b", label: "Weak" };

  let score = 0;
  if (val.length >= 8)           score++;
  if (/[A-Z]/.test(val))         score++;
  if (/[0-9]/.test(val))         score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;

  const map = [
    { w: "20%",  bg: "#ff6b6b", lbl: "Very weak" },
    { w: "40%",  bg: "#ffa94d", lbl: "Weak"      },
    { w: "65%",  bg: "#ffd43b", lbl: "Fair"       },
    { w: "85%",  bg: "#69db7c", lbl: "Good"       },
    { w: "100%", bg: "#38d9a9", lbl: "Strong 💪"  },
  ];
  const pick = map[Math.max(0, score - 1)];
  return { show: true, width: pick.w, bg: pick.bg, label: pick.lbl };
}

export default function ResetPassword() {
  const nav             = useNavigate();
  const [params]        = useSearchParams();
  const token           = params.get("token") ?? "";

  const [password, setPassword]   = useState("");
  const [confirm, setConfirm]     = useState("");
  const [showPw, setShowPw]       = useState(false);
  const [showCfm, setShowCfm]     = useState(false);
  const [loading, setLoading]     = useState(false);
  const [success, setSuccess]     = useState(false);
  const [error, setError]         = useState("");
  const [strength, setStrength]   = useState<StrengthState>({
    show: false, width: "20%", bg: "#ff6b6b", label: "Weak",
  });

  // No token in URL — show a clear error immediately
  if (!token) {
    return (
      <div className="login-layout">
        <div className="left-panel">
          <div className="grid-bg"></div>
          <div className="brand">
            <div className="brand-icon">📋</div>
            <span className="brand-name">PlannerHub</span>
          </div>
        </div>
        <div className="right-panel">
          <div className="auth-box">
            <div className="success-screen show">
              <div className="success-circle" style={{ background: "#ff6b6b" }}>✕</div>
              <h2>Invalid link</h2>
              <p>This reset link is missing or malformed. Please request a new one.</p>
              <button className="submit-btn" type="button" onClick={() => nav("/forgot-password")}>
                Request new link
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setError("Password must contain at least one uppercase letter.");
      return;
    }
    if (!/[0-9]/.test(password)) {
      setError("Password must contain at least one number.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.detail ?? "Something went wrong. Please request a new reset link.");
        return;
      }

      setSuccess(true);
    } catch {
      setError("Could not connect to server. Is the backend running?");
    } finally {
      setLoading(false);
    }
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
            Create a new
            <br />
            <span>password.</span>
          </h1>
          <p>
            Choose something strong — at least 8 characters, one uppercase
            letter, and one number.
          </p>
        </div>
      </div>

      {/* RIGHT */}
      <div className="right-panel">
        <div className="auth-box">
          {!success ? (
            <>
              <div className="form-title">Set new password 🔒</div>
              <div className="form-sub">
                Your reset link is valid. Enter your new password below.
              </div>

              {error && (
                <div className="toast show error" style={{ marginTop: "1rem" }}>
                  <span className="toast-icon">⚠️</span>
                  <span>{error}</span>
                </div>
              )}

              <form noValidate onSubmit={handleSubmit} style={{ marginTop: "1.5rem" }}>
                {/* New password */}
                <div className="field">
                  <label htmlFor="new-password">New Password</label>
                  <div className="input-wrap">
                    <span className="icon">🔑</span>
                    <input
                      id="new-password"
                      type={showPw ? "text" : "password"}
                      placeholder="Min. 8 characters"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setStrength(updateStrengthCalc(e.target.value));
                      }}
                      disabled={loading}
                    />
                    <button
                      className="icon-right"
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      disabled={loading}
                    >
                      {showPw ? "🙈" : "👁"}
                    </button>
                  </div>

                  {/* Strength meter */}
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

                {/* Confirm password */}
                <div className="field">
                  <label htmlFor="confirm-password">Confirm Password</label>
                  <div className="input-wrap">
                    <span className="icon">🔒</span>
                    <input
                      id="confirm-password"
                      type={showCfm ? "text" : "password"}
                      placeholder="Repeat your password"
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      disabled={loading}
                    />
                    <button
                      className="icon-right"
                      type="button"
                      onClick={() => setShowCfm((v) => !v)}
                      disabled={loading}
                    >
                      {showCfm ? "🙈" : "👁"}
                    </button>
                  </div>
                </div>

                <button
                  className={`submit-btn ${loading ? "loading" : ""}`}
                  type="submit"
                  disabled={loading}
                  style={{ marginTop: "0.5rem" }}
                >
                  <span className="btn-text">Reset Password</span>
                  <div className="spinner"></div>
                </button>
              </form>
            </>
          ) : (
            <div className="success-screen show">
              <div className="success-circle">✓</div>
              <h2>Password updated!</h2>
              <p>
                Your password has been reset successfully. You can now sign in
                with your new password.
              </p>
              <button
                className="submit-btn"
                type="button"
                onClick={() => nav("/login")}
                style={{ marginTop: "1.5rem" }}
              >
                Go to Sign In →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
