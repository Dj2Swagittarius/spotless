import { NextRequest, NextResponse } from 'next/server';
import { userIdFrom, getUser } from '@/lib/user';
import { getAppPassword, regenerateAppPassword } from '@/lib/subsonic';

export const dynamic = 'force-dynamic';

// Each profile manages its own mobile-app (Subsonic) credential.
export async function GET(req: NextRequest) {
  const uid = userIdFrom(req);
  const user = getUser(uid);
  if (!user) return NextResponse.json({ error: 'no profile' }, { status: 400 });
  return NextResponse.json({ username: user.name, password: getAppPassword(uid) });
}

export async function POST(req: NextRequest) {
  const uid = userIdFrom(req);
  const user = getUser(uid);
  if (!user) return NextResponse.json({ error: 'no profile' }, { status: 400 });
  return NextResponse.json({ username: user.name, password: regenerateAppPassword(uid) });
}
