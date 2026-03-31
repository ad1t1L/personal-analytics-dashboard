import { invoke } from "@tauri-apps/api/core";

const SHOW_BACKOFF_MS = [0, 120, 280, 600, 1200];
const HIDE_BACKOFF_MS = [0, 80, 200];

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
