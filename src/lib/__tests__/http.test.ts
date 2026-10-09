import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError, errorMessage, failureStatus, getJson, isAbortError } from '@/lib/http';

const respond = (body: string | null, init: ResponseInit) => vi.fn(async () => new Response(body, init));

const rejectionOf = (p: Promise<unknown>) => p.then(() => undefined, (e: unknown) => e) as Promise<unknown>;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getJson', () => {
  it('parses a JSON body on 2xx', async () => {
    vi.stubGlobal('fetch', respond('{"ok":true,"n":2}', { status: 200 }));
    await expect(getJson<{ ok: boolean; n: number }>('/api/x')).resolves.toEqual({ ok: true, n: 2 });
  });

  it('resolves with undefined for a 204', async () => {
    vi.stubGlobal('fetch', respond(null, { status: 204 }));
    await expect(getJson('/api/x')).resolves.toBeUndefined();
  });

  it('resolves with undefined for an empty 2xx body', async () => {
    vi.stubGlobal('fetch', respond('', { status: 200 }));
    await expect(getJson('/api/x')).resolves.toBeUndefined();
  });

  it('throws HttpError carrying the parsed JSON error body', async () => {
    vi.stubGlobal('fetch', respond('{"error":"nope"}', { status: 400 }));
    const err = await rejectionOf(getJson('/api/x'));
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(400);
    expect((err as HttpError).body).toEqual({ error: 'nope' });
    expect(errorMessage(err)).toBe('nope');
  });

  it('keeps a non-JSON error body as text and falls back to the status in the message', async () => {
    vi.stubGlobal('fetch', respond('Bad Gateway', { status: 502 }));
    const err = await rejectionOf(getJson('/api/x'));
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).body).toBe('Bad Gateway');
    expect(errorMessage(err, 'Failed')).toBe('Failed (HTTP 502)');
  });
});

describe('failureStatus / isAbortError', () => {
  it('maps a 404 to notfound and everything else to error', () => {
    expect(failureStatus(new HttpError(404, null))).toBe('notfound');
    expect(failureStatus(new HttpError(500, null))).toBe('error');
    expect(failureStatus(new TypeError('network'))).toBe('error');
  });

  it('recognises the DOMException fetch rejects with on abort', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('other'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
