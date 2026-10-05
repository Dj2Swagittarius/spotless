import crypto from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { getDb } from './db';

export const SESSION_COOKIE = 'spotless_session';
export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 128;

const SESSION_ABSOLUTE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const SESSION_IDLE_SECONDS = 60 * 60 * 24 * 7; // 7 days
const SESSION_TOUCH_SECONDS = 60 * 15; // write last_seen at most every 15 min

// OWASP scrypt option: N=2^15, r=8, p=3 (~32 MiB per derivation).
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 3;
const SCRYPT_KEYLEN = 32;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;

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

export function hashPassword(raw: string): string {
  const password = normalizePassword(raw);
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export function verifyPassword(raw: string, encoded: string): boolean {
  try {
    const [kind, nRaw, rRaw, pRaw, saltRaw, digestRaw] = encoded.split('$');
    if (kind !== 'scrypt' || !nRaw || !rRaw || !pRaw || !saltRaw || !digestRaw) return false;
    const N = Number(nRaw);
    const r = Number(rRaw);
    const p = Number(pRaw);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || N < 2 || r < 1 || p < 1) return false;
    const expected = Buffer.from(digestRaw, 'base64url');
    if (expected.length < 16 || expected.length > 128) return false;
    const actual = crypto.scryptSync(normalizePassword(raw), Buffer.from(saltRaw, 'base64url'), expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Burn roughly one real password-verification cost for unknown/unconfigured users. */
export function burnPasswordCheck(raw: string): void {
  crypto.scryptSync(normalizePassword(raw), Buffer.from('spotless-auth-fake-salt-v1'), SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
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

function secureCookieFor(req: NextRequest): boolean {
  const override = process.env.AUTH_SECURE_COOKIE?.trim().toLowerCase();
  if (override === 'true' || override === '1' || override === 'yes') return true;
  if (override === 'false' || override === '0' || override === 'no') return false;
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  return forwardedProto === 'https' || req.nextUrl.protocol === 'https:';
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

export function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    'unknown'
  );
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
  const withinWindow = row && row.windowStartedAt >= now - 600;
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
