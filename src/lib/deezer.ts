import { createLogger } from './log';

/**
 * Shared client for Deezer's public API. Every server-side Deezer call goes through here so that:
 *  - the whole process stays under Deezer's per-IP quota (50 requests / 5 s). Discover, New
 *    Releases, Collection gaps, charts and the artwork backfill used to fire independently, and
 *    together they could exceed it; Deezer then answers HTTP 200 with an `{ error }` body, which
 *    every feature read as "no results";
 *  - a quota or "busy" answer is retried once after the window clears;
 *  - failures are logged with their reason and remembered, so /api/health and the UI can say
 *    why Discover, charts or search came back empty instead of failing silently.
 */

const log = createLogger('deezer');

const BASE = 'https://api.deezer.com';
const WINDOW_MS = 5000;
// Deezer allows 50 per window; leave headroom for requests that are in flight across the boundary.
const MAX_PER_WINDOW = 40;
const LOG_EVERY_MS = 60_000;

// Deezer error codes (https://developers.deezer.com/api/errors)
const QUOTA = 4;
const SERVICE_BUSY = 700;
const DATA_NOT_FOUND = 800;

interface DeezerRuntime {
  sent: number[];
  queue: Promise<void>;
  lastSuccessAt: number | null;
  lastFailure: { at: number; reason: string } | null;
  lastLogged: Map<string, number>;
}

const runtimeGlobal = globalThis as typeof globalThis & { __spotlessDeezerV1?: DeezerRuntime };
const runtime: DeezerRuntime =
  runtimeGlobal.__spotlessDeezerV1 ??
  (runtimeGlobal.__spotlessDeezerV1 = {
    sent: [],
    queue: Promise.resolve(),
    lastSuccessAt: null,
    lastFailure: null,
    lastLogged: new Map(),
  });

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Waits for a free slot in the sliding window. Callers are served in arrival order. */
function acquireSlot(): Promise<void> {
  const prev = runtime.queue;
  let release!: () => void;
  runtime.queue = new Promise<void>((r) => (release = r));
  return prev.then(async () => {
    try {
      for (;;) {
        const now = Date.now();
        while (runtime.sent.length && now - runtime.sent[0] >= WINDOW_MS) runtime.sent.shift();
        if (runtime.sent.length < MAX_PER_WINDOW) {
          runtime.sent.push(now);
          return;
        }
        await sleep(WINDOW_MS - (now - runtime.sent[0]) + 10);
      }
    } finally {
      release();
    }
  });
}

/** Human-readable reason for a fetch rejection, e.g. "network error (ENOTFOUND)". */
export function describeFetchError(err: unknown, timeoutMs: number): string {
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } };
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return `timed out after ${Math.round(timeoutMs / 1000)}s`;
    if (e.cause && typeof e.cause.code === 'string') return `network error (${e.cause.code})`;
    if (e.cause && typeof e.cause.message === 'string' && e.cause.message) return `network error (${e.cause.message})`;
    if (typeof e.message === 'string' && e.message) return `network error (${e.message})`;
  }
  return 'network error';
}

function succeed() {
  runtime.lastSuccessAt = Date.now();
}

function fail(reason: string, path: string) {
  const now = Date.now();
  runtime.lastFailure = { at: now, reason };
  // one line per distinct reason per minute: an outage must not flood the container log
  const last = runtime.lastLogged.get(reason) ?? 0;
  if (now - last >= LOG_EVERY_MS) {
    runtime.lastLogged.set(reason, now);
    // drop the query string: it carries the listener's search terms
    log.warn(`request failed: ${reason} (${path.split('?')[0]})`);
  }
}

export interface DeezerResult<T> {
  /** Parsed body, or null when Deezer failed or has no such item. */
  data: T | null;
  /** False when the request failed (network, HTTP error, quota); true for an answer, including "not found". */
  ok: boolean;
}

/** GET `path` (e.g. "/search/artist?q=x") from the Deezer API, rate limited and with failures recorded. */
export async function deezerRequest<T>(path: string, timeoutMs = 10_000): Promise<DeezerResult<T>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const retry = attempt === 0;
    await acquireSlot();

    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      fail(describeFetchError(err, timeoutMs), path);
      return { data: null, ok: false };
    }

    if (res.status === 429 || res.status >= 500) {
      if (retry) {
        await sleep(1000);
        continue;
      }
    }
    if (!res.ok) {
      fail(`HTTP ${res.status}`, path);
      return { data: null, ok: false };
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      fail('invalid JSON response', path);
      return { data: null, ok: false };
    }

    // Deezer reports quota, lookup and permission failures as HTTP 200 with an { error: {...} } envelope.
    const error =
      json && typeof json === 'object' ? (json as { error?: { code?: unknown; message?: unknown } }).error : undefined;
    if (error) {
      const code = typeof error.code === 'number' ? error.code : null;
      if (code === DATA_NOT_FOUND) {
        succeed();
        return { data: null, ok: true };
      }
      if ((code === QUOTA || code === SERVICE_BUSY) && retry) {
        await sleep(code === QUOTA ? WINDOW_MS : 1000);
        continue;
      }
      const message = typeof error.message === 'string' && error.message ? error.message : 'unknown error';
      fail(code === null ? `Deezer error: ${message}` : `Deezer error ${code}: ${message}`, path);
      return { data: null, ok: false };
    }
    if (!json || typeof json !== 'object') {
      fail('empty response', path);
      return { data: null, ok: false };
    }

    succeed();
    return { data: json as T, ok: true };
  }
  // both attempts hit a retryable answer
  fail('rate limited or busy after retry', path);
  return { data: null, ok: false };
}

/** Convenience form of deezerRequest for callers that only need the body. */
export async function deezer<T>(path: string, timeoutMs?: number): Promise<T | null> {
  return (await deezerRequest<T>(path, timeoutMs)).data;
}

export interface DeezerStatus {
  /** False when the most recent request failed. */
  ok: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
}

export function deezerStatus(): DeezerStatus {
  const { lastSuccessAt, lastFailure } = runtime;
  return {
    ok: !lastFailure || (lastSuccessAt !== null && lastSuccessAt > lastFailure.at),
    lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : null,
    lastFailureAt: lastFailure ? new Date(lastFailure.at).toISOString() : null,
    lastError: lastFailure?.reason ?? null,
  };
}

/** The message a page shows when Deezer-backed content could not be loaded. */
export function deezerUnavailableMessage(): string {
  const reason = runtime.lastFailure?.reason;
  return reason ? `Deezer could not be reached (${reason}).` : 'Deezer could not be reached.';
}

/** Test hook: forget rate-limit and status state. */
export function resetDeezerForTests() {
  runtime.sent = [];
  runtime.queue = Promise.resolve();
  runtime.lastSuccessAt = null;
  runtime.lastFailure = null;
  runtime.lastLogged.clear();
}
