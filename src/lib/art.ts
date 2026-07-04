import fs from 'fs';
import path from 'path';
import { getDb, artDir } from './db';

let running = false;
let lastRun: { at: string; albumsFixed: number; artistsFixed: number; albumsMissing: number } | null = null;

export function artStatus() {
  return { running, lastRun };
}

const FOLDER_NAMES = /^(cover|folder|front|album|albumart)\.(jpe?g|png|webp)$/i;

async function download(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function dz<T>(p: string): Promise<T | null> {
  try {
    const res = await fetch(`https://api.deezer.com${p}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function folderArt(trackPath: string): Buffer | null {
  try {
    const dir = path.dirname(trackPath);
    for (const f of fs.readdirSync(dir)) {
      if (FOLDER_NAMES.test(f)) return fs.readFileSync(path.join(dir, f));
    }
  } catch {
    // unreadable dir
  }
  return null;
}

export function artistArtPath(artistId: number): string {
  return path.join(artDir(), `artist-${artistId}.img`);
}

/** Fill in missing album art (folder images, then Deezer) and artist images (Deezer). */
export async function fetchMissingArt(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const db = getDb();
    const setArt = db.prepare('UPDATE albums SET has_art = 1 WHERE id = ?');

    const albums = db
      .prepare(
        `SELECT al.id, al.name, ar.name AS artist,
                (SELECT t.path FROM tracks t WHERE t.album_id = al.id LIMIT 1) AS trackPath
         FROM albums al JOIN artists ar ON ar.id = al.artist_id
         WHERE al.has_art = 0`
      )
      .all() as { id: number; name: string; artist: string; trackPath: string | null }[];

    let albumsFixed = 0;

    // pass 1: local folder images (fast, no network)
    const needRemote: typeof albums = [];
    for (const al of albums) {
      const buf = al.trackPath ? folderArt(al.trackPath) : null;
      if (buf) {
        fs.writeFileSync(path.join(artDir(), `${al.id}.img`), buf);
        setArt.run(al.id);
        albumsFixed++;
      } else {
        needRemote.push(al);
      }
    }

    // pass 2: Deezer album covers, gently rate-limited
    for (let i = 0; i < needRemote.length; i += 10) {
      const batch = needRemote.slice(i, i + 10);
      await Promise.all(
        batch.map(async (al) => {
          const q = encodeURIComponent(`${al.artist} ${al.name}`);
          const found = await dz<{ data: { cover_big: string | null }[] }>(`/search/album?q=${q}&limit=1`);
          const url = found?.data?.[0]?.cover_big;
          if (!url) return;
          const buf = await download(url);
          if (!buf) return;
          fs.writeFileSync(path.join(artDir(), `${al.id}.img`), buf);
          setArt.run(al.id);
          albumsFixed++;
        })
      );
      if (i + 10 < needRemote.length) await new Promise((r) => setTimeout(r, 1100));
    }

    // artist images: any artist without a cached image file
    const artists = db.prepare('SELECT id, name FROM artists').all() as { id: number; name: string }[];
    const missingArtists = artists.filter((a) => !fs.existsSync(artistArtPath(a.id)));
    let artistsFixed = 0;

    for (let i = 0; i < missingArtists.length; i += 10) {
      const batch = missingArtists.slice(i, i + 10);
      await Promise.all(
        batch.map(async (a) => {
          const found = await dz<{ data: { picture_big: string | null }[] }>(
            `/search/artist?q=${encodeURIComponent(a.name)}&limit=1`
          );
          const url = found?.data?.[0]?.picture_big;
          if (!url) return;
          const buf = await download(url);
          if (!buf) return;
          fs.writeFileSync(artistArtPath(a.id), buf);
          artistsFixed++;
        })
      );
      if (i + 10 < missingArtists.length) await new Promise((r) => setTimeout(r, 1100));
    }

    const albumsMissing = (db.prepare('SELECT COUNT(*) AS n FROM albums WHERE has_art = 0').get() as { n: number }).n;
    lastRun = { at: new Date().toISOString(), albumsFixed, artistsFixed, albumsMissing };
    console.log(`art: fixed ${albumsFixed} albums, ${artistsFixed} artists; ${albumsMissing} albums still missing`);
  } finally {
    running = false;
  }
}
