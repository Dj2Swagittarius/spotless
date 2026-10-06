import { getDb, getSetting } from '../db';
import { getTaste } from '../spotify';
import { getTrack } from '../data';
import { norm } from '../playlistMatch';
import type { Track } from '../types';

/**
 * What the DJ knows about the listener and the library. Kept compact so it fits
 * the context window of small local models (a few thousand tokens).
 */

const STOP = new Set(
  'the a an and or of to for me my some something song songs music play put on start make give with from like more less about that this into mix playlist please dj can you i want need new old good best really just get any all by in it is be'.split(' ')
);

const line = (t: { title: string; artist: string }) => `${t.title} | ${t.artist}`;

function rows<T>(sql: string, ...params: unknown[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

/** Library tracks that look relevant to what the listener just said (artist/genre/title hits). */
function requestHits(message: string): { artists: string[]; tracks: { title: string; artist: string }[] } {
  const words = message
    .toLowerCase()
    .split(/[^a-z0-9'&]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .slice(0, 12);
  if (words.length === 0) return { artists: [], tracks: [] };
  // single words plus adjacent pairs ("pink floyd", "hip hop")
  const phrases = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)];

  const artistRows = rows<{ id: number; name: string }>('SELECT id, name FROM artists');
  const matchedArtists = artistRows.filter((a) => {
    const n = norm(a.name);
    if (n.length < 3) return false;
    return phrases.some((p) => n === p || (p.length >= 5 && (n.includes(p) || p.includes(n))));
  }).slice(0, 4);

  const tracks: { title: string; artist: string }[] = [];
  for (const a of matchedArtists) {
    tracks.push(
      ...rows<{ title: string; artist: string }>(
        `SELECT t.title, ar.name AS artist FROM tracks t JOIN artists ar ON ar.id = t.artist_id
         WHERE t.artist_id = ? ORDER BY RANDOM() LIMIT 30`,
        a.id
      )
    );
  }

  const genres = rows<{ genre: string }>('SELECT DISTINCT genre FROM tracks WHERE genre IS NOT NULL');
  const matchedGenres = genres.filter((g) => phrases.some((p) => norm(g.genre).includes(p))).slice(0, 3);
  for (const g of matchedGenres) {
    tracks.push(
      ...rows<{ title: string; artist: string }>(
        `SELECT t.title, ar.name AS artist FROM tracks t JOIN artists ar ON ar.id = t.artist_id
         WHERE t.genre = ? ORDER BY RANDOM() LIMIT 25`,
        g.genre
      )
    );
  }

  // title words (e.g. "play bohemian rhapsody")
  for (const w of words.filter((x) => x.length >= 4).slice(0, 4)) {
    tracks.push(
      ...rows<{ title: string; artist: string }>(
        `SELECT t.title, ar.name AS artist FROM tracks t JOIN artists ar ON ar.id = t.artist_id
         WHERE LOWER(t.title) LIKE ? LIMIT 8`,
        `%${w}%`
      )
    );
  }
  return { artists: matchedArtists.map((a) => a.name), tracks };
}

export interface ListenerContext {
  nowPlaying?: { title: string; artist: string } | null;
  upNext?: { title: string; artist: string }[];
  localTime?: string;
}

export function buildListenerProfile(userId: number, userName: string, lastMessage: string, ctx: ListenerContext): string {
  const db = getDb();
  const counts = db
    .prepare('SELECT (SELECT COUNT(*) FROM tracks) AS tracks, (SELECT COUNT(*) FROM artists) AS artists, (SELECT COUNT(*) FROM albums) AS albums')
    .get() as { tracks: number; artists: number; albums: number };

  const topArtists = rows<{ name: string; plays: number }>(
    `SELECT ar.name, COUNT(*) AS plays FROM history h JOIN tracks t ON t.id = h.track_id JOIN artists ar ON ar.id = t.artist_id
     WHERE h.user_id = ? AND h.played_at >= datetime('now', '-90 days') GROUP BY ar.id ORDER BY plays DESC LIMIT 15`,
    userId
  );
  const topTracks = rows<{ title: string; artist: string; plays: number }>(
    `SELECT t.title, ar.name AS artist, COUNT(*) AS plays FROM history h JOIN tracks t ON t.id = h.track_id JOIN artists ar ON ar.id = t.artist_id
     WHERE h.user_id = ? GROUP BY t.id ORDER BY plays DESC LIMIT 15`,
    userId
  );
  const recent = rows<{ title: string; artist: string }>(
    `SELECT t.title, ar.name AS artist FROM (SELECT track_id, MAX(played_at) AS lp FROM history WHERE user_id = ? GROUP BY track_id ORDER BY lp DESC LIMIT 12) r
     JOIN tracks t ON t.id = r.track_id JOIN artists ar ON ar.id = t.artist_id ORDER BY r.lp DESC`,
    userId
  );
  const liked = rows<{ title: string; artist: string }>(
    `SELECT t.title, ar.name AS artist FROM likes l JOIN tracks t ON t.id = l.track_id JOIN artists ar ON ar.id = t.artist_id
     WHERE l.user_id = ? ORDER BY l.liked_at DESC LIMIT 15`,
    userId
  );
  const genres = rows<{ genre: string; n: number }>(
    'SELECT genre, COUNT(*) AS n FROM tracks WHERE genre IS NOT NULL GROUP BY genre ORDER BY n DESC LIMIT 20'
  );
  const decades = rows<{ decade: number; n: number }>(
    `SELECT (al.year / 10) * 10 AS decade, COUNT(*) AS n FROM tracks t JOIN albums al ON al.id = t.album_id
     WHERE al.year >= 1900 GROUP BY decade ORDER BY n DESC LIMIT 6`
  );
  const libraryArtists = rows<{ name: string }>(
    'SELECT ar.name FROM artists ar JOIN tracks t ON t.artist_id = ar.id GROUP BY ar.id ORDER BY COUNT(*) DESC LIMIT 200'
  );
  const recentlyAdded = rows<{ title: string; artist: string }>(
    'SELECT t.title, ar.name AS artist FROM tracks t JOIN artists ar ON ar.id = t.artist_id ORDER BY t.mtime DESC LIMIT 10'
  );
  const disliked = rows<{ name: string }>('SELECT name FROM discover_dislikes WHERE user_id = ? LIMIT 30', userId);
  const taste = getTaste(userId);

  let discoverNames: string[] = [];
  try {
    const cached = JSON.parse(getSetting(`discover_cache:${userId}`) ?? 'null');
    discoverNames = (cached?.artists ?? []).map((a: { name: string }) => a.name).slice(0, 12);
  } catch {
    // no discover cache yet
  }

  // a sample of playable songs: what they asked about, their favorites, plus variety
  const hits = requestHits(lastMessage);
  const variety = rows<{ title: string; artist: string }>(
    'SELECT t.title, ar.name AS artist FROM tracks t JOIN artists ar ON ar.id = t.artist_id ORDER BY RANDOM() LIMIT 40'
  );
  const pool = new Map<string, { title: string; artist: string }>();
  for (const t of [...hits.tracks, ...topTracks, ...liked, ...recent, ...recentlyAdded, ...variety]) {
    const k = `${norm(t.artist)}|${norm(t.title)}`;
    if (!pool.has(k) && pool.size < 160) pool.set(k, { title: t.title, artist: t.artist });
  }

  const parts: string[] = [];
  parts.push(`Listener: ${userName}.${ctx.localTime ? ` Their local time: ${ctx.localTime}.` : ''}`);
  parts.push(`Library: ${counts.tracks} tracks, ${counts.artists} artists, ${counts.albums} albums.`);
  if (ctx.nowPlaying) parts.push(`Now playing: ${line(ctx.nowPlaying)}`);
  if (ctx.upNext?.length) parts.push(`Up next: ${ctx.upNext.slice(0, 5).map(line).join('; ')}`);
  if (topArtists.length) parts.push(`Most played artists (90 days): ${topArtists.map((a) => `${a.name} (${a.plays})`).join(', ')}`);
  if (topTracks.length) parts.push(`All-time top tracks: ${topTracks.map((t) => `${line(t)} (${t.plays})`).join('; ')}`);
  if (recent.length) parts.push(`Recently played: ${recent.map(line).join('; ')}`);
  if (liked.length) parts.push(`Recently liked: ${liked.map(line).join('; ')}`);
  if (taste?.topArtists?.length) parts.push(`Spotify top artists: ${taste.topArtists.slice(0, 15).join(', ')}`);
  if (genres.length) parts.push(`Genres in library (tracks): ${genres.map((g) => `${g.genre} (${g.n})`).join(', ')}`);
  if (decades.length) parts.push(`Decades in library: ${decades.map((d) => `${d.decade}s (${d.n})`).join(', ')}`);
  if (discoverNames.length) parts.push(`Discover suggestions already shown (not in library): ${discoverNames.join(', ')}`);
  if (disliked.length) parts.push(`Never suggest these artists: ${disliked.map((d) => d.name).join(', ')}`);
  parts.push(`Library artists (by size): ${libraryArtists.map((a) => a.name).join(', ')}`);
  if (hits.artists.length) parts.push(`Library artists matching the request: ${hits.artists.join(', ')}`);
  parts.push(`Playable library songs (title | artist), a sample:\n${[...pool.values()].map(line).join('\n')}`);
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Matching the DJ's picks back to library tracks
// ---------------------------------------------------------------------------

/** Extra cleanup on top of playlistMatch.norm: "Song - Remastered 2011", "Song (Live)" */
const titleKey = (s: string) =>
  norm(s.replace(/\s+-\s+(\d{4}\s+)?(remaster|remastered|live|mono|stereo|radio edit|single version|edit)\b.*$/i, '').replace(/\([^)]*\)/g, ''));

export interface LibraryIndex {
  find(title: string, artist: string): number | undefined;
  artistId(name: string): number | undefined;
}

export function buildIndex(): LibraryIndex {
  const all = rows<{ id: number; title: string; artist: string; artistId: number }>(
    'SELECT t.id, t.title, ar.name AS artist, ar.id AS artistId FROM tracks t JOIN artists ar ON ar.id = t.artist_id'
  );
  const exact = new Map<string, number>();
  const byTitle = new Map<string, { id: number; artist: string }[]>();
  const artists = new Map<string, number>();
  for (const t of all) {
    const a = norm(t.artist);
    const k = titleKey(t.title);
    if (!exact.has(`${a}|${k}`)) exact.set(`${a}|${k}`, t.id);
    const list = byTitle.get(k) ?? [];
    list.push({ id: t.id, artist: a });
    byTitle.set(k, list);
    artists.set(a, t.artistId);
  }
  return {
    find(title, artist) {
      const a = norm(artist);
      const k = titleKey(title);
      const hit = exact.get(`${a}|${k}`);
      if (hit !== undefined) return hit;
      const candidates = byTitle.get(k) ?? [];
      // "The Beatles" vs "Beatles", "Jay-Z" vs "JAY Z"
      const close = candidates.find((c) => c.artist.includes(a) || a.includes(c.artist));
      if (close) return close.id;
      return candidates.length === 1 && !a ? candidates[0].id : undefined;
    },
    artistId(name) {
      const a = norm(name);
      if (artists.has(a)) return artists.get(a);
      for (const [k, id] of artists) if (k.length >= 4 && (k.includes(a) || a.includes(k))) return id;
      return undefined;
    },
  };
}

export function tracksByIds(ids: number[]): Track[] {
  return ids.map((id) => getTrack(id)).filter((t): t is Track => Boolean(t));
}

export function artistTracks(artistId: number, limit = 40): number[] {
  return rows<{ id: number }>('SELECT id FROM tracks WHERE artist_id = ? ORDER BY RANDOM() LIMIT ?', artistId, limit).map((r) => r.id);
}

export function genreTracks(genre: string, limit = 40): number[] {
  return rows<{ id: number }>('SELECT id FROM tracks WHERE LOWER(genre) LIKE ? ORDER BY RANDOM() LIMIT ?', `%${genre.toLowerCase()}%`, limit).map(
    (r) => r.id
  );
}

/**
 * Library tracks that flow from the seeds: same artists and genres first, the
 * listener's most played among them first, a little randomness for variety.
 * Used to turn a short pick from a small model into a full DJ set.
 */
export function similarTracks(userId: number, seedIds: number[], limit: number): number[] {
  if (!seedIds.length || limit <= 0) return [];
  const marks = seedIds.map(() => '?').join(',');
  const seeds = rows<{ artist_id: number; genre: string | null }>(`SELECT artist_id, genre FROM tracks WHERE id IN (${marks})`, ...seedIds);
  const artists = [...new Set(seeds.map((s) => s.artist_id))];
  const genres = [...new Set(seeds.map((s) => s.genre).filter((g): g is string => Boolean(g)))];
  const out: number[] = [];
  const seen = new Set(seedIds);
  const take = (list: { id: number }[]) => {
    for (const r of list) if (!seen.has(r.id) && out.length < limit) (seen.add(r.id), out.push(r.id));
  };
  const scored = (where: string, params: unknown[]) =>
    rows<{ id: number }>(
      `SELECT t.id FROM tracks t
       LEFT JOIN (SELECT track_id, COUNT(*) AS plays FROM history WHERE user_id = ? GROUP BY track_id) h ON h.track_id = t.id
       WHERE ${where}
       ORDER BY COALESCE(h.plays, 0) * 0.5 + ABS(RANDOM() % 10) DESC LIMIT ?`,
      userId,
      ...params,
      limit * 3
    );
  // alternate genre neighbours and the seeds' own artists so a set doesn't become one artist
  if (genres.length) take(scored(`t.genre IN (${genres.map(() => '?').join(',')}) AND t.artist_id NOT IN (${artists.map(() => '?').join(',')})`, [...genres, ...artists]).slice(0, Math.ceil(limit * 0.6)));
  // the seeds' own artists, capped so one artist doesn't take over the set
  take(scored(`t.artist_id IN (${artists.map(() => '?').join(',')})`, artists).slice(0, Math.ceil(limit * 0.4)));
  // then the listener's favourites from anywhere, then anything in the same genres
  take(scored('t.id IN (SELECT track_id FROM history WHERE user_id = ?)', [userId]));
  if (genres.length) take(scored(`t.genre IN (${genres.map(() => '?').join(',')})`, genres));
  take(scored('1 = 1', []));
  return out;
}
