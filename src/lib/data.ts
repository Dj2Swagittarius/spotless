import { getDb } from './db';
import type { Track, Album, Artist, Playlist, HomeSection } from './types';

const TRACK_SELECT = `
  SELECT t.id, t.title, t.duration, t.track_no AS trackNo, t.disc_no AS discNo, t.genre, t.gain,
         t.artist_id AS artistId, ar.name AS artist,
         t.album_id AS albumId, al.name AS album
  FROM tracks t
  JOIN artists ar ON ar.id = t.artist_id
  JOIN albums al ON al.id = t.album_id
`;

export function getTrack(id: number): Track | undefined {
  return getDb().prepare(`${TRACK_SELECT} WHERE t.id = ?`).get(id) as Track | undefined;
}

export function getAlbums(): Album[] {
  return getDb()
    .prepare(
      `SELECT al.id, al.name, al.year, ar.name AS artist, ar.id AS artistId,
              COUNT(t.id) AS trackCount, COALESCE(SUM(t.duration), 0) AS duration
       FROM albums al JOIN artists ar ON ar.id = al.artist_id
       LEFT JOIN tracks t ON t.album_id = al.id
       GROUP BY al.id ORDER BY ar.name, al.year, al.name`
    )
    .all() as Album[];
}

export function getAlbum(id: number): (Album & { tracks: Track[] }) | null {
  const album = getDb()
    .prepare(
      `SELECT al.id, al.name, al.year, ar.name AS artist, ar.id AS artistId,
              COUNT(t.id) AS trackCount, COALESCE(SUM(t.duration), 0) AS duration
       FROM albums al JOIN artists ar ON ar.id = al.artist_id
       LEFT JOIN tracks t ON t.album_id = al.id
       WHERE al.id = ? GROUP BY al.id`
    )
    .get(id) as Album | undefined;
  if (!album) return null;
  const tracks = getDb()
    .prepare(`${TRACK_SELECT} WHERE t.album_id = ? ORDER BY t.disc_no, t.track_no, t.title`)
    .all(id) as Track[];
  return { ...album, tracks };
}

export function getArtists(): Artist[] {
  return getDb()
    .prepare(
      `SELECT ar.id, ar.name,
              COUNT(DISTINCT al.id) AS albumCount, COUNT(DISTINCT t.id) AS trackCount
       FROM artists ar
       LEFT JOIN albums al ON al.artist_id = ar.id
       LEFT JOIN tracks t ON t.artist_id = ar.id
       GROUP BY ar.id ORDER BY ar.name`
    )
    .all() as Artist[];
}

export function getArtist(id: number): (Artist & { albums: Album[]; topTracks: Track[] }) | null {
  const artist = getDb()
    .prepare(
      `SELECT ar.id, ar.name,
              COUNT(DISTINCT al.id) AS albumCount, COUNT(DISTINCT t.id) AS trackCount
       FROM artists ar
       LEFT JOIN albums al ON al.artist_id = ar.id
       LEFT JOIN tracks t ON t.artist_id = ar.id
       WHERE ar.id = ? GROUP BY ar.id`
    )
    .get(id) as Artist | undefined;
  if (!artist) return null;
  const albums = getDb()
    .prepare(
      `SELECT al.id, al.name, al.year, ar.name AS artist, ar.id AS artistId,
              COUNT(t.id) AS trackCount, COALESCE(SUM(t.duration), 0) AS duration
       FROM albums al JOIN artists ar ON ar.id = al.artist_id
       LEFT JOIN tracks t ON t.album_id = al.id
       WHERE al.artist_id = ? GROUP BY al.id ORDER BY al.year DESC, al.name`
    )
    .all(id) as Album[];
  const topTracks = getDb()
    .prepare(
      `${TRACK_SELECT}
       LEFT JOIN history h ON h.track_id = t.id
       WHERE t.artist_id = ?
       GROUP BY t.id ORDER BY COUNT(h.id) DESC, t.title LIMIT 10`
    )
    .all(id) as Track[];
  return { ...artist, albums, topTracks };
}

export function search(q: string): { tracks: Track[]; albums: Album[]; artists: Artist[] } {
  const db = getDb();
  // fuzzy-ish: split into terms, every term must match somewhere in title/artist/album,
  // punctuation ignored on both sides so "dont" finds "Don't"
  const terms = q
    .toLowerCase()
    .replace(/[%_]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 6);
  if (terms.length === 0) return { tracks: [], albums: [], artists: [] };

  const clean = (col: string) =>
    `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(${col}, '''', ''), '.', ''), ',', ''), '-', ' '))`;

  const trackWhere = terms.map(() => `(${clean('t.title')} LIKE ? OR ${clean('ar.name')} LIKE ? OR ${clean('al.name')} LIKE ?)`).join(' AND ');
  const trackParams = terms.flatMap((t) => [`%${t}%`, `%${t}%`, `%${t}%`]);
  const tracks = db
    .prepare(`${TRACK_SELECT} WHERE ${trackWhere} ORDER BY t.title LIMIT 50`)
    .all(...trackParams) as Track[];

  const albumWhere = terms.map(() => `(${clean('al.name')} LIKE ? OR ${clean('ar.name')} LIKE ?)`).join(' AND ');
  const albumParams = terms.flatMap((t) => [`%${t}%`, `%${t}%`]);
  const albums = db
    .prepare(
      `SELECT al.id, al.name, al.year, ar.name AS artist, ar.id AS artistId,
              COUNT(t.id) AS trackCount, COALESCE(SUM(t.duration), 0) AS duration
       FROM albums al JOIN artists ar ON ar.id = al.artist_id
       LEFT JOIN tracks t ON t.album_id = al.id
       WHERE ${albumWhere} GROUP BY al.id ORDER BY al.name LIMIT 20`
    )
    .all(...albumParams) as Album[];

  const artistWhere = terms.map(() => `${clean('ar.name')} LIKE ?`).join(' AND ');
  const artistParams = terms.map((t) => `%${t}%`);
  const artists = db
    .prepare(
      `SELECT ar.id, ar.name,
              COUNT(DISTINCT al.id) AS albumCount, COUNT(DISTINCT t.id) AS trackCount
       FROM artists ar
       LEFT JOIN albums al ON al.artist_id = ar.id
       LEFT JOIN tracks t ON t.artist_id = ar.id
       WHERE ${artistWhere} GROUP BY ar.id ORDER BY ar.name LIMIT 20`
    )
    .all(...artistParams) as Artist[];
  return { tracks, albums, artists };
}

function playlistArtIds(playlistId: number): number[] {
  return (
    getDb()
      .prepare(
        `SELECT DISTINCT t.album_id AS id FROM playlist_tracks pt
         JOIN tracks t ON t.id = pt.track_id
         WHERE pt.playlist_id = ? ORDER BY pt.position LIMIT 4`
      )
      .all(playlistId) as { id: number }[]
  ).map((r) => r.id);
}

export function getPlaylists(userId: number): Playlist[] {
  const lists = getDb()
    .prepare(
      `SELECT p.id, p.name, p.description, p.created_at AS createdAt,
              COUNT(pt.track_id) AS trackCount, COALESCE(SUM(t.duration), 0) AS duration
       FROM playlists p
       LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
       LEFT JOIN tracks t ON t.id = pt.track_id
       WHERE p.user_id = ?
       GROUP BY p.id ORDER BY p.created_at DESC`
    )
    .all(userId) as Playlist[];
  for (const p of lists) p.artIds = playlistArtIds(p.id);
  return lists;
}

export function getPlaylist(id: number): (Playlist & { tracks: Track[] }) | null {
  const pl = getDb()
    .prepare(
      `SELECT p.id, p.name, p.description, p.created_at AS createdAt,
              COUNT(pt.track_id) AS trackCount, COALESCE(SUM(t.duration), 0) AS duration
       FROM playlists p
       LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
       LEFT JOIN tracks t ON t.id = pt.track_id
       WHERE p.id = ? GROUP BY p.id`
    )
    .get(id) as Playlist | undefined;
  if (!pl) return null;
  const tracks = getDb()
    .prepare(`${TRACK_SELECT} JOIN playlist_tracks pt ON pt.track_id = t.id WHERE pt.playlist_id = ? ORDER BY pt.position`)
    .all(id) as Track[];
  return { ...pl, artIds: playlistArtIds(id), tracks };
}

export function getLikedTracks(userId: number): Track[] {
  return getDb()
    .prepare(`${TRACK_SELECT} JOIN likes l ON l.track_id = t.id WHERE l.user_id = ? ORDER BY l.liked_at DESC`)
    .all(userId) as Track[];
}

export function getLikedIds(userId: number): number[] {
  return (getDb().prepare('SELECT track_id FROM likes WHERE user_id = ?').all(userId) as { track_id: number }[]).map(
    (r) => r.track_id
  );
}

export function getHome(userId: number): HomeSection[] {
  const db = getDb();
  const sections: HomeSection[] = [];

  const recent = db
    .prepare(
      `${TRACK_SELECT}
       JOIN (SELECT track_id, MAX(played_at) AS lp FROM history WHERE user_id = ${userId} GROUP BY track_id ORDER BY lp DESC LIMIT 12) r
         ON r.track_id = t.id
       ORDER BY r.lp DESC`
    )
    .all() as Track[];
  if (recent.length > 0) sections.push({ title: 'Recently played', kind: 'tracks', tracks: recent });

  const top = db
    .prepare(
      `${TRACK_SELECT}
       JOIN history h ON h.track_id = t.id AND h.user_id = ${userId}
       GROUP BY t.id ORDER BY COUNT(h.id) DESC LIMIT 12`
    )
    .all() as Track[];
  if (top.length > 0) sections.push({ title: 'Your top tracks', kind: 'tracks', tracks: top });

  // mixes by top artists from history (fallback: random artists)
  let mixArtists = db
    .prepare(
      `SELECT t.artist_id AS id, ar.name FROM history h
       JOIN tracks t ON t.id = h.track_id JOIN artists ar ON ar.id = t.artist_id
       WHERE h.user_id = ${userId}
       GROUP BY t.artist_id ORDER BY COUNT(h.id) DESC LIMIT 4`
    )
    .all() as { id: number; name: string }[];
  if (mixArtists.length < 4) {
    const extra = db
      .prepare(
        `SELECT ar.id, ar.name FROM artists ar JOIN tracks t ON t.artist_id = ar.id
         WHERE ar.id NOT IN (${mixArtists.map(() => '?').join(',') || 'NULL'})
         GROUP BY ar.id HAVING COUNT(t.id) >= 3 ORDER BY RANDOM() LIMIT ?`
      )
      .all(...mixArtists.map((a) => a.id), 4 - mixArtists.length) as { id: number; name: string }[];
    mixArtists = mixArtists.concat(extra);
  }
  for (const a of mixArtists) {
    const tracks = db.prepare(`${TRACK_SELECT} WHERE t.artist_id = ? ORDER BY RANDOM() LIMIT 25`).all(a.id) as Track[];
    if (tracks.length >= 3) sections.push({ title: `${a.name} Mix`, kind: 'mix', tracks });
  }

  // genre mixes
  const genres = db
    .prepare(`SELECT genre, COUNT(*) AS n FROM tracks WHERE genre IS NOT NULL GROUP BY genre HAVING n >= 5 ORDER BY n DESC LIMIT 3`)
    .all() as { genre: string }[];
  for (const g of genres) {
    const tracks = db.prepare(`${TRACK_SELECT} WHERE t.genre = ? ORDER BY RANDOM() LIMIT 25`).all(g.genre) as Track[];
    sections.push({ title: `${g.genre} Mix`, kind: 'mix', tracks });
  }

  // decade mixes from album years
  const decades = db
    .prepare(
      `SELECT (al.year / 10) * 10 AS decade, COUNT(t.id) AS n
       FROM tracks t JOIN albums al ON al.id = t.album_id
       WHERE al.year IS NOT NULL AND al.year >= 1950
       GROUP BY decade HAVING n >= 10 ORDER BY n DESC LIMIT 2`
    )
    .all() as { decade: number }[];
  for (const d of decades) {
    const tracks = db
      .prepare(`${TRACK_SELECT} WHERE al.year >= ? AND al.year < ? ORDER BY RANDOM() LIMIT 25`)
      .all(d.decade, d.decade + 10) as Track[];
    if (tracks.length >= 5) sections.push({ title: `${d.decade}s Mix`, kind: 'mix', tracks });
  }

  // forgotten favorites: played 3+ times ever (or liked), not played in 60 days
  const forgotten = db
    .prepare(
      `${TRACK_SELECT}
       LEFT JOIN likes l ON l.track_id = t.id AND l.user_id = ${userId}
       JOIN history h ON h.track_id = t.id AND h.user_id = ${userId}
       GROUP BY t.id
       HAVING (COUNT(h.id) >= 3 OR l.track_id IS NOT NULL)
          AND MAX(h.played_at) < datetime('now', '-60 days')
       ORDER BY RANDOM() LIMIT 25`
    )
    .all() as Track[];
  if (forgotten.length >= 5) sections.push({ title: 'Forgotten favorites', kind: 'mix', tracks: forgotten });

  const newAlbums = db
    .prepare(
      `SELECT al.id, al.name, al.year, ar.name AS artist, ar.id AS artistId,
              COUNT(t.id) AS trackCount, COALESCE(SUM(t.duration), 0) AS duration
       FROM albums al JOIN artists ar ON ar.id = al.artist_id
       LEFT JOIN tracks t ON t.album_id = al.id
       GROUP BY al.id ORDER BY MAX(t.mtime) DESC LIMIT 12`
    )
    .all() as Album[];
  if (newAlbums.length > 0) sections.push({ title: 'Recently added', kind: 'albums', albums: newAlbums });

  return sections;
}
