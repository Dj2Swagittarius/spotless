/**
 * Tiny fetch wrapper for client pages: `fetch().then(r => r.json())` happily parses a
 * 404/500 JSON error body as data, which is how detail pages ended up crashing on
 * `undefined.name`. getJson throws instead so callers can branch on the status.
 */

/** Thrown by getJson for any non-2xx response; `status` lets a page tell "not found" from "broken". */
export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, url?: string) {
    super(`HTTP ${status}${url ? ` for ${url}` : ''}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

/** Page-level data state. 'notfound' is a 404 from the API; 'error' is anything else that failed. */
export type LoadStatus = 'loading' | 'error' | 'notfound' | 'ready';

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    // best effort: API routes answer JSON, but a proxy or a crashed route may send text or nothing
    const text = await res.text().catch(() => '');
    let body: unknown = text || null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        // keep the raw text
      }
    }
    throw new HttpError(res.status, body, url);
  }
  return (await res.json()) as T;
}

/** True for the rejection fetch produces when its AbortController fires; callers ignore those. */
export function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

/** Maps a getJson rejection to the status a page should show (aborts are filtered out before this). */
export function failureStatus(err: unknown): 'notfound' | 'error' {
  return err instanceof HttpError && err.status === 404 ? 'notfound' : 'error';
}

/** The `error` string an API route put in its JSON body, if any, for messages like "Failed — …". */
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof HttpError) {
    const body = err.body as { error?: unknown } | null;
    if (body && typeof body.error === 'string' && body.error) return body.error;
    return `${fallback} (HTTP ${err.status})`;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
