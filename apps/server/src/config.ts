// Server settings from the environment (docs/13). Production mode is switched on only by the
// hosting environment (VCH_MODE=production, set in fly.toml); without it the server is the local
// dev tool it has always been: paused at the start, every connection an admin, nothing persisted.

import type { ClockSpeed } from "@vch/shared-types";

export interface ServerConfig {
  production: boolean;
  /** Required in production: the secret that unlocks admin controls. Never logged or sent. */
  adminToken: string | null;
  /** Browser origins allowed to connect (exact matches); empty means any (dev). */
  allowedOrigins: string[];
  host: string;
  port: number;
  /** The speed the world runs at from the start (production). */
  speed: ClockSpeed;
  /** Minutes of real time between snapshots (production). */
  snapshotEveryMin: number;
  /** Sim days of events kept in the run's log (production); inputs and commands are always kept. */
  eventRetentionDays: number;
  /** Run folders kept on disk, the current one included (production). */
  keepRuns: number;
  maxViewers: number;
  /** Header holding the client's IP when behind the host's proxy (Fly: fly-client-ip); else the socket's. */
  clientIpHeader: string | null;
}

const SPEEDS: readonly ClockSpeed[] = [1, 10, 60, 360];

function int(env: NodeJS.ProcessEnv, name: string, fallback: number, min = 1): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be a whole number of at least ${min}`);
  return n;
}

/** Reads and checks the settings; throws with a readable message when something is wrong. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const mode = env.VCH_MODE ?? "dev";
  if (mode !== "dev" && mode !== "production") throw new Error("VCH_MODE must be dev or production");
  const production = mode === "production";
  const adminToken = env.ADMIN_TOKEN && env.ADMIN_TOKEN.length > 0 ? env.ADMIN_TOKEN : null;
  if (production && (!adminToken || adminToken.length < 24)) throw new Error("Production needs ADMIN_TOKEN, at least 24 characters (fly secrets set ADMIN_TOKEN=...)");
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
  for (const o of allowedOrigins) if (!/^https?:\/\/[^*\s/]+$/.test(o)) throw new Error(`ALLOWED_ORIGINS: "${o}" isn't an origin like https://example.vercel.app (no paths or wildcards)`);
  if (production && allowedOrigins.length === 0) throw new Error("Production needs ALLOWED_ORIGINS (the web app's URL)");
  // Plain http only for trying production mode on this machine (docs/13).
  const local = (o: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
  if (production && allowedOrigins.some((o) => o.startsWith("http://") && !local(o))) throw new Error("Production ALLOWED_ORIGINS must be https (http only for localhost)");
  const speed = int(env, "SPEED", production ? 10 : 60) as ClockSpeed;
  if (!SPEEDS.includes(speed)) throw new Error(`SPEED must be one of ${SPEEDS.join(", ")}`);
  return {
    production,
    adminToken,
    allowedOrigins,
    host: env.HOST ?? (production ? "0.0.0.0" : "127.0.0.1"),
    port: int(env, "PORT", 8787),
    speed,
    snapshotEveryMin: int(env, "SNAPSHOT_EVERY_MIN", 5),
    eventRetentionDays: int(env, "EVENT_RETENTION_DAYS", 30),
    keepRuns: int(env, "KEEP_RUNS", 2),
    maxViewers: int(env, "MAX_VIEWERS", 200),
    clientIpHeader: env.CLIENT_IP_HEADER ? env.CLIENT_IP_HEADER.toLowerCase() : null,
  };
}
