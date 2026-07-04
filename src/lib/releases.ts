import { getDb, getSetting, setSetting } from './db';
import { foldText } from './scanner';

export interface NewRelease {
  artist: string;
  title: string;
  cover: string | null;
  releaseDate: string;
  recordType: string;
  deezerUrl: string;
}

const CACHE_KEY = 'releases_cache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ARTISTS = 40;
const WINDOW_DAYS = 120;

async function deezer<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`https://api.deezer.com${path}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function norm(s: string): string {
  return foldText(s)
    .replace(/\((deluxe|expanded|remaster|edition|bonus)[^)]*\)|\[[^\]]*\]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function chunked<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
    if (i + size < items.length) await new Promise((r) => setTimeout(r, 1100));
  }
  return out;
}

interface ArtistGroup {
  dzId: number;
  name: string;
  owned: Set<string>;
}

/**
 * Resolve the library's top artists to Deezer artists, folding local spelling variants
 * ("DJ Tiesto", "Tiesto", "Tiësto") into one group per Deezer id with their owned albums pooled —
 * otherwise the same albums get listed once per spelling and owned ones look "missing".
 */
async function resolveArtistGroups(): Promise<ArtistGroup[]> {
  const db = getDb();
  const artists = db
    .prepare('SELECT a.id, a.name FROM artists a JOIN tracks t ON t.artist_id = a.id GROUP BY a.id ORDER BY COUNT(*) DESC LIMIT ?')
    .all(MAX_ARTISTS) as { id: number; name: string }[];

  const ownedByArtist = new Map<string, Set<string>>();
  const albumRows = db
    .prepare('SELECT al.name AS album, ar.name AS artist FROM albums al JOIN artists ar ON ar.id = al.artist_id')
    .all() as { album: string; artist: string }[];
  for (const r of albumRows) {
    const key = foldText(r.artist);
    if (!ownedByArtist.has(key)) ownedByArtist.set(key, new Set());
    ownedByArtist.get(key)!.add(norm(r.album));
  }

  const resolved = await chunked(artists, 15, async (a) => {
    const search = await deezer<{ data: { id: number }[] }>(`/search/artist?q=${encodeURIComponent(a.name)}&limit=1`);
    return { a, dzId: search?.data?.[0]?.id ?? null };
  });

  const groups = new Map<number, ArtistGroup>();
  for (const { a, dzId } of resolved) {
    if (!dzId) continue;
    let g = groups.get(dzId);
    if (!g) {
      g = { dzId, name: a.name, owned: new Set() }; // first hit = most-played spelling
      groups.set(dzId, g);
    }
    for (const t of ownedByArtist.get(foldText(a.name)) ?? []) g.owned.add(t);
  }
  return [...groups.values()];
}

export async function buildReleases(force = false): Promise<{ generatedAt: string; releases: NewRelease[] }> {
  if (!force) {
    const raw = getSetting(CACHE_KEY);
    if (raw) {
      try {
        const cached = JSON.parse(raw);
        if (Date.now() - new Date(cached.generatedAt).getTime() < CACHE_TTL_MS) return cached;
      } catch {
        // rebuild below
      }
    }
  }

  const groups = await resolveArtistGroups();
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);

  const perArtist = await chunked(groups, 15, async (g) => {
    const albums = await deezer<{ data: { title: string; cover_medium: string | null; release_date: string; record_type: string; link: string }[] }>(
      `/artist/${g.dzId}/albums?limit=50`
    );
    return (albums?.data ?? [])
      .filter((al) => al.release_date >= cutoff)
      .filter((al) => ['album', 'ep', 'single'].includes(al.record_type))
      .filter((al) => !g.owned.has(norm(al.title)))
      .map((al) => ({
        artist: g.name,
        title: al.title,
        cover: al.cover_medium,
        releaseDate: al.release_date,
        recordType: al.record_type,
        deezerUrl: al.link,
      }));
  });

  // dedupe edition variants of the same release, newest first
  const seen = new Set<string>();
  const releases = perArtist
    .flat()
    .filter((r) => {
      const key = `${foldText(r.artist)}|${norm(r.title)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
    .slice(0, 40);

  const result = { generatedAt: new Date().toISOString(), releases };
  if (releases.length > 0 || groups.length === 0) setSetting(CACHE_KEY, JSON.stringify(result));
  return result;
}

export interface MissingAlbum {
  artist: string;
  title: string;
  cover: string | null;
  releaseDate: string;
  deezerUrl: string;
}

const COLLECTION_CACHE_KEY = 'collection_cache';
const GAPS_PER_ARTIST = 10;
// re-releases and repackaged variants of albums, not actual collection gaps
const VARIANT_NOISE =
  /\b(remix(es|ed)?|live|karaoke|instrumental|acoustic|a?nniversary|deluxe|expanded|extended|edition|best of|greatest hits|anthology|essentials?|megamix|mixtape|dj mix|mixed by|commentary|demos?|b-sides)\b/i;

/** Studio albums your artists released that aren't in the library — any age, not just new. */
export async function buildCollectionGaps(force = false): Promise<{ generatedAt: string; missing: MissingAlbum[] }> {
  if (!force) {
    const raw = getSetting(COLLECTION_CACHE_KEY);
    if (raw) {
      try {
        const cached = JSON.parse(raw);
        if (Date.now() - new Date(cached.generatedAt).getTime() < CACHE_TTL_MS) return cached;
      } catch {
        // rebuild below
      }
    }
  }

  const groups = await resolveArtistGroups();

  const perArtist = await chunked(groups, 15, async (g) => {
    const albums = await deezer<{ data: { title: string; cover_medium: string | null; release_date: string; record_type: string; link: string }[] }>(
      `/artist/${g.dzId}/albums?limit=100`
    );
    return (albums?.data ?? [])
      .filter((al) => al.record_type === 'album') // studio albums only, skip single/EP noise
      .filter((al) => !VARIANT_NOISE.test(al.title)) // skip remix/live/best-of repackages
      .filter((al) => !g.owned.has(norm(al.title)))
      .sort((a, b) => b.release_date.localeCompare(a.release_date))
      .slice(0, GAPS_PER_ARTIST)
      .map((al) => ({
        artist: g.name,
        title: al.title,
        cover: al.cover_medium,
        releaseDate: al.release_date,
        deezerUrl: al.link,
      }));
  });

  const seen = new Set<string>();
  const missing = perArtist
    .flat()
    .filter((m) => {
      const key = `${foldText(m.artist)}|${norm(m.title)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.artist.localeCompare(b.artist) || b.releaseDate.localeCompare(a.releaseDate));

  const result = { generatedAt: new Date().toISOString(), missing };
  if (missing.length > 0 || groups.length === 0) setSetting(COLLECTION_CACHE_KEY, JSON.stringify(result));
  return result;
}
