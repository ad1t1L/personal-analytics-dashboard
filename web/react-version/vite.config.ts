import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    css: true,
    pool: "vmThreads",
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/auth": "http://127.0.0.1:8000",
      "/tasks": "http://127.0.0.1:8000",
      "/schedules": "http://127.0.0.1:8000",
      "/feedback": "http://127.0.0.1:8000",
    },
  },
});
