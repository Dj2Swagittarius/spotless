import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { TRACK_SELECT } from '@/lib/data';
import type { Track } from '@/lib/types';

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
  const requested = Number(req.nextUrl.searchParams.get('limit'));
  // floor before binding: SQLite rejects a fractional LIMIT with a datatype mismatch
  const limit = Number.isFinite(requested) && requested >= 1 ? Math.min(Math.floor(requested), 30) : 15;

  const db = getDb();
  const seed = Number.isInteger(seedId)
    ? (db.prepare('SELECT artist_id, genre FROM tracks WHERE id = ?').get(seedId) as
        | { artist_id: number; genre: string | null }
        | undefined)
    : undefined;

  const notIn = exclude.length ? `AND t.id NOT IN (${exclude.join(',')})` : '';

  // same column set as every other track endpoint so radio-queued tracks carry gain etc.
  const pick = (where: string, params: unknown[], n: number) =>
    db.prepare(`${TRACK_SELECT} WHERE ${where} ${notIn} ORDER BY RANDOM() LIMIT ?`).all(...params, n) as Track[];

  const out: Track[] = [];
  const seen = new Set(exclude);
  const add = (rows: Track[]) => {
    for (const r of rows) {
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
