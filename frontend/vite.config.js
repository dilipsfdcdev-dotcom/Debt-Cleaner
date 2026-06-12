import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During local `npm run dev`, proxy /api to the backend container/host.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3000,
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET || "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
