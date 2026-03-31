/**
 * Sync JWT to the Rust side so the separate Tauri "widget" webview can call the API
 * (widget has its own JS storage; invoke bridges the token).
 */
export async function syncTauriWidgetToken(token: string | null): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_widget_token", { token });
  } catch {
    /* not running inside Tauri */
  }
}

export async function emitTasksUpdatedIfTauri(): Promise<void> {
  try {
    const { emit } = await import("@tauri-apps/api/event");
    await emit("tasks-updated");
  } catch {
    /* not in Tauri */
  }
}

/**
 * True when the UI runs inside the Tauri webview (not a normal browser tab).
 * Tauri v1/v2 use different globals; `TAURI_ENV_PLATFORM` is set by the Tauri+Vite toolchain.
 */
export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as Window & { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  if (w.__TAURI_INTERNALS__ !== undefined || w.__TAURI__ !== undefined) return true;
  if (import.meta.env?.TAURI_ENV_PLATFORM) return true;
  return false;
}
