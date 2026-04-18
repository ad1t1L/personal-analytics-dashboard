import { Link, useLocation } from "react-router-dom";

export default function PublicNav() {
  const { pathname } = useLocation();
  return (
    <nav className="public-nav">
      <div className="public-nav-inner">
        <Link to="/" className="public-nav-logo">📋 PlannerHub</Link>
        <div className="public-nav-links">
          <Link
            to="/about"
            className={`public-nav-link${pathname === "/about" ? " active" : ""}`}
          >
            About
          </Link>
          <Link
            to="/team"
            className={`public-nav-link${pathname === "/team" ? " active" : ""}`}
          >
            Meet the Team
          </Link>
          <Link to="/login" className="public-nav-cta">Login</Link>
        </div>
      </div>
    </nav>
  );
}
