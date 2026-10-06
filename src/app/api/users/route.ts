import { NextRequest, NextResponse } from 'next/server';
import { AuthBusyError, createSession, hashPassword, setSessionCookie, validateNewPassword } from '@/lib/auth';
import { createUser, currentUserFrom, isAdmin, legacyBootstrapAllowed, listUsers, requireAdmin } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const current = currentUserFrom(req);
  const res = NextResponse.json({
    users: listUsers(),
    current: current ? { ...current, isAdmin: isAdmin(req) } : null,
    bootstrapAllowed: legacyBootstrapAllowed(),
  });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export async function POST(req: NextRequest) {
  const users = listUsers();
  if (users.length > 0) {
    const denied = requireAdmin(req);
    if (denied) return denied;
  }

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? '').trim().slice(0, 30);
  const password = String(body.password ?? '');
  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
  const passwordError = validateNewPassword(password);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

  try {
    const user = createUser(name, await hashPassword(password));
    const res = NextResponse.json(user, { status: 201 });
    res.headers.set('Cache-Control', 'no-store');
    // Fresh install: authenticate the first/admin user immediately so the setup wizard can continue.
    if (users.length === 0) setSessionCookie(res, req, createSession(user.id));
    return res;
  } catch (err) {
    if (err instanceof AuthBusyError) return NextResponse.json({ error: err.message }, { status: 429 });
    return NextResponse.json({ error: 'Name already taken.' }, { status: 400 });
  }
}
