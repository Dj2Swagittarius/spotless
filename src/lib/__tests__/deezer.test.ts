import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deezerRequest,
  deezerStatus,
  deezerUnavailableMessage,
  describeFetchError,
  resetDeezerForTests,
} from '@/lib/deezer';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  resetDeezerForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('deezerRequest', () => {
  it('returns the body and records success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ data: [{ id: 1 }] }))
    );
    await expect(deezerRequest('/search/artist?q=x')).resolves.toEqual({ data: { data: [{ id: 1 }] }, ok: true });
    expect(deezerStatus().ok).toBe(true);
  });

  it('treats an HTTP 200 error envelope as a failure, not as empty results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { type: 'OAuthException', message: 'blocked', code: 200 } }))
    );
    await expect(deezerRequest('/chart/0/tracks')).resolves.toEqual({ data: null, ok: false });
    expect(deezerStatus()).toMatchObject({ ok: false, lastError: 'Deezer error 200: blocked' });
    expect(deezerUnavailableMessage()).toBe('Deezer could not be reached (Deezer error 200: blocked).');
  });

  it('treats "data not found" as a successful empty answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { type: 'DataException', message: 'no data', code: 800 } }))
    );
    await expect(deezerRequest('/artist/1/related')).resolves.toEqual({ data: null, ok: true });
    expect(deezerStatus().ok).toBe(true);
  });

  it('retries once after a quota error', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } }))
      .mockResolvedValueOnce(json({ data: [] }));
    vi.stubGlobal('fetch', fetch);
    const p = deezerRequest('/genre');
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ data: { data: [] }, ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reports the network error code when the host is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
      })
    );
    await expect(deezerRequest('/genre')).resolves.toEqual({ data: null, ok: false });
    expect(deezerStatus().lastError).toBe('network error (ENOTFOUND)');
  });

  it('keeps a burst under the per-window quota', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => json({ data: [] }));
    vi.stubGlobal('fetch', fetch);
    const all = Promise.all(Array.from({ length: 45 }, (_, i) => deezerRequest(`/artist/${i}/top`)));
    await vi.advanceTimersByTimeAsync(100);
    expect(fetch).toHaveBeenCalledTimes(40);
    await vi.runAllTimersAsync();
    await all;
    expect(fetch).toHaveBeenCalledTimes(45);
  });
});

describe('describeFetchError', () => {
  it('names timeouts', () => {
    expect(describeFetchError(Object.assign(new Error('x'), { name: 'TimeoutError' }), 8000)).toBe(
      'timed out after 8s'
    );
  });
});
