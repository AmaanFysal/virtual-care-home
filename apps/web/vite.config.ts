import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// The browser talks to the sim server over /ws; in dev Vite proxies it to the server. A build for
// the public site (docs/13) takes the server's address from VITE_SIM_URL, which must be wss://.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const url = env.VITE_SIM_URL ?? "";
  if (command === "build" && mode === "production") {
    if (process.env.VERCEL && !url) throw new Error("Set VITE_SIM_URL (e.g. wss://your-app.fly.dev/ws) in the Vercel project's environment variables");
    if (url && !url.startsWith("wss://")) throw new Error(`VITE_SIM_URL must start with wss:// in a production build (got ${url})`);
  }
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/ws": { target: `ws://127.0.0.1:${process.env.VCH_SERVER_PORT ?? 8787}`, ws: true },
      },
    },
  };
});
