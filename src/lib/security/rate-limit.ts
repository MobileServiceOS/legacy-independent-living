/**
 * Fixed-window rate limiter. In-memory is correct for a single Node instance
 * (the MVP deployment). For multi-instance hosting, swap the store for Redis /
 * Postgres behind the same `RateLimiter` interface.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  hit(key: string): RateLimitResult;
  reset(key: string): void;
}

export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number; maxKeys?: number }): RateLimiter {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? 10_000;
  const buckets = new Map<string, { count: number; resetAt: number }>();

  function sweep(t: number) {
    if (buckets.size < maxKeys) return;
    for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k);
    // still full → drop oldest insertions (Map preserves insertion order)
    while (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value as string);
  }

  return {
    hit(key) {
      const t = now();
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= t) {
        sweep(t);
        bucket = { count: 0, resetAt: t + opts.windowMs };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      const allowed = bucket.count <= opts.limit;
      return {
        allowed,
        remaining: Math.max(0, opts.limit - bucket.count),
        retryAfterSeconds: allowed ? 0 : Math.ceil((bucket.resetAt - t) / 1000),
      };
    },
    reset(key) {
      buckets.delete(key);
    },
  };
}

// Shared limiters (module singletons survive across requests in one process).
const g = globalThis as unknown as { __lilLimiters?: Record<string, RateLimiter> };
g.__lilLimiters ??= {
  login: createRateLimiter({ limit: 8, windowMs: 15 * 60_000 }),
  apply: createRateLimiter({ limit: 5, windowMs: 60 * 60_000 }),
  invite: createRateLimiter({ limit: 10, windowMs: 15 * 60_000 }),
  pay: createRateLimiter({ limit: 20, windowMs: 15 * 60_000 }),
};
g.__lilLimiters.maintenance ??= createRateLimiter({ limit: 10, windowMs: 15 * 60_000 });
g.__lilLimiters.push ??= createRateLimiter({ limit: 30, windowMs: 15 * 60_000 });
// Per-account cap regardless of IP, so rotating addresses can't brute-force one password.
g.__lilLimiters.loginAccount ??= createRateLimiter({ limit: 20, windowMs: 60 * 60_000 });
export const limiters = g.__lilLimiters as Record<"login" | "loginAccount" | "apply" | "invite" | "pay" | "maintenance" | "push", RateLimiter>;

/**
 * Client IP from X-Forwarded-For, counted from the RIGHT: the entries a client
 * sends itself are on the left and can be forged; the last TRUSTED_PROXY_HOPS
 * entries were appended by our own proxies (Railway's edge = 1 hop; add 1 if
 * Cloudflare proxying is switched on in front of it).
 */
export function clientIpFrom(xff: string | null, realIp: string | null, hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1)): string | null {
  const parts = (xff ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const n = Number.isInteger(hops) && hops > 0 ? hops : 1;
  if (parts.length >= n) return parts[parts.length - n]!;
  return parts[0] ?? realIp?.trim() ?? null;
}
