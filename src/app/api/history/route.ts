import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { scrobbleTrack, updateNowPlaying } from '@/lib/lastfm';
import { userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const trackId = Number(body.trackId);
  if (!trackId) return NextResponse.json({ error: 'trackId required' }, { status: 400 });
  const uid = userIdFrom(req);
  getDb().prepare('INSERT INTO history (user_id, track_id) VALUES (?, ?)').run(uid, trackId);
  updateNowPlaying(uid, trackId);
  scrobbleTrack(uid, trackId);
  return NextResponse.json({ ok: true });
}
