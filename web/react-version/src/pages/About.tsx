import { Link } from "react-router-dom";
import PublicNav from "../components/PublicNav";

export default function About() {
  return (
    <div className="public-page">
      <PublicNav />

      <div className="about-hero">
        <p className="section-label">About Us</p>
        <h1 className="section-title">Built for the way you work</h1>
        <p className="about-hero-sub">
          PlannerHub was created to make personal productivity simple, flexible, and
          actually enjoyable — not another task tracker you abandon after a week.
        </p>
      </div>

      <div className="about-content">
        <div className="about-section">
          <p className="section-label">Our Mission</p>
          <h2 className="section-title">Helping you do more of what matters</h2>
          <p>
            We believe productivity tools should work around your life, not the other way around.
            PlannerHub gives you a flexible, intelligent way to manage your tasks — whether you're
            planning your week, staying on top of deadlines, or just trying to remember what needs
            to get done today.
          </p>
          <p>
            Every feature in PlannerHub is designed with real users in mind: flexible scheduling,
            smart prioritization, and a clean interface that gets out of your way so you can
            focus on what actually matters.
          </p>
        </div>

        <div className="about-section">
          <p className="section-label">Our Values</p>
          <h2 className="section-title">What we stand for</h2>
          <div className="about-values-grid">
            <div className="value-card">
              <h4>Simplicity</h4>
              <p>Powerful features without unnecessary complexity. If it doesn't help you get things done, it doesn't ship.</p>
            </div>
            <div className="value-card">
              <h4>Flexibility</h4>
              <p>Your schedule is unique. PlannerHub adapts to how you work, not the other way around.</p>
            </div>
            <div className="value-card">
              <h4>Transparency</h4>
              <p>No dark patterns, no surprise fees. We build tools we'd want to use ourselves.</p>
            </div>
            <div className="value-card">
              <h4>User-First</h4>
              <p>Every decision is made with the end user in mind. Your time is valuable — we treat it that way.</p>
            </div>
          </div>
        </div>

        <div className="about-section about-cta">
          <h2 className="section-title">Want to meet the people behind PlannerHub?</h2>
          <p className="about-cta-sub">
            PlannerHub was built by a team of students passionate about productivity
            and great software design.
          </p>
          <Link to="/team" className="btn-primary">Meet the Team →</Link>
        </div>
      </div>

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
