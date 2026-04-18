import { Link } from "react-router-dom";
import PublicNav from "../components/PublicNav";

export default function Landing() {
  return (
    <div className="public-page">
      <PublicNav />

      <section className="landing-hero">
        <div className="landing-hero-inner">
          <span className="landing-badge">✨ Your personal productivity hub</span>
          <h1>Plan smarter.<br />Live better.</h1>
          <p>
            PlannerHub helps you organize tasks, schedule your day intelligently,
            and stay on top of what matters — all in one beautifully designed dashboard.
          </p>
          <div className="landing-hero-ctas">
            <Link to="/login" className="btn-primary">Get Started for Free →</Link>
            <Link to="/about" className="btn-secondary">Learn More</Link>
          </div>
        </div>
      </section>

      <section className="landing-features">
        <p className="section-label">Features</p>
        <h2 className="section-title">Everything you need<br />to stay on track</h2>
        <p className="section-subtitle">
          From flexible task scheduling to smart prioritization, PlannerHub gives you
          the tools to take control of your time.
        </p>
        <div className="features-grid">
          <div className="feature-card">
            <span className="feature-icon">📅</span>
            <h3>Smart Scheduling</h3>
            <p>Set deadlines, flexible blocks, or fixed times. PlannerHub adapts to how you actually work.</p>
          </div>
          <div className="feature-card">
            <span className="feature-icon">🎯</span>
            <h3>Priority Management</h3>
            <p>Rank tasks by importance and energy level so you always know what to tackle first.</p>
          </div>
          <div className="feature-card">
            <span className="feature-icon">🔄</span>
            <h3>Recurring Tasks</h3>
            <p>Set it and forget it. Define daily, weekly, or custom recurrence patterns with ease.</p>
          </div>
          <div className="feature-card">
            <span className="feature-icon">📊</span>
            <h3>Calendar Views</h3>
            <p>Switch between month, week, and agenda views to plan at whatever scale you need.</p>
          </div>
        </div>
      </section>

      <section className="landing-cta-section">
        <div className="landing-cta-box">
          <h2>Ready to take control of your time?</h2>
          <p>Join PlannerHub and start organizing your tasks, goals, and schedule in one place.</p>
          <Link to="/login" className="btn-primary">Get Started — it's free</Link>
        </div>
      </section>

      <footer className="public-footer">
        <div className="public-footer-inner">
          <Link to="/" className="public-footer-logo">📋 PlannerHub</Link>
          <div className="public-footer-links">
            <Link to="/about">About</Link>
            <Link to="/team">Meet the Team</Link>
            <Link to="/login">Login</Link>
          </div>
          <span className="public-footer-copy">© 2026 PlannerHub</span>
        </div>
      </footer>
    </div>
  );
}
