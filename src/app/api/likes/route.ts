import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getLikedIds, getLikedTracks } from '@/lib/data';
import { userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const uid = userIdFrom(req);
  if (req.nextUrl.searchParams.get('full') === '1') {
    return NextResponse.json(getLikedTracks(uid));
  }
  return NextResponse.json(getLikedIds(uid));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const trackId = Number(body.trackId);
  if (!trackId) return NextResponse.json({ error: 'trackId required' }, { status: 400 });
  getDb().prepare('INSERT OR IGNORE INTO likes (user_id, track_id) VALUES (?, ?)').run(userIdFrom(req), trackId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const trackId = Number(req.nextUrl.searchParams.get('trackId'));
  if (!trackId) return NextResponse.json({ error: 'trackId required' }, { status: 400 });
  getDb().prepare('DELETE FROM likes WHERE user_id = ? AND track_id = ?').run(userIdFrom(req), trackId);
  return NextResponse.json({ ok: true });
}
