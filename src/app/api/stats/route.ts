import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

const PERIODS: Record<string, string | null> = {
  week: '-7 days',
  month: '-30 days',
  year: '-365 days',
  all: null,
};

export async function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get('period') ?? 'month';
  const offset = PERIODS[period] === undefined ? '-30 days' : PERIODS[period];
  const uid = userIdFrom(req);
  const where = offset
    ? `WHERE h.user_id = ${uid} AND h.played_at >= datetime('now', '${offset}')`
    : `WHERE h.user_id = ${uid}`;

  const db = getDb();

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS plays, COALESCE(SUM(t.duration), 0) AS seconds, COUNT(DISTINCT t.artist_id) AS artists, COUNT(DISTINCT h.track_id) AS uniqueTracks
       FROM history h JOIN tracks t ON t.id = h.track_id ${where}`
    )
    .get();

  const topArtists = db
    .prepare(
      `SELECT ar.id, ar.name, COUNT(*) AS plays, SUM(t.duration) AS seconds
       FROM history h JOIN tracks t ON t.id = h.track_id JOIN artists ar ON ar.id = t.artist_id
       ${where} GROUP BY ar.id ORDER BY plays DESC LIMIT 10`
    )
    .all();

  const topTracks = db
    .prepare(
      `SELECT t.id, t.title, t.album_id AS albumId, ar.name AS artist, COUNT(*) AS plays
       FROM history h JOIN tracks t ON t.id = h.track_id JOIN artists ar ON ar.id = t.artist_id
       ${where} GROUP BY t.id ORDER BY plays DESC LIMIT 10`
    )
    .all();

  const topAlbums = db
    .prepare(
      `SELECT al.id, al.name, ar.name AS artist, COUNT(*) AS plays
       FROM history h JOIN tracks t ON t.id = h.track_id JOIN albums al ON al.id = t.album_id JOIN artists ar ON ar.id = al.artist_id
       ${where} GROUP BY al.id ORDER BY plays DESC LIMIT 10`
    )
    .all();

  // plays per day for the last 30 days (for the activity strip)
  const daily = db
    .prepare(
      `SELECT date(h.played_at) AS day, COUNT(*) AS plays
       FROM history h WHERE h.user_id = ${uid} AND h.played_at >= datetime('now', '-30 days')
       GROUP BY day ORDER BY day`
    )
    .all();

  return NextResponse.json({ period, totals, topArtists, topTracks, topAlbums, daily });
}
