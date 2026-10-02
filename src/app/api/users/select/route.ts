import { NextRequest, NextResponse } from 'next/server';
import {
  burnPasswordCheck,
  clearLoginFailures,
  clearSessionCookie,
  clientIp,
  createSession,
  getLoginBlock,
  hashPassword,
  recordLoginFailure,
  revokeSessionToken,
  setSessionCookie,
  validateNewPassword,
  verifyPassword,
} from '@/lib/auth';
import { getAuthUser, legacyBootstrapAllowed, ADMIN_USER_ID } from '@/lib/user';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  const password = String(body.password ?? '');
  const userId = Number.isInteger(id) && id > 0 ? id : 0;
  const ip = clientIp(req);

  const block = getLoginBlock(userId, ip);
  if (block.blocked) {
    const res = NextResponse.json({ error: 'Too many login attempts. Try again shortly.' }, { status: 429 });
    res.headers.set('Retry-After', String(block.retryAfter));
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }

  const user = userId ? getAuthUser(userId) : null;
  if (!user) {
    burnPasswordCheck(password);
    recordLoginFailure(userId, ip);
    return NextResponse.json({ error: 'Invalid profile or password.' }, { status: 401 });
  }

  // Upgrade path from old passwordless Spotless: only admin may claim a password,
  // and only while no web password exists anywhere yet. This path permanently closes after use.
  if (!user.passwordHash) {
    if (user.id !== ADMIN_USER_ID || !legacyBootstrapAllowed()) {
      burnPasswordCheck(password);
      return NextResponse.json({ error: 'This profile has no password yet. Ask the admin to set one.' }, { status: 403 });
    }
    const passwordError = validateNewPassword(password);
    if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });
    getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash IS NULL').run(hashPassword(password), user.id);
  } else if (!verifyPassword(password, user.passwordHash)) {
    recordLoginFailure(user.id, ip);
    return NextResponse.json({ error: 'Invalid profile or password.' }, { status: 401 });
  }

  clearLoginFailures(user.id, ip);
  const fresh = getAuthUser(user.id)!;
  const res = NextResponse.json({
    ok: true,
    user: { id: fresh.id, name: fresh.name, color: fresh.color, passwordSet: true },
  });
  res.headers.set('Cache-Control', 'no-store');
  setSessionCookie(res, req, createSession(user.id));
  return res;
}

export async function DELETE(req: NextRequest) {
  revokeSessionToken(req.cookies.get('spotless_session')?.value);
  const res = NextResponse.json({ ok: true });
  res.headers.set('Cache-Control', 'no-store');
  clearSessionCookie(res, req);
  return res;
}
