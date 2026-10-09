import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// PASSWORD_MIN_LENGTH is computed when auth.ts loads, so each test re-imports a fresh module
// after setting the environment it wants to observe. Importing auth.ts does not open the DB.
async function loadAuth(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import('@/lib/auth');
}

function reqWithForwardedFor(value?: string): NextRequest {
  const headers = new Headers();
  if (value !== undefined) headers.set('x-forwarded-for', value);
  return new NextRequest(new URL('http://localhost/api/auth/login'), { headers });
}

function reqWithHosts(headers: Record<string, string>, method = 'GET', url = 'http://127.0.0.1:3000/api/health'): NextRequest {
  return new NextRequest(new URL(url), { method, headers: new Headers(headers) });
}

afterEach(() => {
  delete process.env.TRUST_PROXY;
  delete process.env.AUTH_MIN_PASSWORD_LENGTH;
});

describe('expectedHost', () => {
  it('uses the Host header and ignores X-Forwarded-Host when TRUST_PROXY is unset', async () => {
    const { expectedHost, requestOrigin } = await loadAuth({ TRUST_PROXY: undefined });
    const req = reqWithHosts({ host: '127.0.0.1:3000', 'x-forwarded-host': 'evil.example' });
    expect(expectedHost(req)).toBe('127.0.0.1:3000');
    expect(requestOrigin(req)).toBe('http://127.0.0.1:3000');
  });

  it('believes the first X-Forwarded-Host entry behind a trusted proxy', async () => {
    const { expectedHost, requestOrigin } = await loadAuth({ TRUST_PROXY: '1' });
    const req = reqWithHosts({
      host: 'upstream:3000',
      'x-forwarded-host': 'music.example.com, inner.proxy',
      'x-forwarded-proto': 'https',
    });
    expect(expectedHost(req)).toBe('music.example.com');
    expect(requestOrigin(req)).toBe('https://music.example.com');
  });

  it('rejects a forwarded host that is not a bare host[:port] and keeps the Host header', async () => {
    const { expectedHost } = await loadAuth({ TRUST_PROXY: '1' });
    expect(expectedHost(reqWithHosts({ host: 'spotless.lan', 'x-forwarded-host': 'evil.example/path' }))).toBe('spotless.lan');
    expect(expectedHost(reqWithHosts({ host: 'spotless.lan', 'x-forwarded-host': 'http://evil.example' }))).toBe('spotless.lan');
    expect(expectedHost(reqWithHosts({ host: 'spotless.lan', 'x-forwarded-host': '' }))).toBe('spotless.lan');
  });

  it('falls back to the request URL host when the Host header is malformed', async () => {
    const { expectedHost } = await loadAuth({ TRUST_PROXY: undefined });
    // nextUrl rewrites loopback addresses to localhost, which is why the Host header is preferred
    expect(expectedHost(reqWithHosts({ host: 'bad host!' }))).toBe('localhost:3000');
  });
});

describe('proxy CSRF origin check', () => {
  // POST /api/health exercises the CSRF check (unsafe method, not exempt) and, when it passes,
  // returns NextResponse.next() for a public path without touching the database.
  async function loadProxy(env: Record<string, string | undefined>) {
    await loadAuth(env);
    return (await import('@/proxy')).proxy;
  }

  it('accepts an Origin matching either Host or X-Forwarded-Host without TRUST_PROXY (Host-rewriting proxies)', async () => {
    const proxy = await loadProxy({ TRUST_PROXY: undefined });
    // a browser cannot attach X-Forwarded-Host cross-site without a CORS preflight, so matching it is safe
    const rewritingProxy = proxy(
      reqWithHosts({ host: 'upstream:3000', origin: 'https://music.example.com', 'x-forwarded-host': 'music.example.com' }, 'POST')
    );
    expect(rewritingProxy.status).toBe(200);
    const crossSite = proxy(
      reqWithHosts({ host: 'upstream:3000', origin: 'https://evil.example', 'x-forwarded-host': 'music.example.com' }, 'POST')
    );
    expect(crossSite.status).toBe(403);
    const direct = proxy(reqWithHosts({ host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' }, 'POST'));
    expect(direct.status).toBe(200);
  });

  it('matches Origin against X-Forwarded-Host behind a trusted proxy', async () => {
    const proxy = await loadProxy({ TRUST_PROXY: '1' });
    const viaProxy = proxy(
      reqWithHosts({ host: 'upstream:3000', origin: 'https://music.example.com', 'x-forwarded-host': 'music.example.com' }, 'POST')
    );
    expect(viaProxy.status).toBe(200);
    const crossSite = proxy(
      reqWithHosts({ host: 'upstream:3000', origin: 'https://evil.example', 'x-forwarded-host': 'music.example.com' }, 'POST')
    );
    expect(crossSite.status).toBe(403);
  });
});

describe('clientIp', () => {
  it('ignores X-Forwarded-For entirely when TRUST_PROXY is unset or invalid', async () => {
    const { clientIp } = await loadAuth({ TRUST_PROXY: undefined });
    expect(clientIp(reqWithForwardedFor('203.0.113.9'))).toBe('direct');
    const zero = await loadAuth({ TRUST_PROXY: '0' });
    expect(zero.clientIp(reqWithForwardedFor('203.0.113.9'))).toBe('direct');
    const junk = await loadAuth({ TRUST_PROXY: 'yes' });
    expect(junk.clientIp(reqWithForwardedFor('203.0.113.9'))).toBe('direct');
  });

  it('with one trusted hop uses the entry the proxy appended (rightmost)', async () => {
    const { clientIp } = await loadAuth({ TRUST_PROXY: '1' });
    expect(clientIp(reqWithForwardedFor('198.51.100.7, 203.0.113.9'))).toBe('203.0.113.9');
    expect(clientIp(reqWithForwardedFor(' 203.0.113.9 '))).toBe('203.0.113.9');
  });

  it('with two trusted hops walks one further from the right', async () => {
    const { clientIp } = await loadAuth({ TRUST_PROXY: '2' });
    expect(clientIp(reqWithForwardedFor('192.0.2.1, 198.51.100.7, 203.0.113.9'))).toBe('198.51.100.7');
  });

  it('falls back to the first entry when the chain is shorter than the hop count, and to direct when empty', async () => {
    const { clientIp } = await loadAuth({ TRUST_PROXY: '3' });
    expect(clientIp(reqWithForwardedFor('203.0.113.9'))).toBe('203.0.113.9');
    expect(clientIp(reqWithForwardedFor())).toBe('direct');
  });
});

describe('safeEqual', () => {
  it('matches only byte-identical strings', async () => {
    const { safeEqual } = await loadAuth({});
    expect(safeEqual('secret-token', 'secret-token')).toBe(true);
    expect(safeEqual('', '')).toBe(true);
    expect(safeEqual('secret-token', 'secret-tokeN')).toBe(false);
    expect(safeEqual('secret-token', 'secret-toke')).toBe(false);
    expect(safeEqual('secret-token', '')).toBe(false);
  });

  it('compares UTF-8 bytes, so code-point-equal but byte-different strings differ', async () => {
    const { safeEqual } = await loadAuth({});
    // Same code-point count, different byte length: "é" is two bytes in UTF-8.
    expect(safeEqual('café', 'cafe')).toBe(false);
    expect(safeEqual('café', 'café')).toBe(true);
    // Same byte length, different content.
    expect(safeEqual('ab', 'é')).toBe(false);
  });

  it('still runs a constant-time comparison when the lengths differ', async () => {
    const crypto = await import('crypto');
    const spy = vi.spyOn(crypto.default, 'timingSafeEqual');
    try {
      const { safeEqual } = await loadAuth({});
      expect(safeEqual('short', 'much longer secret')).toBe(false);
      // A length mismatch must not return before timingSafeEqual runs, or response timing would
      // separate "wrong length" from "wrong content" for free.
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('password policy', () => {
  it('defaults to a 4-character minimum (PIN on a home LAN)', async () => {
    const auth = await loadAuth({ AUTH_MIN_PASSWORD_LENGTH: undefined });
    expect(auth.PASSWORD_MIN_LENGTH).toBe(4);
    expect(auth.validateNewPassword('123')).toMatch(/at least 4/);
    expect(auth.validateNewPassword('1234')).toBeNull();
  });

  it('honours AUTH_MIN_PASSWORD_LENGTH and clamps it to the maximum', async () => {
    const strict = await loadAuth({ AUTH_MIN_PASSWORD_LENGTH: '12' });
    expect(strict.PASSWORD_MIN_LENGTH).toBe(12);
    expect(strict.validateNewPassword('short')).toMatch(/at least 12/);
    expect(strict.validateNewPassword('long enough passphrase')).toBeNull();

    const huge = await loadAuth({ AUTH_MIN_PASSWORD_LENGTH: '9999' });
    expect(huge.PASSWORD_MIN_LENGTH).toBe(huge.PASSWORD_MAX_LENGTH);

    const tooSmall = await loadAuth({ AUTH_MIN_PASSWORD_LENGTH: '1' });
    expect(tooSmall.PASSWORD_MIN_LENGTH).toBe(4);
  });

  it('rejects passwords over the maximum length, counting code points after NFKC', async () => {
    const auth = await loadAuth({});
    expect(auth.validateNewPassword('x'.repeat(auth.PASSWORD_MAX_LENGTH + 1))).toMatch(/or fewer/);
    // "ﬁ" (U+FB01) normalises to two characters, so a 3-code-point raw string passes the 4 minimum.
    expect(auth.normalizePassword('ﬁ')).toBe('fi');
    expect(auth.validateNewPassword('ﬁab')).toBeNull();
  });
});
