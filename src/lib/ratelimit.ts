/**
 * Small in-memory token bucket keyed by any string (a profile id, a route+profile pair, an IP).
 * A fresh key starts with `capacity` tokens; every call takes one and tokens come back at
 * `refillPerMinute`, so a key may burst up to `capacity` and then sustain the refill rate.
 * State lives in this process only, which is what a single-container app needs: it stops one
 * profile from looping on an expensive route (hosted-provider credits, CPU), not a distributed attacker.
 */

export interface RateLimitOptions {
  /** burst size: tokens a fresh key starts with and never exceeds */
  capacity: number;
  /** sustained rate: tokens added per minute of wall-clock time */
  refillPerMinute: number;
  /** clock in milliseconds, injectable for tests */
  now?: () => number;
}

export interface RateLimitResult {
  ok: boolean;
  /** whole tokens left after this call; 0 when refused */
  remaining: number;
  /** whole seconds until a refused call would succeed; 0 when ok */
  retryAfterSec: number;
}

export interface RateLimiter {
  /** Spend `cost` tokens (default 1) for `key`; refused calls spend nothing. */
  take(key: string, cost?: number): RateLimitResult;
  /** Forget every key. */
  reset(): void;
}

// a full bucket carries no state worth keeping; once the map is this large, full ones are dropped
const PRUNE_AT = 10_000;
// refill is fractional (rate * elapsed ms), so a bucket that should hold exactly one token can sit
// at 0.999…; a hair of tolerance keeps "one token every N seconds" meaning exactly that
const EPSILON = 1e-9;

export function createRateLimiter(opts: RateLimitOptions): RateLimiter {
  const capacity = Math.max(1, Math.floor(opts.capacity));
  const perMs = Math.max(0, opts.refillPerMinute) / 60_000;
  const now = opts.now ?? Date.now;
  const buckets = new Map<string, { tokens: number; at: number }>();

  const prune = (t: number) => {
    if (buckets.size < PRUNE_AT) return;
    for (const [k, b] of buckets) if (b.tokens + Math.max(0, t - b.at) * perMs >= capacity) buckets.delete(k);
  };

  return {
    take(key, cost = 1) {
      const t = now();
      prune(t);
      const b = buckets.get(key) ?? { tokens: capacity, at: t };
      b.tokens = Math.min(capacity, b.tokens + Math.max(0, t - b.at) * perMs);
      b.at = t;
      buckets.set(key, b);
      if (b.tokens + EPSILON >= cost) {
        b.tokens = Math.max(0, b.tokens - cost);
        return { ok: true, remaining: Math.floor(b.tokens + EPSILON), retryAfterSec: 0 };
      }
      // no refill configured: the caller gets a fixed hint instead of "never"
      const waitMs = perMs > 0 ? (cost - b.tokens) / perMs : 60_000;
      return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil(waitMs / 1000)) };
    },
    reset() {
      buckets.clear();
    },
  };
}
