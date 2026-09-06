// Fixed-window rate limiter behind a small store interface, so a shared Redis store can replace the in-memory one later.

export type RateLimitResult = { ok: boolean; retryAfterSec: number };

type Window = { count: number; resetAt: number };

export interface RateLimitStore {
  /** Increments the counter for `key` inside a window of `windowMs` and returns the new count plus the window end. */
  hit(key: string, windowMs: number): Window;
  /** The current window for `key` without incrementing, or null when none is open. */
  peek(key: string): Window | null;
  /** Forgets the window for `key` — e.g. clearing failed sign-in attempts after a success. */
  reset(key: string): void;
}

/**
 * In-memory store: correct for a single process only. Limits are per-process until
 * REDIS_URL exists and a Redis store is swapped in here.
 */
class MemoryStore implements RateLimitStore {
  private windows = new Map<string, Window>();
  private lastSweep = 0;

  hit(key: string, windowMs: number): Window {
    const now = Date.now();
    this.sweep(now);
    const existing = this.windows.get(key);
    if (existing && existing.resetAt > now) {
      existing.count += 1;
      return existing;
    }
    const fresh: Window = { count: 1, resetAt: now + windowMs };
    this.windows.set(key, fresh);
    return fresh;
  }

  peek(key: string): Window | null {
    const existing = this.windows.get(key);
    if (!existing || existing.resetAt <= Date.now()) return null;
    return existing;
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

let store: RateLimitStore = new MemoryStore();

/** Test seam / future Redis seam. */
export function setRateLimitStore(next: RateLimitStore): void {
  store = next;
}

/** Allows `max` hits per `windowMs` for `key`. Returns how long to wait when it denies. */
export function limit(key: string, max: number, windowMs: number): RateLimitResult {
  const window = store.hit(key, windowMs);
  if (window.count <= max) return { ok: true, retryAfterSec: 0 };
  return { ok: false, retryAfterSec: Math.max(1, Math.ceil((window.resetAt - Date.now()) / 1000)) };
}

/**
 * For failure-only counting (e.g. wrong passwords): checkOnly() gates without spending an
 * attempt, recordFailure() spends one, clearFailures() forgives them all after a success.
 */
export function checkOnly(key: string, max: number): RateLimitResult {
  const window = store.peek(key);
  if (!window || window.count < max) return { ok: true, retryAfterSec: 0 };
  return { ok: false, retryAfterSec: Math.max(1, Math.ceil((window.resetAt - Date.now()) / 1000)) };
}

export function recordFailure(key: string, windowMs: number): void {
  store.hit(key, windowMs);
}

export function clearFailures(key: string): void {
  store.reset(key);
}

/**
 * Whether the app sits behind a proxy it trusts to append the real client address to
 * X-Forwarded-For (Railway does). Set TRUST_PROXY=1 in that case. Off by default: without it the
 * header is ignored, because anybody can send one.
 */
function trustProxy(env: Record<string, string | undefined> = process.env): boolean {
  return env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true";
}

/**
 * The client's address, or undefined when nothing trustworthy is known.
 *
 * With TRUST_PROXY on, the address is the LAST entry in X-Forwarded-For — the one the trusted
 * proxy itself appended. Anything before it was sent by the client and can be forged, so a spoofed
 * first hop never changes the answer. With TRUST_PROXY off, X-Forwarded-For is ignored entirely and
 * only x-real-ip (set by a platform that terminates the connection) is used.
 */
export function clientIp(request: Request, env: Record<string, string | undefined> = process.env): string | undefined {
  if (trustProxy(env)) {
    const hops = (request.headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    const last = hops[hops.length - 1];
    if (last) return last;
  }
  return request.headers.get("x-real-ip")?.trim() || undefined;
}

/** Key for anonymous traffic, from the client address `clientIp()` trusts. */
export function byIp(request: Request, scope = "global", env: Record<string, string | undefined> = process.env): string {
  return `ip:${scope}:${clientIp(request, env) ?? "unknown"}`;
}

/** Key for signed-in traffic. */
export function byUser(userId: string, scope = "global"): string {
  return `user:${scope}:${userId}`;
}
