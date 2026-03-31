/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set when the bundle is built/served by the Tauri CLI. */
  readonly TAURI_ENV_PLATFORM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
