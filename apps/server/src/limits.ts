// Connection limits for the public server (docs/13): who may connect, how often, how many at
// once, how fast they may send, and how many wrong admin tokens they may try. Times are passed in
// (milliseconds), so the rules are tested without waiting.

/** Concurrent connections allowed from one IP address. */
export const PER_IP_CONNECTIONS = 5;
/** New connections allowed from one IP address per minute. */
export const PER_IP_PER_MINUTE = 20;
/** Messages a socket may send per second, on average (bursts up to the same number). */
export const MESSAGES_PER_SECOND = 5;
/** Wrong admin tokens from one IP before auth is locked for LOCKOUT_MS. */
export const AUTH_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
/** A socket whose unsent backlog stays above this for STALL_MS is closed. */
export const BACKLOG_BYTES = 1024 * 1024;
export const STALL_MS = 30 * 1000;

/** Whether a browser origin may connect: exact match with the list; any when the list is empty (dev). */
export function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  return origin !== undefined && allowed.includes(origin.replace(/\/$/, ""));
}

export class ConnectionLimiter {
  private open = new Map<string, number>();
  private recent = new Map<string, number[]>();
  private total = 0;

  constructor(private maxTotal: number) {}

  /** Admits a new connection from `ip`, or says why not. Call `release` when it closes. */
  admit(ip: string, now: number): string | null {
    const times = (this.recent.get(ip) ?? []).filter((t) => now - t < 60_000);
    this.recent.set(ip, times);
    if (this.total >= this.maxTotal) return "the server is full; try again later";
    if ((this.open.get(ip) ?? 0) >= PER_IP_CONNECTIONS) return "too many connections from this address";
    if (times.length >= PER_IP_PER_MINUTE) return "too many new connections; wait a minute";
    times.push(now);
    this.open.set(ip, (this.open.get(ip) ?? 0) + 1);
    this.total += 1;
    return null;
  }

  release(ip: string): void {
    const n = (this.open.get(ip) ?? 0) - 1;
    if (n <= 0) this.open.delete(ip);
    else this.open.set(ip, n);
    this.total = Math.max(0, this.total - 1);
  }

  get connections(): number {
    return this.total;
  }
}

/** A token bucket for one socket's messages. */
export class MessageBucket {
  private tokens = MESSAGES_PER_SECOND;
  private last: number | null = null;

  allow(now: number): boolean {
    if (this.last !== null) this.tokens = Math.min(MESSAGES_PER_SECOND, this.tokens + ((now - this.last) / 1000) * MESSAGES_PER_SECOND);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Wrong admin tokens per IP, and the lockout that follows too many. */
export class AuthLockout {
  private failures = new Map<string, number[]>();

  locked(ip: string, now: number): boolean {
    const recent = (this.failures.get(ip) ?? []).filter((t) => now - t < LOCKOUT_MS);
    this.failures.set(ip, recent);
    return recent.length >= AUTH_ATTEMPTS;
  }

  fail(ip: string, now: number): void {
    this.failures.set(ip, [...(this.failures.get(ip) ?? []).filter((t) => now - t < LOCKOUT_MS), now]);
  }

  succeed(ip: string): void {
    this.failures.delete(ip);
  }
}
