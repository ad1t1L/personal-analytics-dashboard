import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TasksAtAGlanceWidget, { type GlanceTask } from "../components/TasksAtAGlanceWidget.tsx";

// Fix today's date so deadline comparisons are deterministic
const FIXED_TODAY = "2026-04-05";
const FIXED_DATE = new Date("2026-04-05T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_DATE);
});

afterEach(() => {
  vi.useRealTimers();
});

function makeTask(overrides: Partial<GlanceTask> & { id: number; title: string }): GlanceTask {
  return {
    duration_minutes: 30,
    deadline: null,
    importance: 3,
    completed: false,
    ...overrides,
  };
}

const noopClose = vi.fn();

function renderWidget(
  tasks: GlanceTask[],
  { open = true, loading = false } = {}
) {
  return render(
    <TasksAtAGlanceWidget
      open={open}
      onClose={noopClose}
      tasks={tasks}
      loading={loading}
    />
  );
}

// ── Open / closed ─────────────────────────────────────────────────────────────

describe("TasksAtAGlanceWidget open/closed", () => {
  it("renders nothing when open=false", () => {
    const { container } = renderWidget([], { open: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the panel when open=true", () => {
    renderWidget([]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

// ── Loading state ─────────────────────────────────────────────────────────────

describe("TasksAtAGlanceWidget loading state", () => {
  it("shows loading message when loading=true", () => {
    renderWidget([], { loading: true });
    expect(screen.getByText("Loading your tasks…")).toBeInTheDocument();
  });

  it("subtitle shows Loading… when loading", () => {
    renderWidget([], { loading: true });
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });
});

// ── Empty state ───────────────────────────────────────────────────────────────

describe("TasksAtAGlanceWidget empty state", () => {
  it("shows all-caught-up message when no tasks", () => {
    renderWidget([]);
    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
  });

  it("shows all-caught-up when all tasks are completed", () => {
    renderWidget([
      makeTask({ id: 1, title: "Done task", completed: true }),
    ]);
    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
  });

  it("shows 0 open in subtitle when no open tasks", () => {
    renderWidget([]);
    expect(screen.getByText(/0 open/)).toBeInTheDocument();
  });
});

// ── Task sections ─────────────────────────────────────────────────────────────

describe("TasksAtAGlanceWidget sections", () => {
  it("shows 'Needs attention' section for overdue tasks", () => {
    renderWidget([
      makeTask({ id: 1, title: "Overdue task", deadline: "2026-04-04" }),
    ]);
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText("Overdue task")).toBeInTheDocument();
  });

  it("shows 'Due today' section for tasks due today", () => {
    renderWidget([
      makeTask({ id: 1, title: "Today task", deadline: FIXED_TODAY }),
    ]);
    expect(screen.getByText("Due today")).toBeInTheDocument();
    expect(screen.getByText("Today task")).toBeInTheDocument();
  });

  it("shows 'Next 7 days' section for tasks due within the week", () => {
    renderWidget([
      makeTask({ id: 1, title: "This week task", deadline: "2026-04-10" }),
    ]);
    expect(screen.getByText("Next 7 days")).toBeInTheDocument();
    expect(screen.getByText("This week task")).toBeInTheDocument();
  });

  it("shows 'Later' section for tasks due after 7 days", () => {
    renderWidget([
      makeTask({ id: 1, title: "Later task", deadline: "2026-05-01" }),
    ]);
    expect(screen.getByText("Later")).toBeInTheDocument();
    expect(screen.getByText("Later task")).toBeInTheDocument();
  });

  it("shows 'No deadline' section for tasks without deadline", () => {
    renderWidget([
      makeTask({ id: 1, title: "Anytime task", deadline: null }),
    ]);
    expect(screen.getByText("No deadline")).toBeInTheDocument();
    expect(screen.getByText("Anytime task")).toBeInTheDocument();
  });

  it("does not show empty sections", () => {
    renderWidget([
      makeTask({ id: 1, title: "Anytime task", deadline: null }),
    ]);
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
    expect(screen.queryByText("Due today")).not.toBeInTheDocument();
  });

  it("counts open tasks correctly in subtitle", () => {
    renderWidget([
      makeTask({ id: 1, title: "A" }),
      makeTask({ id: 2, title: "B" }),
      makeTask({ id: 3, title: "C", completed: true }),
    ]);
    expect(screen.getByText(/2 open/)).toBeInTheDocument();
  });
});

// ── Importance labels ─────────────────────────────────────────────────────────

describe("TasksAtAGlanceWidget importance labels", () => {
  const cases: Array<[number, string]> = [
    [5, "Critical"],
    [4, "High"],
    [3, "Medium"],
    [2, "Low"],
    [1, "Very low"],
  ];

  it.each(cases)("importance %i renders label %s", (importance, label) => {
    renderWidget([makeTask({ id: 1, title: "T", importance })]);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

// ── Duration formatting ───────────────────────────────────────────────────────

describe("TasksAtAGlanceWidget duration formatting", () => {
  const cases: Array<[number, string]> = [
    [30, "30m"],
    [60, "1h"],
    [90, "1h 30m"],
    [120, "2h"],
    [45, "45m"],
  ];

  it.each(cases)("%i minutes renders as %s", (duration_minutes, expected) => {
    renderWidget([makeTask({ id: 1, title: "T", duration_minutes })]);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});

// ── Close interactions ────────────────────────────────────────────────────────

describe("TasksAtAGlanceWidget close interactions", () => {
  beforeEach(() => {
    noopClose.mockClear();
  });

  it("calls onClose when close button (✕) is clicked", () => {
    renderWidget([]);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(noopClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when backdrop is clicked", () => {
    renderWidget([]);
    fireEvent.click(screen.getByRole("button", { name: "Close overlay" }));
    expect(noopClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Escape key is pressed", () => {
    renderWidget([]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(noopClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose for other keys", () => {
    renderWidget([]);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(noopClose).not.toHaveBeenCalled();
  });
});

// ── Accessibility ─────────────────────────────────────────────────────────────

describe("TasksAtAGlanceWidget accessibility", () => {
  it("has role=dialog with aria-modal", () => {
    renderWidget([]);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("dialog has accessible label pointing to title", () => {
    renderWidget([]);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-labelledby", "tasks-glance-title");
    expect(document.getElementById("tasks-glance-title")).toBeInTheDocument();
  });
});
