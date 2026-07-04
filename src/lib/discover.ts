import { getDb, getSetting, setSetting } from './db';
import { getTaste } from './spotify';

export interface DiscoverTrack {
  title: string;
  album: string;
  cover: string | null;
  previewUrl: string | null;
}

export interface DiscoverArtist {
  name: string;
  image: string | null;
  fans: number;
  deezerUrl: string;
  because: string[]; // library artists this suggestion is related to
  topTracks: DiscoverTrack[];
}

const cacheKey = (u: number) => `discover_cache:${u}`;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SEED_ARTISTS = 6;
const MAX_SUGGESTIONS = 12;

interface DeezerArtist {
  id: number;
  name: string;
  link: string;
  picture_medium: string | null;
  nb_fan: number;
}

async function deezer<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`https://api.deezer.com${path}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Top artists by play count (last 90 days), topped up with Spotify top artists, falling back to library size. */
function seedArtists(userId: number): string[] {
  const db = getDb();
  const played = db
    .prepare(
      `SELECT a.name, COUNT(*) AS plays
       FROM history h
       JOIN tracks t ON t.id = h.track_id
       JOIN artists a ON a.id = t.artist_id
       WHERE h.user_id = ? AND h.played_at >= datetime('now', '-90 days')
       GROUP BY a.id ORDER BY plays DESC LIMIT ?`
    )
    .all(userId, SEED_ARTISTS) as { name: string }[];

  const seeds = played.map((r) => r.name);
  const seen = new Set(seeds.map((s) => s.toLowerCase()));

  const spotifyTop = getTaste(userId)?.topArtists ?? [];
  for (const name of spotifyTop) {
    if (seeds.length >= SEED_ARTISTS + 4) break;
    if (!seen.has(name.toLowerCase())) {
      seeds.push(name);
      seen.add(name.toLowerCase());
    }
  }

  if (seeds.length >= 2) return seeds;

  const byTracks = db
    .prepare('SELECT a.name FROM artists a JOIN tracks t ON t.artist_id = a.id GROUP BY a.id ORDER BY COUNT(*) DESC LIMIT ?')
    .all(SEED_ARTISTS) as { name: string }[];
  for (const r of byTracks) if (!seen.has(r.name.toLowerCase())) seeds.push(r.name);
  return seeds;
}

/** Artists that aren't "new" to the user: library, Spotify taste, and anything they've disliked. */
function knownArtistNames(userId: number): Set<string> {
  const rows = getDb().prepare('SELECT name FROM artists').all() as { name: string }[];
  const known = new Set(rows.map((r) => r.name.toLowerCase()));
  const taste = getTaste(userId);
  for (const name of taste?.topArtists ?? []) known.add(name.toLowerCase());
  for (const name of taste?.savedArtists ?? []) known.add(name.toLowerCase());
  const disliked = getDb().prepare('SELECT name FROM discover_dislikes WHERE user_id = ?').all(userId) as { name: string }[];
  for (const r of disliked) known.add(r.name.toLowerCase());
  return known;
}

/** Hide an artist from Discover permanently and strip them from the current cache. */
export function dislikeArtist(userId: number, name: string): void {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO discover_dislikes (user_id, name) VALUES (?, ?)').run(userId, name);
  const raw = getSetting(cacheKey(userId));
  if (!raw) return;
  try {
    const cached = JSON.parse(raw);
    cached.artists = (cached.artists ?? []).filter(
      (a: DiscoverArtist) => a.name.toLowerCase() !== name.toLowerCase()
    );
    setSetting(cacheKey(userId), JSON.stringify(cached));
  } catch {
    // corrupt cache: next rebuild filters via knownArtistNames
  }
}

async function relatedFor(seedName: string): Promise<DeezerArtist[]> {
  const search = await deezer<{ data: DeezerArtist[] }>(`/search/artist?q=${encodeURIComponent(seedName)}&limit=1`);
  const match = search?.data?.[0];
  if (!match) return [];
  const related = await deezer<{ data: DeezerArtist[] }>(`/artist/${match.id}/related?limit=15`);
  return related?.data ?? [];
}

export async function buildDiscover(userId: number, force = false): Promise<{ generatedAt: string; seeds: string[]; artists: DiscoverArtist[] }> {
  if (!force) {
    const raw = getSetting(cacheKey(userId));
    if (raw) {
      try {
        const cached = JSON.parse(raw);
        if (Date.now() - new Date(cached.generatedAt).getTime() < CACHE_TTL_MS) return cached;
      } catch {
        // stale/corrupt cache: rebuild
      }
    }
  }

  const seeds = seedArtists(userId);
  const known = knownArtistNames(userId);

  const relatedLists = await Promise.all(seeds.map(async (seed) => ({ seed, related: await relatedFor(seed) })));

  // score suggestions by how many of the user's artists they relate to
  const scored = new Map<string, { artist: DeezerArtist; because: string[] }>();
  for (const { seed, related } of relatedLists) {
    for (const r of related) {
      if (known.has(r.name.toLowerCase())) continue;
      const entry = scored.get(r.name.toLowerCase());
      if (entry) entry.because.push(seed);
      else scored.set(r.name.toLowerCase(), { artist: r, because: [seed] });
    }
  }

  const top = [...scored.values()]
    .sort((a, b) => b.because.length - a.because.length || b.artist.nb_fan - a.artist.nb_fan)
    .slice(0, MAX_SUGGESTIONS);

  const artists: DiscoverArtist[] = await Promise.all(
    top.map(async ({ artist, because }) => {
      const tracks = await deezer<{ data: { title: string; preview: string | null; album: { title: string; cover_medium: string | null } }[] }>(
        `/artist/${artist.id}/top?limit=3`
      );
      return {
        name: artist.name,
        image: artist.picture_medium,
        fans: artist.nb_fan,
        deezerUrl: artist.link,
        because,
        topTracks: (tracks?.data ?? []).map((t) => ({
          title: t.title,
          album: t.album.title,
          cover: t.album.cover_medium,
          previewUrl: t.preview || null,
        })),
      };
    })
  );

  const result = { generatedAt: new Date().toISOString(), seeds, artists };
  if (artists.length > 0) setSetting(cacheKey(userId), JSON.stringify(result));
  return result;
}
