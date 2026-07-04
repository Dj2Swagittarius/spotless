import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  const user = Number.isInteger(id) ? getUser(id) : null;
  if (!user) return NextResponse.json({ error: 'unknown user' }, { status: 400 });
  const res = NextResponse.json({ ok: true, user });
  res.cookies.set('uid', String(user.id), { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('uid');
  return res;
}
