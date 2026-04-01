import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
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
