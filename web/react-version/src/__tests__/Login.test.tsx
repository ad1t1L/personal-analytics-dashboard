import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Login from "../pages/Login.tsx";

vi.mock("../tauriWidgetBridge.ts", () => ({
  syncTauriWidgetToken: vi.fn().mockResolvedValue(undefined),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Login />
    </MemoryRouter>
  );
}

function submitBtn() {
  return document.querySelector("button[type='submit']") as HTMLElement;
}

function successfulLoginResponse() {
  return {
    ok: true,
    json: async () => ({
      access_token: "access_abc",
      refresh_token: "refresh_abc",
      token_type: "bearer",
    }),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  sessionStorage.clear();
  localStorage.clear();
});

// ── Rendering ─────────────────────────────────────────────────────────────────

describe("Login page rendering", () => {
  it("shows the sign-in tab by default", () => {
    renderLogin();
    expect(screen.getByText("Welcome back 👋")).toBeInTheDocument();
  });

  it("shows both tab buttons", () => {
    renderLogin();
    const tabs = document.querySelectorAll(".tab-btn");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveTextContent("Sign In");
    expect(tabs[1]).toHaveTextContent("Create Account");
  });

  it("shows email and password inputs on sign-in tab", () => {
    renderLogin();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("switches to signup tab on clicking Create Account", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole("button", { name: "Create Account" }));
    expect(screen.getByText("Create account")).toBeInTheDocument();
    expect(screen.getByLabelText("Full Name")).toBeInTheDocument();
  });

  it("switches back to login tab", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole("button", { name: "Create Account" }));
    // On signup tab: "Sign In" tab button is unique (submit says "Create Account")
    await user.click(screen.getByRole("button", { name: "Sign In" }));
    expect(screen.getByText("Welcome back 👋")).toBeInTheDocument();
  });
});

// ── Login validation ──────────────────────────────────────────────────────────

describe("Login form validation", () => {
  it("shows error when email is empty on submit", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(submitBtn());
    await waitFor(() => {
      const emailField = screen.getByLabelText("Email").closest(".field");
      expect(emailField).toHaveClass("invalid");
    });
  });

  it("shows error when password is empty on submit", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.click(submitBtn());
    await waitFor(() => {
      const passField = screen.getByLabelText("Password").closest(".field");
      expect(passField).toHaveClass("invalid");
    });
  });

  it("shows toast when required fields are empty", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(submitBtn());
    await waitFor(() => {
      expect(screen.getByText("Please fill in all required fields.")).toBeInTheDocument();
    });
  });

  it("does not call fetch when fields are empty", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(submitBtn());
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── Login API responses ───────────────────────────────────────────────────────

describe("Login API responses", () => {
  it("stores tokens and shows success screen on successful login", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce(successfulLoginResponse());
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Password"), "Password1");
    await user.click(submitBtn());

    await waitFor(() => {
      expect(sessionStorage.getItem("access_token")).toBe("access_abc");
      expect(sessionStorage.getItem("refresh_token")).toBe("refresh_abc");
    });
    await waitFor(() => {
      expect(screen.getByText("You're in!")).toBeInTheDocument();
    });
  });

  it("stores tokens in localStorage when remember me is checked", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce(successfulLoginResponse());
    renderLogin();

    await user.click(screen.getByLabelText("Remember me"));
    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Password"), "Password1");
    await user.click(submitBtn());

    await waitFor(() => {
      expect(localStorage.getItem("access_token")).toBe("access_abc");
    });
  });

  it("shows error toast and marks password field invalid on 401", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ detail: "Incorrect email or password" }),
    });
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Password"), "wrongpass");
    await user.click(submitBtn());

    await waitFor(() => {
      // Toast shows "Incorrect email or password. N attempts remaining."
      expect(screen.getByText(/attempts remaining/i)).toBeInTheDocument();
    });
    const passField = screen.getByLabelText("Password").closest(".field");
    expect(passField).toHaveClass("invalid");
  });

  it("shows verify email warning on 403", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ detail: "Please verify your email" }),
    });
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "unverified@example.com");
    await user.type(screen.getByLabelText("Password"), "Password1");
    await user.click(submitBtn());

    await waitFor(() => {
      expect(screen.getByText(/verify your email/i)).toBeInTheDocument();
    });
  });

  it("shows lockout bar after 5 failed attempts", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: "Incorrect email or password" }),
    });
    renderLogin();

    for (let i = 0; i < 5; i++) {
      await user.clear(screen.getByLabelText("Email"));
      await user.clear(screen.getByLabelText("Password"));
      await user.type(screen.getByLabelText("Email"), "u@example.com");
      await user.type(screen.getByLabelText("Password"), "wrongpass");
      await user.click(submitBtn());
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(i + 1));
    }

    await waitFor(() => {
      // Lockout bar gets class "show" after 5 failures
      expect(document.querySelector(".lockout-bar")).toHaveClass("show");
    });
  });

  it("shows 2FA step when server returns 2fa_pending", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "",
        refresh_token: "pending_jwt",
        token_type: "2fa_pending",
      }),
    });
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Password"), "Password1");
    await user.click(submitBtn());

    await waitFor(() => {
      expect(screen.getByText("Two-factor authentication")).toBeInTheDocument();
    });
  });
});

// ── 2FA step ─────────────────────────────────────────────────────────────────

describe("2FA step", () => {
  async function reach2FA() {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "",
        refresh_token: "pending_jwt",
        token_type: "2fa_pending",
      }),
    });
    renderLogin();
    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Password"), "Password1");
    await user.click(submitBtn());
    await waitFor(() => expect(screen.getByLabelText("Verification code")).toBeInTheDocument());
    return user;
  }

  it("Verify button disabled when code is fewer than 6 digits", async () => {
    const user = await reach2FA();
    await user.type(screen.getByLabelText("Verification code"), "12345");
    expect(screen.getByRole("button", { name: /verify/i })).toBeDisabled();
  });

  it("Verify button enabled with exactly 6 digits", async () => {
    const user = await reach2FA();
    await user.type(screen.getByLabelText("Verification code"), "123456");
    expect(screen.getByRole("button", { name: /verify/i })).not.toBeDisabled();
  });

  it("shows error when 2FA code submit fails", async () => {
    const user = await reach2FA();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ detail: "Invalid or expired code." }),
    });
    await user.type(screen.getByLabelText("Verification code"), "000000");
    await user.click(screen.getByRole("button", { name: /verify/i }));
    await waitFor(() => {
      expect(screen.getByText("Invalid or expired code.")).toBeInTheDocument();
    });
  });

  it("back button returns to sign-in form", async () => {
    const user = await reach2FA();
    await user.click(screen.getByRole("button", { name: /back to sign in/i }));
    expect(screen.getByText("Welcome back 👋")).toBeInTheDocument();
  });
});

// ── Signup validation ─────────────────────────────────────────────────────────

describe("Signup form validation", () => {
  async function goToSignup() {
    const user = userEvent.setup();
    renderLogin();
    // On login tab, "Create Account" button is unique (submit says "Sign In")
    await user.click(screen.getByRole("button", { name: "Create Account" }));
    return user;
  }

  it("empty name marks field invalid", async () => {
    const user = await goToSignup();
    await user.type(screen.getByLabelText("Email Address"), "a@a.com");
    await user.type(screen.getByLabelText("Password"), "Password1");
    await user.type(screen.getByLabelText("Confirm Password"), "Password1");
    await user.click(submitBtn());
    await waitFor(() => {
      expect(screen.getByLabelText("Full Name").closest(".field")).toHaveClass("invalid");
    });
  });

  it("invalid email marks field invalid", async () => {
    const user = await goToSignup();
    await user.type(screen.getByLabelText("Full Name"), "Alex");
    await user.type(screen.getByLabelText("Email Address"), "notanemail");
    await user.type(screen.getByLabelText("Password"), "Password1");
    await user.type(screen.getByLabelText("Confirm Password"), "Password1");
    await user.click(submitBtn());
    await waitFor(() => {
      expect(screen.getByLabelText("Email Address").closest(".field")).toHaveClass("invalid");
    });
  });

  it("password shorter than 8 chars marks field invalid", async () => {
    const user = await goToSignup();
    await user.type(screen.getByLabelText("Full Name"), "Alex");
    await user.type(screen.getByLabelText("Email Address"), "a@a.com");
    await user.type(screen.getByLabelText("Password"), "Pass1");
    await user.type(screen.getByLabelText("Confirm Password"), "Pass1");
    await user.click(submitBtn());
    await waitFor(() => {
      expect(screen.getByText("Password must be at least 8 characters")).toBeVisible();
    });
  });

  it("password without uppercase marks field invalid", async () => {
    const user = await goToSignup();
    await user.type(screen.getByLabelText("Full Name"), "Alex");
    await user.type(screen.getByLabelText("Email Address"), "a@a.com");
    await user.type(screen.getByLabelText("Password"), "password1");
    await user.type(screen.getByLabelText("Confirm Password"), "password1");
    await user.click(submitBtn());
    await waitFor(() => {
      expect(screen.getByText("Password must contain at least one uppercase letter")).toBeVisible();
    });
  });

  it("password without number marks field invalid", async () => {
    const user = await goToSignup();
    await user.type(screen.getByLabelText("Full Name"), "Alex");
    await user.type(screen.getByLabelText("Email Address"), "a@a.com");
    await user.type(screen.getByLabelText("Password"), "Passwordonly");
    await user.type(screen.getByLabelText("Confirm Password"), "Passwordonly");
    await user.click(submitBtn());
    await waitFor(() => {
      expect(screen.getByText("Password must contain at least one number")).toBeVisible();
    });
  });

  it("mismatched passwords marks confirm field invalid", async () => {
    const user = await goToSignup();
    await user.type(screen.getByLabelText("Full Name"), "Alex");
    await user.type(screen.getByLabelText("Email Address"), "a@a.com");
    await user.type(screen.getByLabelText("Password"), "Password1");
    await user.type(screen.getByLabelText("Confirm Password"), "Different1");
    await user.click(submitBtn());
    await waitFor(() => {
      expect(screen.getByLabelText("Confirm Password").closest(".field")).toHaveClass("invalid");
    });
  });

  it("shows error toast when signup fields are invalid", async () => {
    const user = await goToSignup();
    await user.click(submitBtn());
    await waitFor(() => {
      expect(screen.getByText("Please correct the errors above.")).toBeInTheDocument();
    });
  });

  it("does not call fetch when signup fields are invalid", async () => {
    const user = await goToSignup();
    await user.click(submitBtn());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows success screen after successful signup", async () => {
    const user = await goToSignup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: "Account created." }),
    });

    await user.type(screen.getByLabelText("Full Name"), "Alex");
    await user.type(screen.getByLabelText("Email Address"), "alex@example.com");
    await user.type(screen.getByLabelText("Password"), "Password1");
    await user.type(screen.getByLabelText("Confirm Password"), "Password1");
    await user.click(submitBtn());

    await waitFor(() => {
      expect(screen.getByText("Account created!")).toBeInTheDocument();
    });
  });
});

// ── Password strength meter ───────────────────────────────────────────────────

describe("Password strength meter", () => {
  it("is hidden when password field is empty", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole("button", { name: "Create Account" }));
    const strengthBar = document.querySelector(".strength-bar");
    expect(strengthBar).not.toHaveClass("show");
  });

  it("appears when password is typed", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole("button", { name: "Create Account" }));
    await user.type(screen.getByLabelText("Password"), "abc");
    const strengthBar = document.querySelector(".strength-bar");
    expect(strengthBar).toHaveClass("show");
  });

  it("shows Good label for a fully-scored password (all 4 criteria met)", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole("button", { name: "Create Account" }));
    await user.type(screen.getByLabelText("Password"), "Str0ng@Pass!");
    // Max score=4 (length/upper/digit/special) → maps to "Good"; "Strong 💪" is unreachable
    expect(await screen.findByText("Good")).toBeInTheDocument();
  });
});
