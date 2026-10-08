import crypto from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { getDb } from './db';

export const SESSION_COOKIE = 'spotless_session';
// 4 allows a PIN on a home LAN; raise it with AUTH_MIN_PASSWORD_LENGTH when exposing Spotless publicly.
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_MIN_LENGTH = (() => {
  const n = Number(process.env.AUTH_MIN_PASSWORD_LENGTH);
  return Number.isInteger(n) && n >= 4 ? Math.min(n, PASSWORD_MAX_LENGTH) : 4;
})();

const SESSION_ABSOLUTE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const SESSION_IDLE_SECONDS = 60 * 60 * 24 * 7; // 7 days
const SESSION_TOUCH_SECONDS = 60 * 15; // write last_seen at most every 15 min

// OWASP scrypt option: N=2^15, r=8, p=3 (~32 MiB per derivation).
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 3;
const SCRYPT_KEYLEN = 32;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;

// scrypt runs on libuv's small threadpool, which file streaming also uses. Cap
// concurrent derivations and shed excess load so login floods can't stall playback.
const SCRYPT_MAX_ACTIVE = 2;
const SCRYPT_MAX_QUEUED = 16;
let scryptActive = 0;
const scryptQueue: (() => void)[] = [];

/** Thrown when too many password checks are already in flight. */
export class AuthBusyError extends Error {
  constructor() {
    super('Too many sign-in attempts in progress. Try again shortly.');
  }
}

async function derive(password: string, salt: Buffer, keylen: number, N: number, r: number, p: number): Promise<Buffer> {
  if (scryptActive >= SCRYPT_MAX_ACTIVE) {
    if (scryptQueue.length >= SCRYPT_MAX_QUEUED) throw new AuthBusyError();
    await new Promise<void>((resolve) => scryptQueue.push(resolve));
  }
  scryptActive++;
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      crypto.scrypt(password, salt, keylen, { N, r, p, maxmem: SCRYPT_MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)))
    );
  } finally {
    scryptActive--;
    scryptQueue.shift()?.();
  }
}

export interface AuthSession {
  userId: number;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
}

export function normalizePassword(value: string): string {
  return value.normalize('NFKC');
}

export function validateNewPassword(raw: string): string | null {
  const password = normalizePassword(raw);
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`;
  }
  return null;
}

export async function hashPassword(raw: string): Promise<string> {
  const password = normalizePassword(raw);
  const salt = crypto.randomBytes(16);
  const derived = await derive(password, salt, SCRYPT_KEYLEN, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(raw: string, encoded: string): Promise<boolean> {
  try {
    const [kind, nRaw, rRaw, pRaw, saltRaw, digestRaw] = encoded.split('$');
    if (kind !== 'scrypt' || !nRaw || !rRaw || !pRaw || !saltRaw || !digestRaw) return false;
    const N = Number(nRaw);
    const r = Number(rRaw);
    const p = Number(pRaw);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || N < 2 || r < 1 || p < 1) return false;
    const expected = Buffer.from(digestRaw, 'base64url');
    if (expected.length < 16 || expected.length > 128) return false;
    const actual = await derive(normalizePassword(raw), Buffer.from(saltRaw, 'base64url'), expected.length, N, r, p);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (err) {
    if (err instanceof AuthBusyError) throw err;
    return false;
  }
}

/** Burn roughly one real password-verification cost for unknown/unconfigured users. */
export async function burnPasswordCheck(raw: string): Promise<void> {
  await derive(normalizePassword(raw), Buffer.from('spotless-auth-fake-salt-v1'), SCRYPT_KEYLEN, SCRYPT_N, SCRYPT_R, SCRYPT_P);
}

function sessionTokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = sessionTokenHash(token);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_ABSOLUTE_SECONDS;
  const db = getDb();
  db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ? OR last_seen_at <= ?').run(now, now - SESSION_IDLE_SECONDS);
  db.prepare(
    'INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)'
  ).run(tokenHash, userId, now, expiresAt, now);
  return token;
}

export function validateSessionToken(token: string | undefined | null): AuthSession | null {
  if (!token || token.length < 32 || token.length > 256) return null;
  const tokenHash = sessionTokenHash(token);
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.user_id AS userId, s.token_hash AS tokenHash, s.created_at AS createdAt,
              s.expires_at AS expiresAt, s.last_seen_at AS lastSeenAt
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND u.password_hash IS NOT NULL`
    )
    .get(tokenHash) as AuthSession | undefined;
  if (!row) return null;

  const now = Math.floor(Date.now() / 1000);
  if (row.expiresAt <= now || row.lastSeenAt <= now - SESSION_IDLE_SECONDS) {
    db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  if (row.lastSeenAt <= now - SESSION_TOUCH_SECONDS) {
    db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?').run(now, tokenHash);
    row.lastSeenAt = now;
  }
  return row;
}

export function sessionFromRequest(req: NextRequest): AuthSession | null {
  return validateSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
}

export function revokeSessionToken(token: string | undefined | null): void {
  if (!token) return;
  getDb().prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(sessionTokenHash(token));
}

export function revokeUserSessions(userId: number): void {
  getDb().prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId);
}

/** First value of a comma-separated forwarding header, or null when absent/empty. */
function firstForwarded(req: NextRequest, name: string): string | null {
  const value = req.headers.get(name)?.split(',')[0]?.trim();
  return value ? value : null;
}

/**
 * Whether cookies must carry the Secure flag. X-Forwarded-Proto is honoured even without
 * TRUST_PROXY: a forged header can only make a cookie stricter, never expose it over http.
 */
export function secureCookieFor(req: NextRequest): boolean {
  const override = process.env.AUTH_SECURE_COOKIE?.trim().toLowerCase();
  if (override === 'true' || override === '1' || override === 'yes') return true;
  if (override === 'false' || override === '0' || override === 'no') return false;
  const forwardedProto = firstForwarded(req, 'x-forwarded-proto')?.toLowerCase();
  return forwardedProto === 'https' || req.nextUrl.protocol === 'https:';
}

/**
 * Reverse-proxy hops whose X-Forwarded-* headers may be believed (TRUST_PROXY).
 * 0 means no proxy is trusted and forwarded headers are treated as client-controlled.
 */
export function trustedProxyHops(): number {
  const hops = Number(process.env.TRUST_PROXY);
  return Number.isInteger(hops) && hops >= 1 ? hops : 0;
}

// host[:port] or [ipv6][:port]; rejects anything that could smuggle a scheme, userinfo or path
const HOST_PATTERN = /^(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)(?::\d{1,5})?$/i;

/**
 * Public origin of this request, for building absolute callback/redirect URLs. X-Forwarded-Host
 * is only believed behind a trusted proxy (TRUST_PROXY): a forged host would point OAuth
 * callbacks at an attacker's server. The scheme follows the same decision as secureCookieFor,
 * because a Secure cookie set alongside the redirect only travels back over https.
 * The Host header is preferred over nextUrl, which rewrites loopback addresses to "localhost":
 * a cookie set while browsing 127.0.0.1 would never reach a callback issued to localhost.
 */
export function requestOrigin(req: NextRequest): string {
  const hostHeader = req.headers.get('host')?.trim();
  let host = hostHeader && HOST_PATTERN.test(hostHeader) ? hostHeader : req.nextUrl.host;
  let protocol = req.nextUrl.protocol;
  if (trustedProxyHops() > 0) {
    const forwardedHost = firstForwarded(req, 'x-forwarded-host');
    if (forwardedHost && HOST_PATTERN.test(forwardedHost)) host = forwardedHost;
    const forwardedProto = firstForwarded(req, 'x-forwarded-proto')?.toLowerCase();
    if (forwardedProto === 'http' || forwardedProto === 'https') protocol = `${forwardedProto}:`;
  }
  if (secureCookieFor(req)) protocol = 'https:';
  if (!host) return req.nextUrl.origin;
  return `${protocol}//${host}`;
}

export function setSessionCookie(res: NextResponse, req: NextRequest, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookieFor(req),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_ABSOLUTE_SECONDS,
    priority: 'high',
  });
  // Remove the pre-authentication profile cookie used by older Spotless versions.
  res.cookies.set('uid', '', { path: '/', maxAge: 0, sameSite: 'lax' });
}

export function clearSessionCookie(res: NextResponse, req: NextRequest): void {
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: secureCookieFor(req),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    priority: 'high',
  });
  res.cookies.set('uid', '', { path: '/', maxAge: 0, sameSite: 'lax' });
}

/**
 * Client address for login throttling. X-Forwarded-For is client-controlled unless a
 * reverse proxy you run appends to it, so it is only read when TRUST_PROXY sets how many
 * proxy hops to trust; the entry that many hops from the right is the one your proxy saw.
 * Without it every request shares one bucket, so throttling is per profile.
 */
export function clientIp(req: NextRequest): string {
  const hops = trustedProxyHops();
  if (hops < 1) return 'direct';
  const chain = (req.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return chain[chain.length - hops] ?? chain[0] ?? 'direct';
}

function attemptKey(userId: number, ip: string): string {
  return crypto.createHash('sha256').update(`${userId}|${ip}`).digest('hex');
}

export function getLoginBlock(userId: number, ip: string): { blocked: boolean; retryAfter: number } {
  const key = attemptKey(userId, ip);
  const row = getDb()
    .prepare('SELECT blocked_until AS blockedUntil FROM auth_login_attempts WHERE key = ?')
    .get(key) as { blockedUntil: number } | undefined;
  const now = Math.floor(Date.now() / 1000);
  const retryAfter = Math.max(0, (row?.blockedUntil ?? 0) - now);
  return { blocked: retryAfter > 0, retryAfter };
}

export function recordLoginFailure(userId: number, ip: string): void {
  const db = getDb();
  const key = attemptKey(userId, ip);
  const now = Math.floor(Date.now() / 1000);
  const row = db
    .prepare('SELECT failures, window_started_at AS windowStartedAt FROM auth_login_attempts WHERE key = ?')
    .get(key) as { failures: number; windowStartedAt: number } | undefined;
  // 24h window, longer than the 15-minute maximum block, so the count can't reset between blocks
  const withinWindow = row && row.windowStartedAt >= now - 86400;
  const failures = withinWindow ? row.failures + 1 : 1;
  const windowStartedAt = withinWindow ? row.windowStartedAt : now;
  // Progressive backoff after five failures: 30s, 60s, 2m, 4m... capped at 15m.
  const blockedFor = failures >= 5 ? Math.min(900, 30 * 2 ** Math.min(5, failures - 5)) : 0;
  const blockedUntil = now + blockedFor;
  db.prepare(
    `INSERT INTO auth_login_attempts (key, failures, window_started_at, blocked_until)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       failures = excluded.failures,
       window_started_at = excluded.window_started_at,
       blocked_until = excluded.blocked_until`
  ).run(key, failures, windowStartedAt, blockedUntil);
}

export function clearLoginFailures(userId: number, ip: string): void {
  getDb().prepare('DELETE FROM auth_login_attempts WHERE key = ?').run(attemptKey(userId, ip));
}
