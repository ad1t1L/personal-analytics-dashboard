/**
 * API origin for fetch().
 * - Vite dev: `""` so requests hit the dev server and are proxied to :8000 (see vite.config.ts).
 * - Tauri production bundle: webview is not same-origin as the API → use localhost.
 * - Browser SPA served from :8000: `""` (same origin).
 */
function computeApiBase(): string {
  if (import.meta.env.DEV) return "";
  if (import.meta.env.TAURI_ENV_PLATFORM) return "http://localhost:8000";
  return "";
}

export const API_BASE = computeApiBase();
