import fs from 'fs';
import path from 'path';
import { getDb, artDir, getSetting, setSetting } from './db';

const DEFAULT_MUSIC_DIR = process.env.MUSIC_DIR || path.join(process.cwd(), 'music');
const EXTS = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.opus', '.wav', '.aac']);

export function getMusicDir(): string {
  return getSetting('music_dir') || DEFAULT_MUSIC_DIR;
}

export function setMusicDir(dir: string): void {
  const resolved = path.resolve(dir);
  const stat = fs.statSync(resolved); // throws if missing
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${resolved}`);
  setSetting('music_dir', resolved);
}

let scanning = false;
let lastScan: { at: string; added: number; removed: number; total: number } | null = null;

export function scanStatus() {
  return { scanning, lastScan };
}

/** Fold text for matching: strip diacritics (Tiësto = Tiesto), unify quotes/spaces, lowercase. */
export function foldText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // combining marks left by NFKD
    .replace(/[‘’ʼ]/g, "'") // curly/modifier apostrophes
    .replace(/[“”]/g, '"') // curly quotes
    .replace(/ /g, ' ') // non-breaking space
    .toLowerCase()
    .replace(/[.,]/g, '') // "Invent, Animate" = "Invent Animate", "Vol. 1" = "Vol 1"
    .replace(/\s+/g, ' ')
    .trim();
}

/** Matching key for an artist name. */
export const artistKey = (name: string) => foldText(stripFeat(name));
/** Matching key for an album name. */
export const albumKey = (name: string) => foldText(name);

/** Strip featured-artist decorations: "A feat. B", "A ft. B", "A (feat. B)", "A; B" → "A". */
export function stripFeat(name: string): string {
  return name
    .replace(/\s*[([]\s*(?:feat|ft|featuring|with)\.?\s+[^)\]]*[)\]]/gi, '') // "(feat. X)" / "[with X]"
    .replace(/\s+(?:feat|ft|featuring)\.?\s+.+$/i, '') // bare "A feat. X"
    .split(';')[0] // multi-artist tag lists "A; B; C"
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Primary artist for a file: album artist wins; else first artist tag. Feature credits stripped. */
function primaryArtistName(c: {
  albumartist?: string;
  artist?: string;
  artists?: string[];
}): string {
  let name = stripFeat((c.albumartist ?? '').trim());
  if (!name) {
    // multiple artist tags: the first entry is the primary artist
    if (c.artists && c.artists.length > 1) name = stripFeat(c.artists[0].trim());
    else name = stripFeat((c.artist ?? '').trim());
  }
  return name || 'Unknown Artist';
}

/**
 * Merge artists (and their albums) whose names normalize to the same thing —
 * "A feat. B" vs "A", case variants, etc. Idempotent; runs at the start of every scan
 * so libraries tagged before the normalized matching also get cleaned up.
 */
export function dedupeLibrary(db: ReturnType<typeof getDb>): void {
  const artists = db.prepare('SELECT id, name FROM artists').all() as { id: number; name: string }[];
  const groups = new Map<string, { id: number; name: string }[]>();
  for (const a of artists) {
    const key = artistKey(a.name);
    if (!key) continue;
    const g = groups.get(key) ?? [];
    g.push(a);
    groups.set(key, g);
  }

  const nTracks = db.prepare('SELECT COUNT(*) AS n FROM tracks WHERE artist_id = ?');
  const moveAlbumTracks = db.prepare('UPDATE tracks SET album_id = ? WHERE album_id = ?');
  const moveArtistTracks = db.prepare('UPDATE tracks SET artist_id = ? WHERE artist_id = ?');
  const moveCollections = db.prepare('UPDATE OR IGNORE collections SET artist_id = ? WHERE artist_id = ?');
  const dropCollections = db.prepare('DELETE FROM collections WHERE artist_id = ?');
  const albumsOf = db.prepare('SELECT id, name, year, has_art FROM albums WHERE artist_id = ?');
  const findAlbumFor = db.prepare('SELECT id, has_art FROM albums WHERE artist_id = ? AND name = ? COLLATE NOCASE');
  const delAlbum = db.prepare('DELETE FROM albums WHERE id = ?');
  const delArtist = db.prepare('DELETE FROM artists WHERE id = ?');
  const setArtFlag = db.prepare('UPDATE albums SET has_art = 1 WHERE id = ?');
  const setYear = db.prepare('UPDATE albums SET year = COALESCE(year, ?) WHERE id = ?');
  const reparentAlbum = db.prepare('UPDATE albums SET artist_id = ? WHERE id = ?');
  const renameArtist = db.prepare('UPDATE artists SET name = ? WHERE id = ?');

  /** Merge duplicate albums under one artist (case/whitespace variants), keeping art + year. */
  const mergeAlbumsOf = (artistId: number) => {
    const byKey = new Map<string, { id: number; year: number | null; has_art: number }>();
    for (const al of albumsOf.all(artistId) as { id: number; name: string; year: number | null; has_art: number }[]) {
      const key = albumKey(al.name);
      const kept = byKey.get(key);
      if (!kept) {
        byKey.set(key, al);
        continue;
      }
      moveAlbumTracks.run(kept.id, al.id);
      if (al.has_art && !kept.has_art) {
        try {
          fs.renameSync(path.join(artDir(), `${al.id}.img`), path.join(artDir(), `${kept.id}.img`));
          setArtFlag.run(kept.id);
          kept.has_art = 1;
        } catch {
          // art file missing on disk; nothing to carry over
        }
      }
      if (al.year != null) setYear.run(al.year, kept.id);
      delAlbum.run(al.id);
    }
  };

  const tx = db.transaction(() => {
    for (const group of groups.values()) {
      // keeper: prefer the artist already named exactly like the canonical form,
      // then real capitalization over all-lowercase tags, then most tracks
      const canonKey = artistKey(group[0].name);
      const caseScore = (s: string) => (s === s.toLowerCase() ? 0 : 1);
      const keeper = group
        .slice()
        .sort((a, b) => {
          const aExact = a.name.toLowerCase() === canonKey ? 1 : 0;
          const bExact = b.name.toLowerCase() === canonKey ? 1 : 0;
          if (aExact !== bExact) return bExact - aExact;
          if (caseScore(a.name) !== caseScore(b.name)) return caseScore(b.name) - caseScore(a.name);
          return (nTracks.get(b.id) as { n: number }).n - (nTracks.get(a.id) as { n: number }).n;
        })[0];

      for (const dup of group) {
        if (dup.id === keeper.id) continue;
        moveArtistTracks.run(keeper.id, dup.id);
        for (const al of albumsOf.all(dup.id) as { id: number; name: string; year: number | null; has_art: number }[]) {
          const existing = findAlbumFor.get(keeper.id, al.name) as { id: number; has_art: number } | undefined;
          if (!existing) {
            reparentAlbum.run(keeper.id, al.id);
            continue;
          }
          // keeper already has this album — fold the duplicate into it
          moveAlbumTracks.run(existing.id, al.id);
          if (al.has_art && !existing.has_art) {
            try {
              fs.renameSync(path.join(artDir(), `${al.id}.img`), path.join(artDir(), `${existing.id}.img`));
              setArtFlag.run(existing.id);
            } catch {
              // art file missing on disk; nothing to carry over
            }
          }
          if (al.year != null) setYear.run(al.year, existing.id);
          delAlbum.run(al.id);
        }
        moveCollections.run(keeper.id, dup.id);
        dropCollections.run(dup.id);
        delArtist.run(dup.id);
      }

      // normalize the surviving name ("A feat. B" as the only entry → "A")
      const canon = stripFeat(keeper.name);
      if (canon && canon !== keeper.name) renameArtist.run(canon, keeper.id);

      mergeAlbumsOf(keeper.id);
    }
  });
  tx();
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (EXTS.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}

export async function scanLibrary(): Promise<void> {
  if (scanning) return;
  scanning = true;
  try {
    const db = getDb();
    // TS resolves the browser entry which lacks parseFile; runtime (node) has it
    const { parseFile } = (await import('music-metadata')) as unknown as {
      parseFile: (path: string, opts?: { duration?: boolean }) => Promise<import('music-metadata').IAudioMetadata>;
    };
    // fold pre-existing duplicate artists/albums together before matching new files
    dedupeLibrary(db);

    const files = walk(getMusicDir());
    const fileSet = new Set(files);

    // remove tracks whose files vanished
    const existing = db.prepare('SELECT id, path FROM tracks').all() as { id: number; path: string }[];
    let removed = 0;
    const delTrack = db.prepare('DELETE FROM tracks WHERE id = ?');
    for (const row of existing) {
      if (!fileSet.has(row.path)) {
        delTrack.run(row.id);
        removed++;
      }
    }

    const getMtime = db.prepare('SELECT mtime FROM tracks WHERE path = ?');
    // folded-key lookups so "MGK"/"mgk" and "Tiësto"/"Tiesto" don't fork entries
    // (COLLATE NOCASE can't fold diacritics, so match in memory instead)
    const insArtist = db.prepare('INSERT INTO artists (name) VALUES (?) RETURNING id');
    const insAlbum = db.prepare('INSERT INTO albums (name, artist_id, year) VALUES (?, ?, ?) RETURNING id, has_art');
    const fillAlbumYear = db.prepare('UPDATE albums SET year = COALESCE(year, ?) WHERE id = ?');
    const artistIds = new Map<string, number>();
    for (const a of db.prepare('SELECT id, name FROM artists').all() as { id: number; name: string }[])
      artistIds.set(artistKey(a.name), a.id);
    const albumsByKey = new Map<string, { id: number; has_art: number }>();
    for (const al of db.prepare('SELECT id, name, artist_id, has_art FROM albums').all() as {
      id: number;
      name: string;
      artist_id: number;
      has_art: number;
    }[])
      albumsByKey.set(`${al.artist_id}|${albumKey(al.name)}`, { id: al.id, has_art: al.has_art });
    const setArt = db.prepare('UPDATE albums SET has_art = 1 WHERE id = ?');
    const upTrack = db.prepare(`
      INSERT INTO tracks (title, album_id, artist_id, duration, track_no, disc_no, genre, path, mtime, gain)
      VALUES (@title, @albumId, @artistId, @duration, @trackNo, @discNo, @genre, @path, @mtime, @gain)
      ON CONFLICT(path) DO UPDATE SET
        title = excluded.title, album_id = excluded.album_id, artist_id = excluded.artist_id,
        duration = excluded.duration, track_no = excluded.track_no, disc_no = excluded.disc_no,
        genre = excluded.genre, mtime = excluded.mtime, gain = excluded.gain
    `);

    let added = 0;
    for (const file of files) {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      const mtime = Math.floor(stat.mtimeMs);
      const known = getMtime.get(file) as { mtime: number } | undefined;
      if (known && known.mtime === mtime) continue;

      try {
        const meta = await parseFile(file, { duration: true });
        const c = meta.common;
        const artistName = primaryArtistName(c);
        const albumName = (c.album || 'Unknown Album').trim() || 'Unknown Album';
        const title = (c.title || path.basename(file, path.extname(file))).trim();

        const aKey = artistKey(artistName);
        let artistId = artistIds.get(aKey);
        if (artistId === undefined) {
          artistId = (insArtist.get(artistName) as { id: number }).id;
          artistIds.set(aKey, artistId);
        }
        const alKey = `${artistId}|${albumKey(albumName)}`;
        let album = albumsByKey.get(alKey);
        if (album) {
          if (c.year != null) fillAlbumYear.run(c.year, album.id);
        } else {
          album = insAlbum.get(albumName, artistId, c.year ?? null) as { id: number; has_art: number };
          albumsByKey.set(alKey, album);
        }

        if (!album.has_art && c.picture && c.picture.length > 0) {
          const pic = c.picture[0];
          fs.writeFileSync(path.join(artDir(), `${album.id}.img`), Buffer.from(pic.data));
          setArt.run(album.id);
          album.has_art = 1;
        }

        upTrack.run({
          title,
          albumId: album.id,
          artistId,
          duration: meta.format.duration ?? 0,
          trackNo: c.track?.no ?? 0,
          discNo: c.disk?.no ?? 1,
          genre: c.genre?.[0] ?? null,
          path: file,
          mtime,
          gain: c.replaygain_track_gain?.dB ?? null,
        });
        if (!known) added++;
      } catch (err) {
        console.warn(`scan: failed to parse ${file}:`, err);
      }
    }

    // prune empty albums/artists
    db.exec(`
      DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks);
      DELETE FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM tracks);
    `);

    const total = (db.prepare('SELECT COUNT(*) AS n FROM tracks').get() as { n: number }).n;
    lastScan = { at: new Date().toISOString(), added, removed, total };
    console.log(`scan: done. +${added} -${removed}, total ${total}`);

    // backfill any missing album/artist artwork in the background
    const { fetchMissingArt } = await import('./art');
    fetchMissingArt().catch((err) => console.error('art fetch failed:', err));
  } finally {
    scanning = false;
  }
}
