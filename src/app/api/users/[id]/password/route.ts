import { NextRequest, NextResponse } from 'next/server';
import {
  AuthBusyError,
  createSession,
  hashPassword,
  revokeUserSessions,
  sessionFromRequest,
  setSessionCookie,
  validateNewPassword,
  verifyPassword,
} from '@/lib/auth';
import { ADMIN_USER_ID, getAuthUser } from '@/lib/user';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  const { id: idRaw } = await params;
  const targetId = Number(idRaw);
  const target = Number.isInteger(targetId) ? getAuthUser(targetId) : null;
  if (!target) return NextResponse.json({ error: 'Unknown profile.' }, { status: 404 });

  const isSelf = session.userId === targetId;
  const isAdmin = session.userId === ADMIN_USER_ID;
  if (!isSelf && !isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const currentPassword = String(body.currentPassword ?? '');
  const newPassword = String(body.newPassword ?? '');
  const passwordError = validateNewPassword(newPassword);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

  let newHash: string;
  try {
    // Changing your own password requires the existing password, even for admin.
    if (isSelf && (!target.passwordHash || !(await verifyPassword(currentPassword, target.passwordHash)))) {
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 });
    }
    newHash = await hashPassword(newPassword);
  } catch (err) {
    if (err instanceof AuthBusyError) return NextResponse.json({ error: err.message }, { status: 429 });
    throw err;
  }

  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, targetId);
  revokeUserSessions(targetId);

  const res = NextResponse.json({ ok: true });
  res.headers.set('Cache-Control', 'no-store');
  // A self-change revokes every old session and replaces this browser with one fresh session.
  if (isSelf) setSessionCookie(res, req, createSession(targetId));
  return res;
}
