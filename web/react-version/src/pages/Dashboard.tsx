import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const API = "http://localhost:8000";

type Session = { email?: string; loginTime?: string };

function getAuthHeaders(): HeadersInit {
  const token = sessionStorage.getItem("access_token");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export default function Dashboard() {
  const nav = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [output, setOutput] = useState("Loading tasks...");

  // 2FA state
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);
  const [email2FAEnabled, setEmail2FAEnabled] = useState<boolean | null>(null);
  const [twoFASetup, setTwoFASetup] = useState<{ qr_base64: string; secret: string } | null>(null);
  const [twoFASetupCode, setTwoFASetupCode] = useState("");
  const [twoFADisableCode, setTwoFADisableCode] = useState("");
  const [twoFAMessage, setTwoFAMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [twoFALoading, setTwoFALoading] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem("planner_session");
    const token = sessionStorage.getItem("access_token");

    if (!raw || !token) {
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

  useEffect(() => {
    async function loadTasks() {
      if (!session) return;

      const token = sessionStorage.getItem("access_token");
      if (!token) {
        nav("/login", { replace: true });
        return;
      }

      try {
        const res = await fetch(`${API}/tasks/`, {
          headers: {
            // Attach the JWT on every request to the backend
            Authorization: `Bearer ${token}`,
          },
        });

        if (res.status === 401) {
          // Token expired — send back to login
          sessionStorage.clear();
          nav("/login", { replace: true });
          return;
        }

        const data = await res.json();
        setOutput(
          data.tasks?.length
            ? JSON.stringify(data.tasks, null, 2)
            : "No tasks yet. Add some tasks to get started!"
        );
      } catch {
        setOutput("Could not load tasks. Is the backend running?");
      }
    }

    loadTasks();
  }, [session, nav]);

  const fetch2FAStatus = useCallback(async () => {
    const token = sessionStorage.getItem("access_token");
    if (!token) return;
    try {
      const res = await fetch(`${API}/auth/2fa/status`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setTotpEnabled(!!data.totp_enabled);
        setEmail2FAEnabled(!!data.email_2fa_enabled);
      }
    } catch {
      setTotpEnabled(false);
      setEmail2FAEnabled(false);
    }
  }, []);

  useEffect(() => {
    if (session) fetch2FAStatus();
  }, [session, fetch2FAStatus]);

  async function start2FASetup() {
    setTwoFAMessage(null);
    setTwoFALoading(true);
    try {
      const res = await fetch(`${API}/auth/2fa/setup`, { method: "POST", headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Setup failed");
      setTwoFASetup({ qr_base64: data.qr_base64, secret: data.secret });
      setTwoFASetupCode("");
    } catch (e) {
      setTwoFAMessage({ type: "err", text: e instanceof Error ? e.message : "Setup failed" });
    } finally {
      setTwoFALoading(false);
    }
  }

  async function confirm2FASetup() {
    const code = twoFASetupCode.replace(/\D/g, "");
    if (code.length !== 6) {
      setTwoFAMessage({ type: "err", text: "Enter the 6-digit code from your app." });
      return;
    }
    setTwoFALoading(true);
    setTwoFAMessage(null);
    try {
      const res = await fetch(`${API}/auth/2fa/verify`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Verification failed");
      setTwoFAMessage({ type: "ok", text: "2FA is now enabled." });
      setTwoFASetup(null);
      setTwoFASetupCode("");
      setTotpEnabled(true);
    } catch (e) {
      setTwoFAMessage({ type: "err", text: e instanceof Error ? e.message : "Invalid code." });
    } finally {
      setTwoFALoading(false);
    }
  }

  async function disable2FA() {
    const code = twoFADisableCode.replace(/\D/g, "");
    if (code.length !== 6) {
      setTwoFAMessage({ type: "err", text: "Enter your current 6-digit code." });
      return;
    }
    setTwoFALoading(true);
    setTwoFAMessage(null);
    try {
      const res = await fetch(`${API}/auth/2fa/disable`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Disable failed");
      setTwoFAMessage({ type: "ok", text: "Authenticator 2FA has been disabled." });
      setTwoFADisableCode("");
      setTotpEnabled(false);
    } catch (e) {
      setTwoFAMessage({ type: "err", text: e instanceof Error ? e.message : "Invalid code." });
    } finally {
      setTwoFALoading(false);
    }
  }

  async function enableEmail2FA() {
    setTwoFALoading(true);
    setTwoFAMessage(null);
    try {
      const res = await fetch(`${API}/auth/2fa/enable-email`, { method: "POST", headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Enable failed");
      setTwoFAMessage({ type: "ok", text: "Email 2FA is now enabled. You can request a code at login." });
      setEmail2FAEnabled(true);
    } catch (e) {
      setTwoFAMessage({ type: "err", text: e instanceof Error ? e.message : "Enable failed" });
    } finally {
      setTwoFALoading(false);
    }
  }

  async function disableEmail2FA() {
    setTwoFALoading(true);
    setTwoFAMessage(null);
    try {
      const res = await fetch(`${API}/auth/2fa/disable-email`, { method: "POST", headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Disable failed");
      setTwoFAMessage({ type: "ok", text: "Email 2FA has been disabled." });
      setEmail2FAEnabled(false);
    } catch (e) {
      setTwoFAMessage({ type: "err", text: e instanceof Error ? e.message : "Disable failed" });
    } finally {
      setTwoFALoading(false);
    }
  }

  async function signOut() {
    const refreshToken = sessionStorage.getItem("refresh_token");

    // Tell the backend to revoke the refresh token
    if (refreshToken) {
      try {
        await fetch(`${API}/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
      } catch {
        // Ignore errors — clear session locally regardless
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

      <main>
        <h1>Today's Schedule</h1>
        <p>Here's what's on your plate for today.</p>
        <pre id="output">{output}</pre>

        <section className="security-section" style={{ marginTop: 32, padding: 24, border: "1px solid #333", borderRadius: 8 }}>
          <h2 style={{ marginTop: 0 }}>Security — Two-factor authentication</h2>
          {twoFAMessage && (
            <p style={{ color: twoFAMessage.type === "err" ? "#ff6b6b" : "#38d9a9", marginBottom: 12 }}>{twoFAMessage.text}</p>
          )}
          {(totpEnabled === null && email2FAEnabled === null) && <p>Loading…</p>}
          {(totpEnabled !== null || email2FAEnabled !== null) && (
          <>
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: "1rem", marginBottom: 8 }}>Authenticator app</h3>
            {totpEnabled === false && !twoFASetup && (
              <div>
                <p>Use Google Authenticator, Authy, etc. to get a 6-digit code at login.</p>
                <button type="button" onClick={start2FASetup} disabled={twoFALoading} className="submit-btn" style={{ marginTop: 8 }}>
                  Enable authenticator 2FA
                </button>
              </div>
            )}
            {twoFASetup && (
              <div>
                <p>Scan this QR code with your authenticator app, then enter the 6-digit code below.</p>
                <img
                  src={`data:image/png;base64,${String(twoFASetup.qr_base64).replace(/\s/g, "")}`}
                  alt="2FA QR - scan with authenticator app"
                  style={{ display: "block", margin: "12px 0", width: 180, height: 180, border: "1px solid #444" }}
                />
                <p style={{ fontSize: "0.85rem", color: "#888", marginTop: 8 }}>
                  Can&apos;t scan? Enter this secret manually in your app: <code style={{ userSelect: "all", padding: "2px 6px", background: "#222" }}>{twoFASetup.secret}</code>
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="000000"
                  maxLength={6}
                  value={twoFASetupCode}
                  onChange={(e) => setTwoFASetupCode(e.target.value.replace(/\D/g, ""))}
                  disabled={twoFALoading}
                  style={{ padding: 8, marginRight: 8, width: 100 }}
                />
                <button type="button" onClick={confirm2FASetup} disabled={twoFALoading || twoFASetupCode.length !== 6} className="submit-btn" style={{ marginRight: 8 }}>
                  Verify &amp; enable
                </button>
                <button type="button" onClick={() => { setTwoFASetup(null); setTwoFAMessage(null); }} disabled={twoFALoading} className="link-btn">
                  Cancel
                </button>
              </div>
            )}
            {totpEnabled === true && !twoFASetup && (
              <div>
                <p>Authenticator 2FA is <strong>on</strong>.</p>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Code to disable"
                  maxLength={6}
                  value={twoFADisableCode}
                  onChange={(e) => setTwoFADisableCode(e.target.value.replace(/\D/g, ""))}
                  disabled={twoFALoading}
                  style={{ padding: 8, marginRight: 8, width: 120 }}
                />
                <button type="button" onClick={disable2FA} disabled={twoFALoading || twoFADisableCode.length !== 6} className="submit-btn" style={{ background: "#666" }}>
                  Disable authenticator 2FA
                </button>
              </div>
            )}
          </div>

          <div>
            <h3 style={{ fontSize: "1rem", marginBottom: 8 }}>Email code</h3>
            {email2FAEnabled === false && (
              <div>
                <p>Receive a 6-digit code by email at login (uses the same email as in <code>email_utils.py</code>).</p>
                <button type="button" onClick={enableEmail2FA} disabled={twoFALoading} className="submit-btn" style={{ marginTop: 8 }}>
                  Enable email 2FA
                </button>
              </div>
            )}
            {email2FAEnabled === true && (
              <div>
                <p>Email 2FA is <strong>on</strong>. You can request a code at login.</p>
                <button type="button" onClick={disableEmail2FA} disabled={twoFALoading} className="submit-btn" style={{ background: "#666", marginTop: 8 }}>
                  Disable email 2FA
                </button>
              </div>
            )}
          </div>
          </>
          )}
        </section>
      </main>
    </>
  );
}
