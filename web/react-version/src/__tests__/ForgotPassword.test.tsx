import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ForgotPassword from "../pages/ForgotPassword.tsx";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/forgot-password"]}>
      <ForgotPassword />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ── Rendering ─────────────────────────────────────────────────────────────────

describe("ForgotPassword rendering", () => {
  it("renders the email input", () => {
    renderPage();
    expect(screen.getByLabelText("Email Address")).toBeInTheDocument();
  });

  it("renders the Send Reset Link button", () => {
    renderPage();
    expect(screen.getByRole("button", { name: /send reset link/i })).toBeInTheDocument();
  });
});

// ── Validation ────────────────────────────────────────────────────────────────

describe("ForgotPassword validation", () => {
  it("shows error when email is empty on submit", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => {
      expect(screen.getByText("Please enter your email address.")).toBeInTheDocument();
    });
  });

  it("does not call fetch when email is empty", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /send reset link/i }));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls fetch with correct payload when email is provided", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: "If registered, a link was sent." }),
    });
    renderPage();
    await user.type(screen.getByLabelText("Email Address"), "user@example.com");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/auth/forgot-password");
    expect(JSON.parse(opts.body as string)).toEqual({ email: "user@example.com" });
  });

  it("trims whitespace from email before sending", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    renderPage();
    await user.type(screen.getByLabelText("Email Address"), "  spaced@example.com  ");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.email).toBe("spaced@example.com");
  });
});

// ── Success state ─────────────────────────────────────────────────────────────

describe("ForgotPassword success state", () => {
  it("shows success screen after successful submit", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    renderPage();
    await user.type(screen.getByLabelText("Email Address"), "user@example.com");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => {
      expect(screen.getByText("Check your inbox!")).toBeInTheDocument();
    });
  });

  it("shows the submitted email in the success screen", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    renderPage();
    await user.type(screen.getByLabelText("Email Address"), "myemail@example.com");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => {
      expect(screen.getByText(/myemail@example\.com/)).toBeInTheDocument();
    });
  });
});

// ── Error state ───────────────────────────────────────────────────────────────

describe("ForgotPassword error state", () => {
  it("shows error when fetch rejects (network failure)", async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    renderPage();
    await user.type(screen.getByLabelText("Email Address"), "user@example.com");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => {
      expect(screen.getByText(/could not connect/i)).toBeInTheDocument();
    });
  });

  it("shows detail from API when response is not ok", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ detail: "Rate limit exceeded." }),
    });
    renderPage();
    await user.type(screen.getByLabelText("Email Address"), "user@example.com");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => {
      expect(screen.getByText("Rate limit exceeded.")).toBeInTheDocument();
    });
  });
});
