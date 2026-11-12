import { getDb } from './db';
import { TRACK_SELECT } from './data';
import type { Track } from './types';

/**
 * Radio: library tracks similar to a seed, to keep a queue going. Same genre or same artist, random
 * order, then anything at all to fill up; ids in `exclude` (what was just played) are left out.
 */
export function similarTracks(seedId: number, exclude: number[], limit: number): Track[] {
  const db = getDb();
  const seed = Number.isInteger(seedId)
    ? (db.prepare('SELECT artist_id, genre FROM tracks WHERE id = ?').get(seedId) as
        { artist_id: number; genre: string | null } | undefined)
    : undefined;

  const ids = exclude.filter(Number.isInteger).slice(0, 500);
  const notIn = ids.length ? `AND t.id NOT IN (${ids.join(',')})` : '';

  // same column set as every other track endpoint so radio-queued tracks carry gain etc.
  const pick = (where: string, params: unknown[], n: number) =>
    db.prepare(`${TRACK_SELECT} WHERE ${where} ${notIn} ORDER BY RANDOM() LIMIT ?`).all(...params, n) as Track[];

  const out: Track[] = [];
  const seen = new Set(ids);
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

  return out.slice(0, limit);
}
