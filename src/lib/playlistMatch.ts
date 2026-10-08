import type Database from 'better-sqlite3';

/**
 * Matching between "wanted" songs (from a Spotify import, or a placeholder row
 * left behind by one) and tracks in the local library. Shared by the Spotify
 * importer and the post-scan placeholder resolver so both agree on what counts
 * as the same song.
 */

export interface WantedTrack {
  title: string;
  artist: string;
  album: string;
  durationSec: number;
}

/** Normalize for matching: lowercase, drop "(feat. …)" / bracket noise and punctuation. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\((feat|ft|with|remaster)[^)]*\)|\[[^\]]*\]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface LocalIndex {
  /** Track id for a wanted song, or undefined when the library has nothing close enough. */
  find(w: WantedTrack): number | undefined;
}

/** One pass over the library; reuse the index for many lookups. */
export function buildLocalIndex(db: Database.Database): LocalIndex {
  const local = db
    .prepare(
      `SELECT t.id, t.title, t.duration, a.name AS artist
       FROM tracks t JOIN artists a ON a.id = t.artist_id`
    )
    .all() as { id: number; title: string; duration: number; artist: string }[];

  const byArtistTitle = new Map<string, number>();
  const byTitle = new Map<string, { id: number; duration: number }[]>();
  for (const t of local) {
    const titleKey = norm(t.title);
    byArtistTitle.set(`${norm(t.artist)}|${titleKey}`, t.id);
    const list = byTitle.get(titleKey) ?? [];
    list.push({ id: t.id, duration: t.duration });
    byTitle.set(titleKey, list);
  }

  return {
    find(w) {
      const exact = byArtistTitle.get(`${norm(w.artist)}|${norm(w.title)}`);
      if (exact !== undefined) return exact;
      // fallback: same title and duration within 5s (covers artist-name spelling differences)
      const candidates = byTitle.get(norm(w.title)) ?? [];
      return candidates.find((c) => Math.abs(c.duration - w.durationSec) <= 5)?.id;
    },
  };
}

/** Next free position across real tracks and placeholders of a playlist. */
export function nextPosition(db: Database.Database, playlistId: number): number {
  const row = db
    .prepare(
      `SELECT MAX(p) AS m FROM (
         SELECT MAX(position) AS p FROM playlist_tracks WHERE playlist_id = ?
         UNION ALL
         SELECT MAX(position) AS p FROM playlist_placeholders WHERE playlist_id = ?
       )`
    )
    .get(playlistId, playlistId) as { m: number | null };
  return (row.m ?? 0) + 1;
}

/**
 * Turn placeholders into real playlist entries wherever the library now has the
 * song. Keeps the placeholder's position. Returns how many were resolved.
 */
export function resolvePlaceholders(db: Database.Database, playlistId?: number): number {
  const rows = (
    playlistId !== undefined
      ? db.prepare('SELECT * FROM playlist_placeholders WHERE playlist_id = ?').all(playlistId)
      : db.prepare('SELECT * FROM playlist_placeholders').all()
  ) as { id: number; playlist_id: number; position: number; title: string; artist: string; album: string; duration: number }[];
  if (rows.length === 0) return 0;

  const index = buildLocalIndex(db);
  const ins = db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)');
  const del = db.prepare('DELETE FROM playlist_placeholders WHERE id = ?');
  let resolved = 0;
  db.transaction(() => {
    for (const r of rows) {
      const trackId = index.find({ title: r.title, artist: r.artist, album: r.album, durationSec: r.duration });
      if (trackId === undefined) continue;
      ins.run(r.playlist_id, trackId, r.position);
      del.run(r.id);
      resolved++;
    }
  })();
  if (resolved) console.log(`playlists: resolved ${resolved} placeholder${resolved === 1 ? '' : 's'}`);
  return resolved;
}
