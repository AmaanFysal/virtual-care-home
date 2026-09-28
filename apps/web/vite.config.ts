import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The browser talks to the sim server over /ws; in dev Vite proxies it to the server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: `ws://127.0.0.1:${process.env.VCH_SERVER_PORT ?? 8787}`, ws: true },
    },
  },
});
