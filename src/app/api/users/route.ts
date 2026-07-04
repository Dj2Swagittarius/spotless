import { NextRequest, NextResponse } from 'next/server';
import { listUsers, createUser, getUser, userIdFrom, isAdmin } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const hasCookie = req.cookies.get('uid')?.value !== undefined;
  const current = hasCookie ? getUser(userIdFrom(req)) : null;
  return NextResponse.json({
    users: listUsers(),
    current: current ? { ...current, isAdmin: isAdmin(req) } : null,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? '').trim().slice(0, 30);
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  try {
    return NextResponse.json(createUser(name), { status: 201 });
  } catch {
    return NextResponse.json({ error: 'name already taken' }, { status: 400 });
  }
}
