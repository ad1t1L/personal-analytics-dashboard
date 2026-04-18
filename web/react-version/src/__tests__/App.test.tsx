import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../App.tsx";

// Mock all page components so we never trigger real API calls
vi.mock("../pages/Login.tsx", () => ({
  default: () => <div data-testid="login-page">Login Page</div>,
}));
vi.mock("../pages/Dashboard.tsx", () => ({
  default: () => <div data-testid="dashboard-page">Dashboard Page</div>,
}));
vi.mock("../pages/ForgotPassword.tsx", () => ({
  default: () => <div data-testid="forgot-password-page">Forgot Password Page</div>,
}));
vi.mock("../pages/ResetPassword.tsx", () => ({
  default: () => <div data-testid="reset-password-page">Reset Password Page</div>,
}));
vi.mock("../pages/Account.tsx", () => ({
  default: () => <div data-testid="account-page">Account Page</div>,
}));
vi.mock("../pages/TauriFloatingWidget.tsx", () => ({
  default: () => <div data-testid="widget-page">Widget</div>,
}));
vi.mock("../pages/Landing.tsx", () => ({
  default: () => <div data-testid="landing-page">Landing Page</div>,
}));
vi.mock("../pages/About.tsx", () => ({
  default: () => <div data-testid="about-page">About Page</div>,
}));
vi.mock("../pages/MeetTheTeam.tsx", () => ({
  default: () => <div data-testid="team-page">Meet the Team Page</div>,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

beforeEach(() => {
  sessionStorage.clear();
});

// ── Route rendering ───────────────────────────────────────────────────────────

describe("App routing", () => {
  it("renders Landing page at /", () => {
    renderAt("/");
    expect(screen.getByTestId("landing-page")).toBeInTheDocument();
  });

  it("renders About page at /about", () => {
    renderAt("/about");
    expect(screen.getByTestId("about-page")).toBeInTheDocument();
  });

  it("renders Meet the Team page at /team", () => {
    renderAt("/team");
    expect(screen.getByTestId("team-page")).toBeInTheDocument();
  });

  it("renders Login page at /login", () => {
    renderAt("/login");
    expect(screen.getByTestId("login-page")).toBeInTheDocument();
  });

  it("renders ForgotPassword page at /forgot-password", () => {
    renderAt("/forgot-password");
    expect(screen.getByTestId("forgot-password-page")).toBeInTheDocument();
  });

  it("renders ResetPassword page at /reset-password", () => {
    renderAt("/reset-password");
    expect(screen.getByTestId("reset-password-page")).toBeInTheDocument();
  });

  it("renders Account page at /account", () => {
    renderAt("/account");
    expect(screen.getByTestId("account-page")).toBeInTheDocument();
  });
});

// ── Protected route ───────────────────────────────────────────────────────────

describe("App protected route", () => {
  it("redirects /dashboard to /login when no access_token", () => {
    renderAt("/dashboard");
    expect(screen.getByTestId("login-page")).toBeInTheDocument();
  });

  it("renders Dashboard when access_token is in sessionStorage", () => {
    sessionStorage.setItem("access_token", "mock_token");
    renderAt("/dashboard");
    expect(screen.getByTestId("dashboard-page")).toBeInTheDocument();
  });

  it("renders Landing page at / even when authenticated", () => {
    sessionStorage.setItem("access_token", "mock_token");
    renderAt("/");
    expect(screen.getByTestId("landing-page")).toBeInTheDocument();
  });
});

// ── Unknown routes ────────────────────────────────────────────────────────────

describe("App unknown routes", () => {
  it("redirects unknown paths to Landing page", () => {
    renderAt("/totally/unknown/path");
    expect(screen.getByTestId("landing-page")).toBeInTheDocument();
  });

  it("redirects unknown paths to Landing page when authenticated", () => {
    sessionStorage.setItem("access_token", "mock_token");
    renderAt("/unknown");
    expect(screen.getByTestId("landing-page")).toBeInTheDocument();
  });
});
