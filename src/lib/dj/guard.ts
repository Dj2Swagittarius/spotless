import { NextResponse, type NextRequest } from 'next/server';
import { createLogger } from '../log';
import { createRateLimiter, type RateLimiter } from '../ratelimit';
import { isAdmin } from '../user';
import { LlmError } from './llm';
import { SpeechError } from './speech';

/**
 * Shared guards for the DJ routes: a per-profile budget so one profile cannot drain the
 * admin's hosted-provider credits in a loop, and error replies that keep server hosts and
 * upstream bodies for the admin while every other profile gets a plain sentence.
 */

const log = createLogger('dj');

export type DjRoute = 'chat' | 'speak' | 'segue' | 'transcribe';

/** Requests per minute per profile and route. DJ_RATE_LIMIT_PER_MIN overrides all four; 0 disables. */
const DEFAULT_PER_MINUTE: Record<DjRoute, number> = { chat: 20, speak: 60, segue: 30, transcribe: 30 };

export function djRateLimitPerMinute(route: DjRoute): number {
  const raw = (process.env.DJ_RATE_LIMIT_PER_MIN ?? '').trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return DEFAULT_PER_MINUTE[route];
}

const limiters = new Map<DjRoute, { perMinute: number; limiter: RateLimiter }>();

/** A 429 with Retry-After when the profile has used up its budget for this route, else null. */
export function djRateLimit(route: DjRoute, userId: number): NextResponse | null {
  const perMinute = djRateLimitPerMinute(route);
  if (perMinute <= 0) return null;
  let entry = limiters.get(route);
  // the env var can change between restarts only, but a new budget must not keep an old bucket
  if (!entry || entry.perMinute !== perMinute) {
    entry = { perMinute, limiter: createRateLimiter({ capacity: perMinute, refillPerMinute: perMinute }) };
    limiters.set(route, entry);
  }
  const r = entry.limiter.take(String(userId));
  if (r.ok) return null;
  return NextResponse.json(
    { error: `Slow down: try again in ${r.retryAfterSec}s.` },
    { status: 429, headers: { 'Retry-After': String(r.retryAfterSec) } }
  );
}

/**
 * 502 for a failed DJ call. LlmError/SpeechError carry a `safe` wording for non-admins; anything
 * else is logged and replaced by a generic line. The admin sees the full message either way.
 */
export function djErrorResponse(req: NextRequest, err: unknown, scope: DjRoute): NextResponse {
  const admin = isAdmin(req);
  const known = err instanceof LlmError || err instanceof SpeechError;
  const detail = known ? err.message : String(err).slice(0, 300);
  if (!known) log.error(`${scope} failed: ${detail}`);
  else if (!admin) log.warn(`${scope}: ${detail}`);
  const message = known ? (admin ? err.message : err.safe) : admin ? `DJ failed: ${detail}` : 'The DJ ran into a problem. Ask the admin to check the server log.';
  return NextResponse.json({ error: message }, { status: 502 });
}
