import { invoke } from "@tauri-apps/api/core";

/** Backoff (ms) between attempts — mirrors server-side retries for flaky GTK/WebKit timing. */
const SHOW_BACKOFF_MS = [0, 120, 280, 600, 1200];
const HIDE_BACKOFF_MS = [0, 80, 200];

/**
 * Show the floating task widget. Retries on failure so transient IPC / platform
 * issues are absorbed (especially on Linux/Wayland and first-open after launch).
 */
export async function showWidgetRobust(): Promise<void> {
  let last: unknown;
  for (let i = 0; i < SHOW_BACKOFF_MS.length; i++) {
    const delay = SHOW_BACKOFF_MS[i];
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }
    try {
      await invoke("show_widget_window");
      return;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/** Hide the widget with a few retries (usually succeeds once). */
export async function hideWidgetRobust(): Promise<void> {
  let last: unknown;
  for (let i = 0; i < HIDE_BACKOFF_MS.length; i++) {
    const delay = HIDE_BACKOFF_MS[i];
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }
    try {
      await invoke("hide_widget_window");
      return;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
