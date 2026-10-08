import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { scrobbleTrack, updateNowPlaying } from '@/lib/lastfm';
import { userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

// Last.fm rejects scrobbles older than two weeks; anything outside this window is a
// client with a bad clock and gets stamped "now" instead.
const MAX_SCROBBLE_AGE_S = 14 * 24 * 3600;
const MAX_CLOCK_SKEW_S = 5 * 60;

/**
 * Listening events from the player.
 *   { trackId, event: 'start' }                 — the track began playing: Last.fm "now playing" only
 *   { trackId, event: 'played', startedAt? }    — enough of it was heard: history row + scrobble,
 *                                                 timestamped at `startedAt` (unix seconds) when given
 * A body with no `event` is an older client and counts as 'played'.
 */
export async function POST(req: NextRequest) {
  let body: { trackId?: unknown; event?: unknown; startedAt?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const trackId = Number(body.trackId);
  if (!Number.isInteger(trackId) || trackId <= 0) return NextResponse.json({ error: 'trackId required' }, { status: 400 });
  const event = body.event === undefined ? 'played' : body.event;
  if (event !== 'start' && event !== 'played') return NextResponse.json({ error: 'unknown event' }, { status: 400 });

  const uid = userIdFrom(req);
  if (event === 'start') {
    updateNowPlaying(uid, trackId);
    return NextResponse.json({ ok: true });
  }

  getDb().prepare('INSERT INTO history (user_id, track_id) VALUES (?, ?)').run(uid, trackId);
  const now = Math.floor(Date.now() / 1000);
  const startedAt = Number(body.startedAt);
  const playedAt =
    Number.isFinite(startedAt) && startedAt > now - MAX_SCROBBLE_AGE_S && startedAt < now + MAX_CLOCK_SKEW_S
      ? Math.floor(startedAt)
      : undefined;
  scrobbleTrack(uid, trackId, playedAt);
  return NextResponse.json({ ok: true });
}
