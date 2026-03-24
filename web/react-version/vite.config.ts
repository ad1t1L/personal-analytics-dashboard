import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    proxy: {
      "/tasks": "http://127.0.0.1:8000",
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
