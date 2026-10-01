// The public server's settings and limits (docs/13). Production mode comes only from the hosting
// environment: with no settings, the server is the local dev tool, every feature on for everyone.

import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { AUTH_ATTEMPTS, AuthLockout, ConnectionLimiter, LOCKOUT_MS, MESSAGES_PER_SECOND, MessageBucket, PER_IP_CONNECTIONS, PER_IP_PER_MINUTE, originAllowed } from "../src/limits.js";

const TOKEN = "t".repeat(32);
const prod = (extra: Record<string, string> = {}) => loadConfig({ VCH_MODE: "production", ADMIN_TOKEN: TOKEN, ALLOWED_ORIGINS: "https://vch.vercel.app", ...extra });

describe("settings", () => {
  it("default to local dev: not production, localhost, no origin check, paused at 60x by the runner", () => {
    const c = loadConfig({});
    expect(c.production).toBe(false);
    expect(c.adminToken).toBeNull();
    expect(c.allowedOrigins).toEqual([]);
    expect(c.host).toBe("127.0.0.1");
    expect(c.port).toBe(8787);
    expect(c.speed).toBe(60);
  });

  it("switch to production only with VCH_MODE=production, at 10x on all interfaces", () => {
    const c = prod();
    expect(c.production).toBe(true);
    expect(c.host).toBe("0.0.0.0");
    expect(c.speed).toBe(10);
    expect(c.allowedOrigins).toEqual(["https://vch.vercel.app"]);
  });

  it("refuse production without a long enough token or an https origin", () => {
    expect(() => loadConfig({ VCH_MODE: "production", ALLOWED_ORIGINS: "https://a.vercel.app" })).toThrow(/ADMIN_TOKEN/);
    expect(() => prod({ ADMIN_TOKEN: "short" })).toThrow(/24 characters/);
    expect(() => loadConfig({ VCH_MODE: "production", ADMIN_TOKEN: TOKEN })).toThrow(/ALLOWED_ORIGINS/);
    expect(() => prod({ ALLOWED_ORIGINS: "http://a.vercel.app" })).toThrow(/https/);
    expect(prod({ ALLOWED_ORIGINS: "http://localhost:5173" }).allowedOrigins).toEqual(["http://localhost:5173"]); // trying it locally
  });

  it("take exact origins only: the production URL and a custom domain, no wildcards or paths", () => {
    expect(prod({ ALLOWED_ORIGINS: "https://vch.vercel.app, https://care.example.org/" }).allowedOrigins).toEqual(["https://vch.vercel.app", "https://care.example.org"]);
    expect(() => prod({ ALLOWED_ORIGINS: "https://*.vercel.app" })).toThrow(/wildcards/);
    expect(() => prod({ ALLOWED_ORIGINS: "https://vch.vercel.app/app" })).toThrow(/paths/);
  });

  it("check numbers and speeds", () => {
    expect(() => loadConfig({ SPEED: "7" })).toThrow(/SPEED/);
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/PORT/);
    expect(() => loadConfig({ VCH_MODE: "staging" })).toThrow(/VCH_MODE/);
  });
});

describe("limits", () => {
  it("allow listed origins only, and keep previews out", () => {
    const allowed = ["https://vch.vercel.app", "https://care.example.org"];
    expect(originAllowed("https://vch.vercel.app", allowed)).toBe(true);
    expect(originAllowed("https://care.example.org", allowed)).toBe(true);
    expect(originAllowed("https://vch-git-hosting-amaan.vercel.app", allowed)).toBe(false);
    expect(originAllowed("https://vch-abc123.vercel.app", allowed)).toBe(false);
    expect(originAllowed(undefined, allowed)).toBe(false);
    expect(originAllowed(undefined, [])).toBe(true); // local dev
  });

  it("cap connections per address, per minute and in total", () => {
    const l = new ConnectionLimiter(7);
    for (let i = 0; i < PER_IP_CONNECTIONS; i++) expect(l.admit("1.1.1.1", 0)).toBeNull();
    expect(l.admit("1.1.1.1", 0)).toMatch(/too many connections/);
    l.release("1.1.1.1");
    expect(l.admit("1.1.1.1", 0)).toBeNull();
    for (let i = 0; i < 2; i++) expect(l.admit("2.2.2.2", 0)).toBeNull();
    expect(l.admit("3.3.3.3", 0)).toMatch(/full/);
    expect(l.connections).toBe(7);

    const r = new ConnectionLimiter(1000);
    for (let i = 0; i < PER_IP_PER_MINUTE; i++) {
      expect(r.admit("4.4.4.4", i)).toBeNull();
      r.release("4.4.4.4");
    }
    expect(r.admit("4.4.4.4", 1000)).toMatch(/wait a minute/);
    expect(r.admit("4.4.4.4", 61_000)).toBeNull();
  });

  it("throttle messages per socket", () => {
    const b = new MessageBucket();
    let allowed = 0;
    for (let i = 0; i < 20; i++) if (b.allow(0)) allowed++;
    expect(allowed).toBe(MESSAGES_PER_SECOND);
    expect(b.allow(100)).toBe(false);
    expect(b.allow(300)).toBe(true); // refilled at 5 a second
  });

  it("lock auth after too many wrong tokens, for 15 minutes", () => {
    const a = new AuthLockout();
    for (let i = 0; i < AUTH_ATTEMPTS; i++) {
      expect(a.locked("5.5.5.5", 0)).toBe(false);
      a.fail("5.5.5.5", 0);
    }
    expect(a.locked("5.5.5.5", 1000)).toBe(true);
    expect(a.locked("6.6.6.6", 1000)).toBe(false);
    expect(a.locked("5.5.5.5", LOCKOUT_MS + 1)).toBe(false);
  });
});
