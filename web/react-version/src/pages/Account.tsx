import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const API = "http://localhost:8000";

type Session = { email?: string; loginTime?: string };

type Profile = { fullName: string; email: string };

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function formatLoginTime(raw?: string) {
  if (!raw) return "Not available";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString();
}

function getAuthHeaders(): HeadersInit {
  const token = sessionStorage.getItem("access_token");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export default function Account() {
  const nav = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [savedProfile, setSavedProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Change password inline
  const [showChangePw, setShowChangePw] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);

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
    const t = sessionStorage.getItem("access_token");
    if (!raw || !t) { nav("/login", { replace: true }); return; }
    try {
      const s = JSON.parse(raw) as Session;
      setSession(s);
      const saved = localStorage.getItem("planner_profile");
      if (saved) {
        const p = JSON.parse(saved) as Profile;
        setSavedProfile(p);
        setFullName(p.fullName ?? "");
        setEmail(p.email ?? s.email ?? "");
      } else {
        setSavedProfile({ fullName: "", email: s.email ?? "" });
        setFullName("");
        setEmail(s.email ?? "");
      }
    } catch {
      sessionStorage.clear();
      nav("/login", { replace: true });
    }
  }, [nav]);

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

  useEffect(() => { if (session) fetch2FAStatus(); }, [session, fetch2FAStatus]);

  async function signOut() {
    const refreshToken = sessionStorage.getItem("refresh_token");
    if (refreshToken) {
      try {
        await fetch(`${API}/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
      } catch {}
    }
    sessionStorage.clear(); localStorage.clear();
    nav("/login", { replace: true });
  }

  function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setMsg(null);
    const cleanName = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return setErr("Email is required.");
    if (!isValidEmail(cleanEmail)) return setErr("Enter a valid email address.");
    setSaving(true);
    try {
      const nextProfile: Profile = { fullName: cleanName, email: cleanEmail };
      localStorage.setItem("planner_profile", JSON.stringify(nextProfile));
      setSavedProfile(nextProfile);
      const prevRaw = sessionStorage.getItem("planner_session");
      const prev = prevRaw ? (JSON.parse(prevRaw) as Session) : {};
      const nextSession: Session = { ...prev, email: cleanEmail };
      sessionStorage.setItem("planner_session", JSON.stringify(nextSession));
      if (localStorage.getItem("planner_session")) localStorage.setItem("planner_session", JSON.stringify(nextSession));
      setSession(nextSession);
      setMsg("Profile updated ✅");
      window.setTimeout(() => setMsg(null), 2200);
    } catch {
      setErr("Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwErr(null); setPwMsg(null);
    if (!currentPw) return setPwErr("Current password is required.");
    if (newPw.length < 8) return setPwErr("New password must be at least 8 characters.");
    if (!/[A-Z]/.test(newPw)) return setPwErr("New password must contain an uppercase letter.");
    if (!/[0-9]/.test(newPw)) return setPwErr("New password must contain a number.");
    if (newPw !== confirmPw) return setPwErr("Passwords do not match.");
    setPwSaving(true);
    try {
      const res = await fetch(`${API}/auth/change-password`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
      });
      const data = await res.json();
      if (!res.ok) { setPwErr(data.detail || "Password change failed."); return; }
      setPwMsg("Password changed successfully ✅");
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
      setTimeout(() => { setPwMsg(null); setShowChangePw(false); }, 2500);
    } catch {
      setPwErr("Could not connect to server.");
    } finally {
      setPwSaving(false);
    }
  }

  // 2FA actions
  async function start2FASetup() {
    setTwoFAMessage(null); setTwoFALoading(true);
    try {
      const res = await fetch(`${API}/auth/2fa/setup`, { method: "POST", headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Setup failed");
      setTwoFASetup({ qr_base64: data.qr_base64, secret: data.secret });
      setTwoFASetupCode("");
    } catch (e) {
      setTwoFAMessage({ type: "err", text: e instanceof Error ? e.message : "Setup failed" });
    } finally { setTwoFALoading(false); }
  }

  async function confirm2FASetup() {
    const code = twoFASetupCode.replace(/\D/g, "");
    if (code.length !== 6) { setTwoFAMessage({ type: "err", text: "Enter the 6-digit code." }); return; }
    setTwoFALoading(true); setTwoFAMessage(null);
    try {
      const res = await fetch(`${API}/auth/2fa/verify`, {
        method: "POST", headers: getAuthHeaders(), body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Verification failed");
      setTwoFAMessage({ type: "ok", text: "Authenticator 2FA is now enabled." });
      setTwoFASetup(null); setTwoFASetupCode(""); setTotpEnabled(true);
    } catch (e) {
      setTwoFAMessage({ type: "err", text: e instanceof Error ? e.message : "Invalid code." });
    } finally { setTwoFALoading(false); }
  }

  async function disable2FA() {
    const code = twoFADisableCode.replace(/\D/g, "");
    if (code.length !== 6) { setTwoFAMessage({ type: "err", text: "Enter your 6-digit code." }); return; }
    setTwoFALoading(true); setTwoFAMessage(null);
    try {
      const res = await fetch(`${API}/auth/2fa/disable`, {
        method: "POST", headers: getAuthHeaders(), body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Disable failed");
      setTwoFAMessage({ type: "ok", text: "Authenticator 2FA disabled." });
      setTwoFADisableCode(""); setTotpEnabled(false);
    } catch (e) {
      setTwoFAMessage({ type: "err", text: e instanceof Error ? e.message : "Invalid code." });
    } finally { setTwoFALoading(false); }
  }

  async function enableEmail2FA() {
    setTwoFALoading(true); setTwoFAMessage(null);
    try {
      const res = await fetch(`${API}/auth/2fa/enable-email`, { method: "POST", headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Enable failed");
      setTwoFAMessage({ type: "ok", text: "Email 2FA enabled." });
      setEmail2FAEnabled(true);
    } catch (e) {
      setTwoFAMessage({ type: "err", text: e instanceof Error ? e.message : "Enable failed" });
    } finally { setTwoFALoading(false); }
  }

  async function disableEmail2FA() {
    setTwoFALoading(true); setTwoFAMessage(null);
    try {
      const res = await fetch(`${API}/auth/2fa/disable-email`, { method: "POST", headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Disable failed");
      setTwoFAMessage({ type: "ok", text: "Email 2FA disabled." });
      setEmail2FAEnabled(false);
    } catch (e) {
      setTwoFAMessage({ type: "err", text: e instanceof Error ? e.message : "Disable failed" });
    } finally { setTwoFALoading(false); }
  }

  if (!session || !savedProfile) return null;

  const displayName = savedProfile.fullName?.trim() || session.email?.split("@")[0] || "User";
  const displayEmail = savedProfile.email?.trim() || session.email || "Not available";

  const twoFAAllOff = totpEnabled === false && email2FAEnabled === false;

  return (
    <>
      <header>
        <div className="brand">📋 PlannerHub</div>
        <div className="user-info">
          <span className="header-greeting">👋 {displayName}</span>
          <button className="ghost-btn" type="button" onClick={() => nav("/dashboard")}>Dashboard</button>
          <button className="signout-btn" onClick={signOut}>Sign Out</button>
        </div>
      </header>

      <main className="dash">
        <aside className="sidebar">
          <div className="side-title">Account</div>
          <button className="side-pill" type="button">Profile</button>
          <button className="side-link" type="button" onClick={() => setShowChangePw(v => !v)}>Change password</button>
          <button className="side-link side-link-danger" type="button" onClick={signOut}>Sign out</button>
        </aside>

        <div className="account-layout">
          {/* LEFT: Profile + Password */}
          <div className="account-main">
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h1 className="panel-title">Profile</h1>
                  <p className="panel-sub">Manage your account information.</p>
                </div>
              </div>

              {/* Profile info cards */}
              <div className="list" style={{ marginTop: 0 }}>
                <article className="task" style={{ alignItems: "center" }}>
                  <div>
                    <div className="task-title">Name</div>
                    <div className="task-meta" style={{ marginTop: 4 }}>{displayName}</div>
                  </div>
                </article>
                <article className="task" style={{ alignItems: "center" }}>
                  <div>
                    <div className="task-title">Email</div>
                    <div className="task-meta" style={{ marginTop: 4 }}>{displayEmail}</div>
                  </div>
                  <button className="ghost-btn" type="button" onClick={() => navigator.clipboard?.writeText(displayEmail)}>Copy</button>
                </article>
                <article className="task" style={{ alignItems: "center" }}>
                  <div>
                    <div className="task-title">Last login</div>
                    <div className="task-meta" style={{ marginTop: 4 }}>{formatLoginTime(session.loginTime)}</div>
                  </div>
                </article>
              </div>

              {/* Edit profile */}
              <div className="create" style={{ marginTop: 14 }}>
                <h2 className="section-heading">Edit profile</h2>
                {err && <div className="error">{err}</div>}
                {msg && <div className="success-notice">{msg}</div>}
                <form onSubmit={saveProfile} style={{ marginTop: 14 }}>
                  <div className="modal-row">
                    <div className="modal-field">
                      <label>Full name</label>
                      <input className="input" placeholder="Your name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={80} />
                    </div>
                    <div className="modal-field">
                      <label>Email</label>
                      <input className="input" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} />
                    </div>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <button className="primary-btn" type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
                  </div>
                </form>
              </div>
            </section>

            {/* Change Password (collapsible) */}
            {showChangePw && (
              <section className="panel" style={{ marginTop: 16 }}>
                <div className="panel-head">
                  <div>
                    <h2 className="panel-title" style={{ fontSize: "1.15rem" }}>Change Password</h2>
                    <p className="panel-sub">Update your password. Must be 8+ characters with uppercase and number.</p>
                  </div>
                  <button className="ghost-btn" onClick={() => setShowChangePw(false)}>✕ Close</button>
                </div>

                {pwErr && <div className="error">{pwErr}</div>}
                {pwMsg && <div className="success-notice">{pwMsg}</div>}

                <form onSubmit={changePassword} style={{ marginTop: 16 }}>
                  <div className="modal-field" style={{ marginBottom: 14 }}>
                    <label>Current password</label>
                    <div className="pw-input-wrap">
                      <input
                        className="input"
                        type={showCurrentPw ? "text" : "password"}
                        placeholder="••••••••"
                        value={currentPw}
                        onChange={(e) => setCurrentPw(e.target.value)}
                        disabled={pwSaving}
                      />
                      <button type="button" className="pw-toggle" onClick={() => setShowCurrentPw(v => !v)}>
                        {showCurrentPw ? "🙈" : "👁"}
                      </button>
                    </div>
                  </div>
                  <div className="modal-row">
                    <div className="modal-field">
                      <label>New password</label>
                      <div className="pw-input-wrap">
                        <input
                          className="input"
                          type={showNewPw ? "text" : "password"}
                          placeholder="Min. 8 characters"
                          value={newPw}
                          onChange={(e) => setNewPw(e.target.value)}
                          disabled={pwSaving}
                        />
                        <button type="button" className="pw-toggle" onClick={() => setShowNewPw(v => !v)}>
                          {showNewPw ? "🙈" : "👁"}
                        </button>
                      </div>
                    </div>
                    <div className="modal-field">
                      <label>Confirm new password</label>
                      <input
                        className="input"
                        type="password"
                        placeholder="Repeat password"
                        value={confirmPw}
                        onChange={(e) => setConfirmPw(e.target.value)}
                        disabled={pwSaving}
                      />
                    </div>
                  </div>
                  <div style={{ marginTop: 14 }}>
                    <button className="primary-btn" type="submit" disabled={pwSaving}>
                      {pwSaving ? "Changing…" : "Change password"}
                    </button>
                  </div>
                </form>
              </section>
            )}
          </div>

          {/* RIGHT: 2FA panel */}
          <div className="account-side">
            <section className="panel twofa-panel">
              <div className="twofa-panel-header">
                <h2 className="panel-title" style={{ fontSize: "1.1rem" }}>Two-Factor Auth</h2>
                {twoFAAllOff && <span className="twofa-badge twofa-badge-off">Off</span>}
                {!twoFAAllOff && (totpEnabled || email2FAEnabled) && <span className="twofa-badge twofa-badge-on">On</span>}
              </div>
              <p className="panel-sub" style={{ marginTop: 6, marginBottom: 16 }}>
                Add an extra layer of security to your account.
              </p>

              {twoFAMessage && (
                <div className={twoFAMessage.type === "err" ? "error" : "success-notice"} style={{ marginBottom: 14 }}>
                  {twoFAMessage.text}
                </div>
              )}

              {(totpEnabled === null && email2FAEnabled === null) && (
                <p className="panel-sub">Loading…</p>
              )}

              {(totpEnabled !== null || email2FAEnabled !== null) && (
                <>
                  {/* Authenticator */}
                  <div className="twofa-method">
                    <div className="twofa-method-header">
                      <span className="twofa-method-icon">📱</span>
                      <div>
                        <div className="twofa-method-name">Authenticator app</div>
                        <div className="twofa-method-status">
                          {totpEnabled ? <span className="status-on">● Enabled</span> : <span className="status-off">○ Disabled</span>}
                        </div>
                      </div>
                    </div>

                    {totpEnabled === false && !twoFASetup && (
                      <button className="twofa-enable-btn" onClick={start2FASetup} disabled={twoFALoading}>
                        {twoFALoading ? "Loading…" : "Enable"}
                      </button>
                    )}

                    {twoFASetup && (
                      <div className="twofa-setup">
                        <p style={{ fontSize: "0.82rem", color: "var(--muted)", marginBottom: 10 }}>
                          Scan with Google Authenticator, Authy, or similar:
                        </p>
                        <img
                          src={`data:image/png;base64,${String(twoFASetup.qr_base64).replace(/\s/g, "")}`}
                          alt="2FA QR Code"
                          style={{ width: 150, height: 150, border: "1px solid var(--border)", borderRadius: 8, display: "block", marginBottom: 10 }}
                        />
                        <p style={{ fontSize: "0.78rem", color: "var(--muted)", marginBottom: 10 }}>
                          Or enter manually: <code style={{ background: "var(--bg)", padding: "2px 5px", borderRadius: 4, userSelect: "all" }}>{twoFASetup.secret}</code>
                        </p>
                        <input
                          className="input twofa-code-input"
                          type="text"
                          inputMode="numeric"
                          placeholder="000000"
                          maxLength={6}
                          value={twoFASetupCode}
                          onChange={(e) => setTwoFASetupCode(e.target.value.replace(/\D/g, ""))}
                          disabled={twoFALoading}
                        />
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button className="primary-btn" style={{ flex: 1, fontSize: "0.85rem", padding: "8px 12px" }} onClick={confirm2FASetup} disabled={twoFALoading || twoFASetupCode.length !== 6}>
                            Verify & enable
                          </button>
                          <button className="ghost-btn" style={{ fontSize: "0.85rem" }} onClick={() => { setTwoFASetup(null); setTwoFAMessage(null); }} disabled={twoFALoading}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {totpEnabled === true && !twoFASetup && (
                      <div className="twofa-disable">
                        <input
                          className="input twofa-code-input"
                          type="text"
                          inputMode="numeric"
                          placeholder="Enter code to disable"
                          maxLength={6}
                          value={twoFADisableCode}
                          onChange={(e) => setTwoFADisableCode(e.target.value.replace(/\D/g, ""))}
                          disabled={twoFALoading}
                        />
                        <button
                          className="danger-btn"
                          style={{ width: "100%", marginTop: 8, fontSize: "0.85rem" }}
                          onClick={disable2FA}
                          disabled={twoFALoading || twoFADisableCode.length !== 6}
                        >
                          Disable authenticator
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Email 2FA */}
                  <div className="twofa-method" style={{ marginTop: 14 }}>
                    <div className="twofa-method-header">
                      <span className="twofa-method-icon">📧</span>
                      <div>
                        <div className="twofa-method-name">Email code</div>
                        <div className="twofa-method-status">
                          {email2FAEnabled ? <span className="status-on">● Enabled</span> : <span className="status-off">○ Disabled</span>}
                        </div>
                      </div>
                    </div>

                    {email2FAEnabled === false && (
                      <button className="twofa-enable-btn" onClick={enableEmail2FA} disabled={twoFALoading}>
                        {twoFALoading ? "Loading…" : "Enable"}
                      </button>
                    )}

                    {email2FAEnabled === true && (
                      <button
                        className="danger-btn"
                        style={{ width: "100%", marginTop: 8, fontSize: "0.85rem" }}
                        onClick={disableEmail2FA}
                        disabled={twoFALoading}
                      >
                        Disable email 2FA
                      </button>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
