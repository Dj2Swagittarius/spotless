import { NextRequest, NextResponse } from 'next/server';
import { lastfmConfigured, lastfmSession, clearLastfmSession } from '@/lib/lastfm';
import { userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = lastfmSession(userIdFrom(req));
  return NextResponse.json({
    configured: lastfmConfigured(),
    connected: Boolean(session),
    username: session?.name ?? null,
  });
}

export async function DELETE(req: NextRequest) {
  clearLastfmSession(userIdFrom(req));
  return NextResponse.json({ ok: true });
}
