/**
 * API origin for fetch().
 * - Vite dev: `""` so requests hit the dev server and are proxied to :8000 (see vite.config.ts).
 * - Tauri production bundle: webview is not same-origin as the API → use localhost.
 * - Vercel (or any separate frontend host): set VITE_API_URL to your Render backend URL.
 * - Browser SPA served from same origin as API (e.g. :8000): `""`.
 */
function computeApiBase(): string {
  if (import.meta.env.DEV) return "";
  if (import.meta.env.TAURI_ENV_PLATFORM) return "http://localhost:8000";
  return import.meta.env.VITE_API_URL ?? "";
}

export const API_BASE = computeApiBase();
