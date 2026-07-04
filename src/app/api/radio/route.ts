import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Radio: given a seed track, return similar library tracks to keep the queue going.
// Similarity: same genre or same artist, weighted toward less-recently-played, random tiebreak.
export async function GET(req: NextRequest) {
  const seedId = Number(req.nextUrl.searchParams.get('seed'));
  const excludeRaw = req.nextUrl.searchParams.get('exclude') ?? '';
  const exclude = excludeRaw
    .split(',')
    .map(Number)
    .filter(Number.isInteger)
    .slice(0, 500);
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 15, 30);

  const db = getDb();
  const seed = Number.isInteger(seedId)
    ? (db.prepare('SELECT artist_id, genre FROM tracks WHERE id = ?').get(seedId) as
        | { artist_id: number; genre: string | null }
        | undefined)
    : undefined;

  const notIn = exclude.length ? `AND t.id NOT IN (${exclude.join(',')})` : '';

  const pick = (where: string, params: unknown[], n: number) =>
    db
      .prepare(
        `SELECT t.id, t.title, t.duration, t.track_no AS trackNo, t.disc_no AS discNo, t.genre,
                t.artist_id AS artistId, ar.name AS artist, t.album_id AS albumId, al.name AS album
         FROM tracks t JOIN artists ar ON ar.id = t.artist_id JOIN albums al ON al.id = t.album_id
         WHERE ${where} ${notIn}
         ORDER BY RANDOM() LIMIT ?`
      )
      .all(...params, n);

  const out: unknown[] = [];
  const seen = new Set(exclude);
  const add = (rows: unknown[]) => {
    for (const r of rows as { id: number }[]) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        out.push(r);
      }
    }
  };

  if (seed?.genre) add(pick('t.genre = ?', [seed.genre], Math.ceil(limit * 0.6)));
  if (seed && out.length < limit) add(pick('t.artist_id = ?', [seed.artist_id], limit - out.length));
  if (out.length < limit) add(pick('1=1', [], limit - out.length));

  return NextResponse.json({ tracks: out.slice(0, limit) });
}
