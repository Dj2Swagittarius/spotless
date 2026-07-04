import { getDb, getSetting, setSetting } from './db';

export interface TrendTrack {
  rank: number;
  title: string;
  artist: string;
  album: string | null;
  art: string | null;
  genres?: string[];
}

const TTL_MS = 6 * 60 * 60 * 1000;

function cached<T>(key: string): T | null {
  const raw = getSetting(key);
  if (!raw) return null;
  try {
    const c = JSON.parse(raw);
    if (Date.now() - c.at < TTL_MS) return c.data as T;
  } catch {
    // rebuild
  }
  return null;
}
const store = (key: string, data: unknown) => setSetting(key, JSON.stringify({ at: Date.now(), data }));

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const COUNTRIES: { code: string; name: string }[] = [
  { code: 'ww', name: 'Worldwide' },
  { code: 'us', name: 'United States' },
  { code: 'gb', name: 'United Kingdom' },
  { code: 'ca', name: 'Canada' },
  { code: 'au', name: 'Australia' },
  { code: 'de', name: 'Germany' },
  { code: 'fr', name: 'France' },
  { code: 'it', name: 'Italy' },
  { code: 'es', name: 'Spain' },
  { code: 'nl', name: 'Netherlands' },
  { code: 'se', name: 'Sweden' },
  { code: 'no', name: 'Norway' },
  { code: 'ie', name: 'Ireland' },
  { code: 'pl', name: 'Poland' },
  { code: 'jp', name: 'Japan' },
  { code: 'kr', name: 'South Korea' },
  { code: 'br', name: 'Brazil' },
  { code: 'mx', name: 'Mexico' },
  { code: 'ar', name: 'Argentina' },
  { code: 'in', name: 'India' },
];

/** Country chart: Apple most-played RSS per storefront; Worldwide via Deezer global chart. */
export async function countryChart(code: string): Promise<TrendTrack[]> {
  const cc = COUNTRIES.some((c) => c.code === code) ? code : 'ww';
  const key = `trending:${cc}`;
  const hit = cached<TrendTrack[]>(key);
  if (hit) return hit;

  let out: TrendTrack[] = [];
  if (cc === 'ww') {
    const d = await getJson<{ data: { title: string; artist: { name: string }; album: { title: string; cover_big: string | null } }[] }>(
      'https://api.deezer.com/chart/0/tracks?limit=50'
    );
    out = (d?.data ?? []).map((t, i) => ({
      rank: i + 1,
      title: t.title,
      artist: t.artist.name,
      album: t.album?.title ?? null,
      art: t.album?.cover_big ?? null,
    }));
  } else {
    const d = await getJson<{ feed: { results: { name: string; artistName: string; artworkUrl100: string; genres?: { name: string }[] }[] } }>(
      `https://rss.applemarketingtools.com/api/v2/${cc}/music/most-played/50/songs.json`
    );
    out = (d?.feed?.results ?? []).map((r, i) => ({
      rank: i + 1,
      title: r.name,
      artist: r.artistName,
      album: null,
      art: r.artworkUrl100 ? r.artworkUrl100.replace('100x100', '300x300') : null,
      genres: (r.genres ?? []).map((g) => g.name).filter((n) => n !== 'Music'),
    }));
  }
  if (out.length) store(key, out);
  return out;
}

interface DeezerGenre {
  id: number;
  name: string;
}

async function deezerGenres(): Promise<DeezerGenre[]> {
  const hit = cached<DeezerGenre[]>('trending:genrelist');
  if (hit) return hit;
  const d = await getJson<{ data: DeezerGenre[] }>('https://api.deezer.com/genre');
  const list = (d?.data ?? []).filter((g) => g.name !== 'All');
  if (list.length) store('trending:genrelist', list);
  return list;
}

async function genreChart(g: DeezerGenre): Promise<TrendTrack[]> {
  const key = `trending:genre:${g.id}`;
  const hit = cached<TrendTrack[]>(key);
  if (hit) return hit;
  const d = await getJson<{ tracks: { data: { title: string; artist: { name: string }; album: { title: string; cover_medium: string | null } }[] } }>(
    `https://api.deezer.com/editorial/${g.id}/charts`
  );
  const out = (d?.tracks?.data ?? []).slice(0, 20).map((t, i) => ({
    rank: i + 1,
    title: t.title,
    artist: t.artist.name,
    album: t.album?.title ?? null,
    art: t.album?.cover_medium ?? null,
  }));
  if (out.length) store(key, out);
  return out;
}

/** User's top genre names from their listening (fallback: whole library). */
function userGenres(userId: number): string[] {
  const db = getDb();
  let rows = db
    .prepare(
      `SELECT t.genre AS g, COUNT(*) AS n FROM history h JOIN tracks t ON t.id = h.track_id
       WHERE h.user_id = ? AND t.genre IS NOT NULL GROUP BY t.genre ORDER BY n DESC LIMIT 6`
    )
    .all(userId) as { g: string }[];
  if (rows.length === 0)
    rows = db
      .prepare(`SELECT genre AS g, COUNT(*) AS n FROM tracks WHERE genre IS NOT NULL GROUP BY genre ORDER BY n DESC LIMIT 6`)
      .all() as { g: string }[];
  return rows.map((r) => r.g);
}

const DEFAULT_GENRES = ['Pop', 'Rock', 'Rap/Hip Hop', 'Dance', 'Alternative', 'Electro'];

export interface GenreRow {
  name: string;
  forYou: boolean;
  tracks: TrendTrack[];
}

/** Genre rows: listener-pertinent genres first, then popular defaults. First row = blended "for you". */
export async function genreTrending(userId: number): Promise<{ forYou: TrendTrack[]; rows: GenreRow[] }> {
  const all = await deezerGenres();
  const mine = userGenres(userId);

  const match = (name: string) => {
    const n = name.toLowerCase();
    return all.find((g) => g.name.toLowerCase().includes(n) || n.includes(g.name.toLowerCase()));
  };

  const picked: { g: DeezerGenre; forYou: boolean }[] = [];
  const seen = new Set<number>();
  for (const name of mine) {
    const g = match(name);
    if (g && !seen.has(g.id)) {
      seen.add(g.id);
      picked.push({ g, forYou: true });
    }
    if (picked.length >= 4) break;
  }
  for (const name of DEFAULT_GENRES) {
    if (picked.length >= 7) break;
    const g = all.find((x) => x.name === name) ?? match(name);
    if (g && !seen.has(g.id)) {
      seen.add(g.id);
      picked.push({ g, forYou: false });
    }
  }

  const rows: GenreRow[] = [];
  for (const { g, forYou } of picked) {
    const tracks = await genreChart(g);
    if (tracks.length) rows.push({ name: g.name, forYou, tracks });
  }

  // "for you" blend: interleave the user's genre rows
  const yours = rows.filter((r) => r.forYou);
  const forYou: TrendTrack[] = [];
  for (let i = 0; i < 8 && forYou.length < 20; i++) {
    for (const r of yours) {
      const t = r.tracks[i];
      if (t && !forYou.some((x) => x.title === t.title && x.artist === t.artist)) forYou.push(t);
    }
  }
  return { forYou: forYou.map((t, i) => ({ ...t, rank: i + 1 })), rows };
}
