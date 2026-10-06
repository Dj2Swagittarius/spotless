import fs from 'fs';
import path from 'path';
import { getDb, artDir } from './db';

type ArtRun = {
  at: string;
  albumsFixed: number;
  artistsFixed: number;
  albumsMissing: number;
  errors: number;
};

type ArtProgress = {
  phase: 'albums-local' | 'albums-remote' | 'artists';
  done: number;
  total: number;
};

type ArtRuntime = {
  running: boolean;
  lastRun: ArtRun | null;
  lastError: string | null;
  progress: ArtProgress | null;
};

const runtimeGlobal = globalThis as typeof globalThis & {
  __spotlessArtRuntimeV1?: ArtRuntime;
};
const runtime: ArtRuntime =
  runtimeGlobal.__spotlessArtRuntimeV1 ??
  (runtimeGlobal.__spotlessArtRuntimeV1 = {
    running: false,
    lastRun: null,
    lastError: null,
    progress: null,
  });

export function artStatus() {
  return {
    running: runtime.running,
    lastRun: runtime.lastRun,
    lastError: runtime.lastError,
    progress: runtime.progress,
  };
}

const FOLDER_NAMES = /^(cover|folder|front|album|albumart)(?:[ _-]?\d+)?\.(jpe?g|png|webp)$/i;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Detect image types that Spotless can serve correctly. */
export function imageContentType(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return 'image/png';
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  return null;
}

function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9' ]/g, '')
    .trim();
}

function searchValue(s: string): string {
  return s.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function request(url: string, timeoutMs: number): Promise<Response | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json,image/*;q=0.9,*/*;q=0.1' },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.status === 429 || res.status >= 500) {
        if (attempt === 0) {
          const retryAfter = Number(res.headers.get('retry-after'));
          await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : 750);
          continue;
        }
      }
      return res;
    } catch {
      if (attempt === 0) {
        await sleep(500);
        continue;
      }
      return null;
    }
  }
  return null;
}

async function downloadImage(url: string): Promise<Buffer | null> {
  const res = await request(url, 15_000);
  if (!res?.ok) return null;

  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return null;

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES || !imageContentType(buf)) return null;
  return buf;
}

async function dz<T>(p: string): Promise<T | null> {
  const res = await request(`https://api.deezer.com${p}`, 10_000);
  if (!res?.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function folderArt(trackPath: string): Buffer | null {
  try {
    const dir = path.dirname(trackPath);
    const files = fs.readdirSync(dir).sort((a, b) => a.localeCompare(b));
    for (const f of files) {
      if (!FOLDER_NAMES.test(f)) continue;
      const buf = fs.readFileSync(path.join(dir, f));
      if (imageContentType(buf)) return buf;
    }
  } catch {
    // unreadable directory/file: remote fallback can still run
  }
  return null;
}

export function artistArtPath(artistId: number): string {
  return path.join(artDir(), `artist-${artistId}.img`);
}

function albumArtPath(albumId: number): string {
  return path.join(artDir(), `${albumId}.img`);
}

function writeImage(file: string, buf: Buffer): boolean {
  if (!imageContentType(buf)) return false;
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temp, buf);
    // Windows cannot reliably rename over an existing destination. A stale or
    // invalid cache file is safe to remove because this function already has a
    // validated replacement ready in the same directory.
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    fs.renameSync(temp, file);
    return true;
  } finally {
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      // no-op
    }
  }
}

type DeezerAlbum = {
  title?: string;
  cover_xl?: string | null;
  cover_big?: string | null;
  artist?: { name?: string };
};

type DeezerArtist = {
  name?: string;
  picture_xl?: string | null;
  picture_big?: string | null;
};

async function findAlbumImage(artist: string, album: string): Promise<Buffer | null> {
  const q = `artist:"${searchValue(artist)}" album:"${searchValue(album)}"`;
  const result = await dz<{ data?: DeezerAlbum[] }>(
    `/search/album?q=${encodeURIComponent(q)}&limit=10`
  );

  const wantedArtist = normalize(artist);
  const wantedAlbum = normalize(album);
  const exact = (result?.data ?? []).find(
    (item) => normalize(item.title ?? '') === wantedAlbum && normalize(item.artist?.name ?? '') === wantedArtist
  );

  const url = exact?.cover_xl || exact?.cover_big;
  return url ? downloadImage(url) : null;
}

async function findArtistImage(artist: string): Promise<Buffer | null> {
  const result = await dz<{ data?: DeezerArtist[] }>(
    `/search/artist?q=${encodeURIComponent(searchValue(artist))}&limit=10`
  );
  const wanted = normalize(artist);
  const exact = (result?.data ?? []).find((item) => normalize(item.name ?? '') === wanted);
  const url = exact?.picture_xl || exact?.picture_big;
  return url ? downloadImage(url) : null;
}

/**
 * Repair missing artwork. Local folder art is preferred, then conservative
 * exact-match Deezer lookups are used. Individual failures do not abort the run.
 */
export async function fetchMissingArt(): Promise<void> {
  if (runtime.running) return;
  runtime.running = true;
  runtime.lastError = null;
  runtime.progress = null;

  let albumsFixed = 0;
  let artistsFixed = 0;
  let errors = 0;

  try {
    const db = getDb();
    const setArt = db.prepare('UPDATE albums SET has_art = 1 WHERE id = ?');
    const clearArt = db.prepare('UPDATE albums SET has_art = 0 WHERE id = ?');

    // Repair stale DB flags first. Previously an album could remain has_art=1
    // after its cached file disappeared, which made future repair runs skip it.
    const flagged = db.prepare('SELECT id FROM albums WHERE has_art = 1').all() as { id: number }[];
    for (const al of flagged) {
      const file = albumArtPath(al.id);
      try {
        if (!fs.existsSync(file) || !imageContentType(fs.readFileSync(file))) clearArt.run(al.id);
      } catch {
        clearArt.run(al.id);
      }
    }

    const albums = db
      .prepare(
        `SELECT al.id, al.name, ar.name AS artist,
                (SELECT t.path FROM tracks t WHERE t.album_id = al.id ORDER BY t.disc_no, t.track_no LIMIT 1) AS trackPath
         FROM albums al JOIN artists ar ON ar.id = al.artist_id
         WHERE al.has_art = 0
         ORDER BY ar.name COLLATE NOCASE, al.name COLLATE NOCASE`
      )
      .all() as { id: number; name: string; artist: string; trackPath: string | null }[];

    const needRemote: typeof albums = [];
    runtime.progress = { phase: 'albums-local', done: 0, total: albums.length };

    for (let i = 0; i < albums.length; i++) {
      const al = albums[i];
      try {
        const buf = al.trackPath ? folderArt(al.trackPath) : null;
        if (buf && writeImage(albumArtPath(al.id), buf)) {
          setArt.run(al.id);
          albumsFixed++;
        } else {
          needRemote.push(al);
        }
      } catch (error) {
        errors++;
        needRemote.push(al);
        console.warn(`art: local album art failed for ${al.artist} - ${al.name}`, error);
      }
      runtime.progress = { phase: 'albums-local', done: i + 1, total: albums.length };
    }

    runtime.progress = { phase: 'albums-remote', done: 0, total: needRemote.length };
    for (let i = 0; i < needRemote.length; i++) {
      const al = needRemote[i];
      try {
        const buf = await findAlbumImage(al.artist, al.name);
        if (buf && writeImage(albumArtPath(al.id), buf)) {
          setArt.run(al.id);
          albumsFixed++;
        }
      } catch (error) {
        errors++;
        console.warn(`art: Deezer album lookup failed for ${al.artist} - ${al.name}`, error);
      }
      runtime.progress = { phase: 'albums-remote', done: i + 1, total: needRemote.length };
      if (i + 1 < needRemote.length) await sleep(200);
    }

    const artists = db.prepare('SELECT id, name FROM artists ORDER BY name COLLATE NOCASE').all() as {
      id: number;
      name: string;
    }[];
    const missingArtists = artists.filter((a) => {
      const file = artistArtPath(a.id);
      try {
        return !fs.existsSync(file) || !imageContentType(fs.readFileSync(file));
      } catch {
        return true;
      }
    });

    runtime.progress = { phase: 'artists', done: 0, total: missingArtists.length };
    for (let i = 0; i < missingArtists.length; i++) {
      const artist = missingArtists[i];
      try {
        const buf = await findArtistImage(artist.name);
        if (buf && writeImage(artistArtPath(artist.id), buf)) artistsFixed++;
      } catch (error) {
        errors++;
        console.warn(`art: Deezer artist lookup failed for ${artist.name}`, error);
      }
      runtime.progress = { phase: 'artists', done: i + 1, total: missingArtists.length };
      if (i + 1 < missingArtists.length) await sleep(200);
    }

    const albumsMissing = (db.prepare('SELECT COUNT(*) AS n FROM albums WHERE has_art = 0').get() as { n: number }).n;
    runtime.lastRun = {
      at: new Date().toISOString(),
      albumsFixed,
      artistsFixed,
      albumsMissing,
      errors,
    };
    console.log(
      `art: fixed ${albumsFixed} albums, ${artistsFixed} artists; ${albumsMissing} albums still missing; ${errors} errors`
    );
  } catch (error) {
    runtime.lastError = error instanceof Error ? error.message : String(error);
    console.error('art fetch failed:', error);
    throw error;
  } finally {
    runtime.progress = null;
    runtime.running = false;
  }
}
