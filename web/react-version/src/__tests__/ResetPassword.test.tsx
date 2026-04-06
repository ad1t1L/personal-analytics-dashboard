import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ResetPassword from "../pages/ResetPassword.tsx";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function renderWithToken(token?: string) {
  const path = token
    ? `/reset-password?token=${token}`
    : "/reset-password";
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/forgot-password" element={<div>Forgot Password Page</div>} />
        <Route path="/login" element={<div>Login Page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ── Missing token ──────────────────────────────���────────────────────────���─────

describe("ResetPassword — missing token", () => {
  it("shows invalid link screen when no token in URL", () => {
    renderWithToken();
    expect(screen.getByText("Invalid link")).toBeInTheDocument();
  });

  it("shows request new link button when token is missing", () => {
    renderWithToken();
    expect(screen.getByRole("button", { name: /request new link/i })).toBeInTheDocument();
  });
});

// ── Rendering with token ──────────────────────────��───────────────────────────

describe("ResetPassword — with valid token URL", () => {
  it("renders the new password form", () => {
    renderWithToken("abc123");
    expect(screen.getByLabelText("New Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm Password")).toBeInTheDocument();
  });

  it("renders the Reset Password button", () => {
    renderWithToken("abc123");
    expect(screen.getByRole("button", { name: /reset password/i })).toBeInTheDocument();
  });
});

// ── Client-side validation ───────────────────────────���────────────────────────

describe("ResetPassword validation", () => {
  it("shows error when password is too short", async () => {
    const user = userEvent.setup();
    renderWithToken("tok123");
    await user.type(screen.getByLabelText("New Password"), "Short1");
    await user.type(screen.getByLabelText("Confirm Password"), "Short1");
    await user.click(screen.getByRole("button", { name: /reset password/i }));
    await waitFor(() => {
      expect(screen.getByText("Password must be at least 8 characters.")).toBeInTheDocument();
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows error when password has no uppercase letter", async () => {
    const user = userEvent.setup();
    renderWithToken("tok123");
    await user.type(screen.getByLabelText("New Password"), "nouppercase1");
    await user.type(screen.getByLabelText("Confirm Password"), "nouppercase1");
    await user.click(screen.getByRole("button", { name: /reset password/i }));
    await waitFor(() => {
      expect(screen.getByText("Password must contain at least one uppercase letter.")).toBeInTheDocument();
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows error when password has no number", async () => {
    const user = userEvent.setup();
    renderWithToken("tok123");
    await user.type(screen.getByLabelText("New Password"), "NoNumbers!");
    await user.type(screen.getByLabelText("Confirm Password"), "NoNumbers!");
    await user.click(screen.getByRole("button", { name: /reset password/i }));
    await waitFor(() => {
      expect(screen.getByText("Password must contain at least one number.")).toBeInTheDocument();
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows error when passwords do not match", async () => {
    const user = userEvent.setup();
    renderWithToken("tok123");
    await user.type(screen.getByLabelText("New Password"), "Password1");
    await user.type(screen.getByLabelText("Confirm Password"), "Different1");
    await user.click(screen.getByRole("button", { name: /reset password/i }));
    await waitFor(() => {
      expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── API call ─────────────────────────────���─────────────────────────────��──────

describe("ResetPassword API call", () => {
  it("sends token and new password to the API", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    renderWithToken("my_reset_token");

    await user.type(screen.getByLabelText("New Password"), "NewPass1");
    await user.type(screen.getByLabelText("Confirm Password"), "NewPass1");
    await user.click(screen.getByRole("button", { name: /reset password/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body).toEqual({ token: "my_reset_token", password: "NewPass1" });
  });

  it("shows success screen after successful reset", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    renderWithToken("tok123");

    await user.type(screen.getByLabelText("New Password"), "NewPass1");
    await user.type(screen.getByLabelText("Confirm Password"), "NewPass1");
    await user.click(screen.getByRole("button", { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByText("Password updated!")).toBeInTheDocument();
    });
  });

  it("shows API error message on failed reset", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ detail: "Reset link has expired." }),
    });
    renderWithToken("expired_token");

    await user.type(screen.getByLabelText("New Password"), "NewPass1");
    await user.type(screen.getByLabelText("Confirm Password"), "NewPass1");
    await user.click(screen.getByRole("button", { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByText("Reset link has expired.")).toBeInTheDocument();
    });
  });

  it("shows connection error when fetch rejects", async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));
    renderWithToken("tok123");

    await user.type(screen.getByLabelText("New Password"), "NewPass1");
    await user.type(screen.getByLabelText("Confirm Password"), "NewPass1");
    await user.click(screen.getByRole("button", { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByText(/could not connect/i)).toBeInTheDocument();
    });
  });
});

// ── Password visibility toggle ────────────────────────────────────────────────

describe("ResetPassword password toggle", () => {
  it("new password input starts as type=password", () => {
    renderWithToken("tok123");
    expect(screen.getByLabelText("New Password")).toHaveAttribute("type", "password");
  });

  it("clicking the eye icon reveals the password", async () => {
    const user = userEvent.setup();
    renderWithToken("tok123");
    const toggleBtns = screen.getAllByRole("button", { name: /👁|🙈/ });
    await user.click(toggleBtns[0]);
    expect(screen.getByLabelText("New Password")).toHaveAttribute("type", "text");
  });
});

// ── Strength meter ──────────────────────────────────────────────────���─────────

describe("ResetPassword strength meter", () => {
  it("strength meter hidden when password is empty", () => {
    renderWithToken("tok123");
    const strengthBar = document.querySelector(".strength-bar");
    expect(strengthBar).not.toHaveClass("show");
  });

  it("strength meter visible when password is typed", async () => {
    const user = userEvent.setup();
    renderWithToken("tok123");
    await user.type(screen.getByLabelText("New Password"), "abc");
    expect(document.querySelector(".strength-bar")).toHaveClass("show");
  });
});
