import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '@/lib/ratelimit';

describe('ratelimit', () => {
  it('allows a burst up to capacity, then refuses with a retry hint', () => {
    const rl = createRateLimiter({ capacity: 3, refillPerMinute: 60, now: () => 0 });
    expect(rl.take('a')).toEqual({ ok: true, remaining: 2, retryAfterSec: 0 });
    expect(rl.take('a').ok).toBe(true);
    expect(rl.take('a')).toEqual({ ok: true, remaining: 0, retryAfterSec: 0 });
    // one token per second at 60/min, so the next call is one second away
    expect(rl.take('a')).toEqual({ ok: false, remaining: 0, retryAfterSec: 1 });
    // a refused call spends nothing: still exactly one second away
    expect(rl.take('a').retryAfterSec).toBe(1);
  });

  it('refills over time and never exceeds capacity', () => {
    let t = 0;
    const rl = createRateLimiter({ capacity: 2, refillPerMinute: 60, now: () => t });
    rl.take('a');
    rl.take('a');
    expect(rl.take('a').ok).toBe(false);
    t = 1000;
    expect(rl.take('a').ok).toBe(true);
    expect(rl.take('a').ok).toBe(false);
    t = 60 * 60_000; // an hour idle: back to a full bucket, not an hour's worth of tokens
    expect(rl.take('a').remaining).toBe(1);
    expect(rl.take('a').remaining).toBe(0);
    expect(rl.take('a').ok).toBe(false);
  });

  it('keeps keys independent and rounds the retry hint up to whole seconds', () => {
    let t = 0;
    const rl = createRateLimiter({ capacity: 1, refillPerMinute: 20, now: () => t });
    expect(rl.take('a').ok).toBe(true);
    expect(rl.take('b').ok).toBe(true);
    // 20/min is one token per 3 s
    expect(rl.take('a').retryAfterSec).toBe(3);
    t = 2500;
    expect(rl.take('a').retryAfterSec).toBe(1);
    t = 3000;
    expect(rl.take('a').ok).toBe(true);
  });

  it('gives a fixed hint when nothing refills, and reset() forgets every key', () => {
    const rl = createRateLimiter({ capacity: 1, refillPerMinute: 0, now: () => 0 });
    expect(rl.take('a').ok).toBe(true);
    expect(rl.take('a')).toEqual({ ok: false, remaining: 0, retryAfterSec: 60 });
    rl.reset();
    expect(rl.take('a').ok).toBe(true);
  });
});
