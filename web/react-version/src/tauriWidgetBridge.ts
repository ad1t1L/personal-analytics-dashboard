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

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
