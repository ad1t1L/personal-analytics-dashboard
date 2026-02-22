import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "../login.css";

const API = "http://localhost:8000";

export default function ForgotPassword() {
  const nav = useNavigate();

  const [email, setEmail]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError]       = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const trimmed = email.trim();
    if (!trimmed) {
      setError("Please enter your email address.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.detail ?? "Something went wrong. Please try again.");
        return;
      }

      setSubmitted(true);
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
            Forgot your
            <br />
            <span>password?</span>
          </h1>
          <p>
            No worries — enter your email and we'll send you a secure link to
            reset it. The link expires in 1 hour.
          </p>
        </div>
      </div>

      {/* RIGHT */}
      <div className="right-panel">
        <div className="auth-box">
          {!submitted ? (
            <>
              <div className="form-title">Reset your password 🔑</div>
              <div className="form-sub">
                Enter the email address on your account and we'll send a reset link.
              </div>

              {error && (
                <div className="toast show error">
                  <span className="toast-icon">⚠️</span>
                  <span>{error}</span>
                </div>
              )}

              <form noValidate onSubmit={handleSubmit} style={{ marginTop: "1.5rem" }}>
                <div className="field">
                  <label htmlFor="reset-email">Email Address</label>
                  <div className="input-wrap">
                    <span className="icon">✉</span>
                    <input
                      id="reset-email"
                      type="email"
                      placeholder="you@example.com"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                    />
                  </div>
                </div>

                <button
                  className={`submit-btn ${loading ? "loading" : ""}`}
                  type="submit"
                  disabled={loading}
                  style={{ marginTop: "0.5rem" }}
                >
                  <span className="btn-text">Send Reset Link</span>
                  <div className="spinner"></div>
                </button>
              </form>

              <div className="switch-text" style={{ marginTop: "1.25rem" }}>
                Remember it?{" "}
                <button type="button" onClick={() => nav("/login")}>
                  Back to Sign In
                </button>
              </div>
            </>
          ) : (
            <div className="success-screen show">
              <div className="success-circle">📧</div>
              <h2>Check your inbox!</h2>
              <p>
                If <strong>{email}</strong> is registered, you'll receive a
                password reset link shortly. It expires in 1 hour.
              </p>
              <button
                className="submit-btn"
                type="button"
                onClick={() => nav("/login")}
                style={{ marginTop: "1.5rem" }}
              >
                Back to Sign In
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
