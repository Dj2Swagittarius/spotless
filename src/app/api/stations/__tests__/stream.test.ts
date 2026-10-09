import dns from 'dns';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RadioStation } from '@/lib/types';

// The route only needs one station record; everything else in @/lib/stations (the URL and DNS
// checks the redirect walk relies on) stays real so the test exercises the actual guard.
const station: RadioStation = { id: 7, name: 'Test FM', streamUrl: 'http://ice.example.com/live', homePageUrl: null };
vi.mock('@/lib/stations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stations')>()),
  getStation: (id: number) => (id === station.id ? station : null),
}));

import { GET } from '@/app/api/stations/[id]/stream/route';

/** Resolve every hostname to a public address unless the name says otherwise. */
function stubDns(privateHosts: string[] = []) {
  return vi.spyOn(dns.promises, 'lookup').mockImplementation(async (hostname) => {
    const address = privateHosts.includes(String(hostname)) ? '192.168.0.50' : '203.0.113.7';
    return [{ address, family: 4 }] as never;
  });
}

type Step = { status: number; headers?: Record<string, string>; body?: string };

/** Stub fetch with a scripted sequence of upstream answers and record what was requested. */
function stubFetch(steps: Step[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const step = steps[calls.length - 1];
    if (!step) throw new Error(`unexpected fetch #${calls.length} for ${String(input)}`);
    return new Response(step.body ?? '', { status: step.status, headers: step.headers });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

const call = () =>
  GET(new NextRequest('http://spotless.local/api/stations/7/stream'), { params: Promise.resolve({ id: '7' }) });

const original = process.env.ALLOW_PRIVATE_STREAM_URLS;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  delete process.env.ALLOW_PRIVATE_STREAM_URLS;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  if (original === undefined) delete process.env.ALLOW_PRIVATE_STREAM_URLS;
  else process.env.ALLOW_PRIVATE_STREAM_URLS = original;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/stations/[id]/stream redirect handling', () => {
  it('relays a direct answer and never lets fetch follow redirects on its own', async () => {
    stubDns();
    const calls = stubFetch([{ status: 200, headers: { 'content-type': 'audio/aac' }, body: 'audio' }]);
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/aac');
    expect(await res.text()).toBe('audio');
    expect(calls).toHaveLength(1);
    expect(calls[0].init.redirect).toBe('manual');
  });

  it('follows a public redirect chain, resolving relative Locations against the current hop', async () => {
    const lookup = stubDns();
    const calls = stubFetch([
      { status: 302, headers: { location: 'https://edge.example.net/a' } },
      { status: 301, headers: { location: '/b/stream.mp3' } },
      { status: 200, headers: { 'content-type': 'audio/mpeg' }, body: 'audio' },
    ]);
    const res = await call();
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual([
      'http://ice.example.com/live',
      'https://edge.example.net/a',
      'https://edge.example.net/b/stream.mp3',
    ]);
    // every hop's host was resolved before it was fetched
    expect(lookup.mock.calls.map((c) => c[0])).toEqual(['ice.example.com', 'edge.example.net', 'edge.example.net']);
  });

  it('refuses a redirect to a private literal address without fetching it', async () => {
    stubDns();
    const calls = stubFetch([{ status: 302, headers: { location: 'http://127.0.0.1:8000/admin' } }]);
    const res = await call();
    expect(res.status).toBe(502);
    expect(await res.text()).toMatch(/redirect to http:\/\/127\.0\.0\.1:8000\/admin/);
    expect(calls).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });

  it('refuses a redirect to a hostname that resolves to the LAN', async () => {
    stubDns(['nas.lan']);
    const calls = stubFetch([{ status: 307, headers: { location: 'http://nas.lan/stream' } }]);
    const res = await call();
    expect(res.status).toBe(502);
    expect(await res.text()).toMatch(/resolves to a LAN\/private address/);
    expect(calls).toHaveLength(1);
  });

  it('refuses a redirect to a non-http scheme', async () => {
    stubDns();
    const calls = stubFetch([{ status: 302, headers: { location: 'file:///etc/passwd' } }]);
    const res = await call();
    expect(res.status).toBe(502);
    expect(calls).toHaveLength(1);
  });

  it('gives up after too many hops', async () => {
    stubDns();
    const hop = (n: number) => ({ status: 302, headers: { location: `http://ice.example.com/hop${n}` } });
    const calls = stubFetch([hop(1), hop(2), hop(3), hop(4), hop(5), hop(6), hop(7)]);
    const res = await call();
    expect(res.status).toBe(502);
    expect(await res.text()).toMatch(/redirects/);
    // the original request plus five redirects were tried, the sixth was not followed
    expect(calls).toHaveLength(6);
  });

  it('502s a redirect without a Location header', async () => {
    stubDns();
    stubFetch([{ status: 302 }]);
    const res = await call();
    expect(res.status).toBe(502);
    expect(await res.text()).toMatch(/without a Location/);
  });

  it('502s a non-redirect upstream error', async () => {
    stubDns();
    stubFetch([{ status: 404, body: 'gone' }]);
    const res = await call();
    expect(res.status).toBe(502);
  });

  it('refuses the stored URL itself when it resolves to the LAN, before any fetch', async () => {
    stubDns(['ice.example.com']);
    const calls = stubFetch([{ status: 200, body: 'audio' }]);
    const res = await call();
    expect(res.status).toBe(502);
    expect(calls).toHaveLength(0);
  });

  it('404s an unknown station', async () => {
    const res = await GET(new NextRequest('http://spotless.local/api/stations/9/stream'), {
      params: Promise.resolve({ id: '9' }),
    });
    expect(res.status).toBe(404);
  });
});
