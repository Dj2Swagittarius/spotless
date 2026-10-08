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

afterEach(() => {
  delete process.env.TRUST_PROXY;
  delete process.env.AUTH_MIN_PASSWORD_LENGTH;
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
