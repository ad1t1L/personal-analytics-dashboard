import { Link } from "react-router-dom";
import PublicNav from "../components/PublicNav";

// Update name, role, and bio for each team member
const TEAM_MEMBERS = [
  {
    name: "Leo Sokolyuk",
    role: "Full Stack Developer",
    bio: "Passionate about building clean, user-friendly web applications.",
    initials: "LS",
    gradient: "linear-gradient(135deg, #6c63ff, #38d9a9)",
  },
  {
    name: "Amir Mohamed",
    role: "Frontend Developer",
    bio: "Focused on crafting smooth, responsive UI experiences users love.",
    initials: "AM",
    gradient: "linear-gradient(135deg, #ff6b9d, #6c63ff)",
  },
  {
    name: "Sairam Veerasurla",
    role: "Backend Developer",
    bio: "Builds reliable APIs and services that keep everything running smoothly.",
    initials: "SV",
    gradient: "linear-gradient(135deg, #38d9a9, #3a86ff)",
  },
  {
    name: "Daniel Zbodula",
    role: "UI/UX Designer",
    bio: "Turns complex problems into simple, intuitive product experiences.",
    initials: "DZ",
    gradient: "linear-gradient(135deg, #ffa94d, #ff6b6b)",
  },
  {
    name: "Aditi Lakshminarayanan",
    role: "Full Stack Developer",
    bio: "Loves connecting the dots between great design and solid engineering.",
    initials: "AL",
    gradient: "linear-gradient(135deg, #3a86ff, #6c63ff)",
  }
];

export default function MeetTheTeam() {
  return (
    <div className="public-page">
      <PublicNav />

      <div className="team-hero">
        <p className="section-label">Meet the Team</p>
        <h1 className="section-title">The people behind PlannerHub</h1>
        <p className="team-hero-sub">
          We're a team of students from ITSC 4155 who built PlannerHub to make
          personal productivity genuinely better.
        </p>
      </div>

      <div className="team-content">
        <div className="team-grid">
          {TEAM_MEMBERS.map((member, i) => (
            <div className="team-card" key={i}>
              <div
                className="team-avatar"
                style={{ background: member.gradient }}
              >
                {member.initials}
              </div>
              <h3>{member.name}</h3>
              <p className="team-role">{member.role}</p>
              <p>{member.bio}</p>
            </div>
          ))}
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