import fs from 'fs';
import path from 'path';
import { resolvePlaceholders } from './playlistMatch';
import { getDb, artDir, getSetting, setSetting } from './db';
import { imageContentType } from './art';

const DEFAULT_MUSIC_DIR = process.env.MUSIC_DIR || path.join(process.cwd(), 'music');
const EXTS = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.opus', '.wav', '.aac']);
// readdir/stat calls in flight at once: enough to hide NAS latency without flooding it
const WALK_CONCURRENCY = 6;
// track upserts per transaction; one fsync per batch instead of one per row
const UPSERT_BATCH = 200;
// embedded pictures larger than this are almost certainly not cover art (or are corrupt)
const MAX_EMBEDDED_ART_BYTES = 10 * 1024 * 1024;
// a re-encoded or re-tagged copy of the same song may differ by a fraction of a second
const RELINK_DURATION_TOLERANCE_S = 1.5;

const AUTO_SCAN_SETTING = 'library_auto_scan_minutes';
export const AUTO_SCAN_INTERVALS = [0, 5, 15, 30, 60, 180, 360, 720, 1440] as const;
export type AutoScanIntervalMinutes = (typeof AUTO_SCAN_INTERVALS)[number];
const AUTO_SCAN_ALLOWED = new Set<number>(AUTO_SCAN_INTERVALS);

type LastScan = { at: string; added: number; removed: number; relinked: number; total: number };
type LastScanError = { at: string; message: string };
type ScannerRuntime = {
  scanning: boolean;
  lastScan: LastScan | null;
  lastScanError: LastScanError | null;
  schedulerStarted: boolean;
  autoScanTimer: ReturnType<typeof setTimeout> | null;
  nextAutoScanAt: string | null;
};

// Next.js can bundle server modules into more than one server chunk. Keeping the
// runtime state on globalThis makes the scan lock and scheduler process-wide.
const runtimeGlobal = globalThis as typeof globalThis & {
  __spotlessScannerRuntimeV1?: ScannerRuntime;
};
const runtime: ScannerRuntime =
  runtimeGlobal.__spotlessScannerRuntimeV1 ??
  (runtimeGlobal.__spotlessScannerRuntimeV1 = {
    scanning: false,
    lastScan: null,
    lastScanError: null,
    schedulerStarted: false,
    autoScanTimer: null,
    nextAutoScanAt: null,
  });

export function getMusicDir(): string {
  return getSetting('music_dir') || DEFAULT_MUSIC_DIR;
}

export function setMusicDir(dir: string): void {
  const resolved = path.resolve(dir);
  const stat = fs.statSync(resolved); // throws if missing
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${resolved}`);
  setSetting('music_dir', resolved);
}

export function getAutoScanIntervalMinutes(): AutoScanIntervalMinutes {
  const raw = Number(getSetting(AUTO_SCAN_SETTING) ?? 0);
  return AUTO_SCAN_ALLOWED.has(raw) ? (raw as AutoScanIntervalMinutes) : 0;
}

export function setAutoScanIntervalMinutes(minutes: number): AutoScanIntervalMinutes {
  if (!Number.isInteger(minutes) || !AUTO_SCAN_ALLOWED.has(minutes)) {
    throw new Error(`Unsupported automatic scan interval: ${minutes}`);
  }
  const value = minutes as AutoScanIntervalMinutes;
  setSetting(AUTO_SCAN_SETTING, String(value));
  if (runtime.schedulerStarted) scheduleNextAutoScan();
  return value;
}

function scheduleNextAutoScan(): void {
  if (runtime.autoScanTimer) {
    clearTimeout(runtime.autoScanTimer);
    runtime.autoScanTimer = null;
  }
  runtime.nextAutoScanAt = null;

  if (!runtime.schedulerStarted) return;

  const minutes = getAutoScanIntervalMinutes();
  if (minutes === 0) return;

  const delayMs = minutes * 60 * 1000;
  runtime.nextAutoScanAt = new Date(Date.now() + delayMs).toISOString();

  const timer = setTimeout(() => {
    runtime.autoScanTimer = null;
    runtime.nextAutoScanAt = null;
    scanLibrary({ automatic: true }).catch((err) => console.error('automatic scan failed:', err));
  }, delayMs);

  // The HTTP server itself keeps the process alive; the scheduler should not.
  timer.unref?.();
  runtime.autoScanTimer = timer;
}

/** Start/resume the persistent in-process scheduler for this Spotless server instance. */
export function startLibraryScanScheduler(): void {
  runtime.schedulerStarted = true;
  scheduleNextAutoScan();
}

export function scanStatus() {
  return {
    scanning: runtime.scanning,
    lastScan: runtime.lastScan,
    lastScanError: runtime.lastScanError,
    autoScanIntervalMinutes: getAutoScanIntervalMinutes(),
    nextAutoScanAt: runtime.nextAutoScanAt,
    allowedAutoScanIntervals: AUTO_SCAN_INTERVALS,
  };
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

const albumArtFile = (albumId: number) => path.join(artDir(), `${albumId}.img`);
const artistArtFile = (artistId: number) => path.join(artDir(), `artist-${artistId}.img`);

/** Remove cached art for rows that no longer exist. A missing file is the normal case. */
function unlinkArtFiles(files: string[]): void {
  for (const file of files) {
    try {
      fs.unlinkSync(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`scan: could not remove ${file}:`, err);
    }
  }
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
  // art of merged-away rows; unlinked only once the transaction has committed
  const orphanArt: string[] = [];

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
      orphanArt.push(albumArtFile(al.id));
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
          orphanArt.push(albumArtFile(al.id));
        }
        moveCollections.run(keeper.id, dup.id);
        dropCollections.run(dup.id);
        delArtist.run(dup.id);
        orphanArt.push(artistArtFile(dup.id));
      }

      // normalize the surviving name ("A feat. B" as the only entry → "A")
      const canon = stripFeat(keeper.name);
      if (canon && canon !== keeper.name) renameArtist.run(canon, keeper.id);

      mergeAlbumsOf(keeper.id);
    }
  });
  tx();
  unlinkArtFiles(orphanArt);
}

/** Minimal counting semaphore: runs at most `max` of the wrapped async calls at once. */
function semaphore(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiters: (() => void)[] = [];
  return async (fn) => {
    if (active >= max) await new Promise<void>((resolve) => waiters.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiters.shift()?.();
    }
  };
}

type AudioFile = {
  path: string;
  /** Whole milliseconds; null when stat failed (file is kept but not re-read this scan). */
  mtime: number | null;
};

/**
 * Collect audio files. The root must be readable (the caller checks); a subfolder that
 * can't be read is skipped and recorded in `unreadable`, so the removal phase keeps its
 * tracks instead of treating a permissions hiccup as deleted files. Directory reads and
 * stats are async and bounded so a slow NAS never blocks the event loop for the whole walk.
 */
async function walk(
  dir: string,
  out: AudioFile[],
  unreadable: string[],
  run: ReturnType<typeof semaphore>
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await run(() => fs.promises.readdir(dir, { withFileTypes: true }));
  } catch (err) {
    console.warn(`scan: cannot read ${dir}, keeping its tracks:`, err);
    unreadable.push(dir + path.sep);
    return;
  }
  const pending: Promise<void>[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      pending.push(walk(full, out, unreadable, run));
    } else if (EXTS.has(path.extname(e.name).toLowerCase())) {
      pending.push(
        run(() => fs.promises.stat(full)).then(
          (stat) => {
            out.push({ path: full, mtime: Math.floor(stat.mtimeMs) });
          },
          () => {
            out.push({ path: full, mtime: null });
          }
        )
      );
    }
  }
  await Promise.all(pending);
}

type TrackRow = {
  id: number;
  path: string;
  mtime: number;
  album_id: number;
  artist_id: number;
  title: string;
  track_no: number;
  disc_no: number;
  genre: string | null;
  duration: number;
  gain: number | null;
  artist: string;
  album: string;
};

const SELECT_TRACK_FOR_RELINK = `
  SELECT t.id, t.path, t.mtime, t.album_id, t.artist_id, t.title, t.track_no, t.disc_no, t.genre,
         t.duration, t.gain, ar.name AS artist, al.name AS album
  FROM tracks t JOIN albums al ON al.id = t.album_id JOIN artists ar ON ar.id = t.artist_id`;

/** Identity of a song independent of where its file lives; duration is checked separately. */
const relinkKey = (t: TrackRow) => `${artistKey(t.artist)}|${albumKey(t.album)}|${foldText(t.title)}|${t.track_no}`;

/**
 * Track ids are what likes, history, playlists and lyrics point at, so a moved or
 * renamed file must keep its row. Each `vanished` row (its path is gone) is matched
 * one-to-one against the rows inserted this scan by folded artist + album + title +
 * track number and a duration within RELINK_DURATION_TOLERANCE_S (exact wins). On a
 * match the fresh row is dropped and the old row takes over the new file; whatever
 * stays unmatched is really gone and is deleted. Everything runs in one transaction.
 */
export function relinkVanishedTracks(
  db: ReturnType<typeof getDb>,
  vanished: { id: number }[],
  inserted: Iterable<string>
): { relinked: number; removed: number } {
  const byId = db.prepare(`${SELECT_TRACK_FOR_RELINK} WHERE t.id = ?`);
  const byPath = db.prepare(`${SELECT_TRACK_FOR_RELINK} WHERE t.path = ?`);
  const delTrack = db.prepare('DELETE FROM tracks WHERE id = ?');
  const takeOver = db.prepare(`
    UPDATE tracks SET path = @path, mtime = @mtime, album_id = @album_id, artist_id = @artist_id, title = @title,
      track_no = @track_no, disc_no = @disc_no, genre = @genre, duration = @duration, gain = @gain
    WHERE id = @id
  `);

  const tx = db.transaction(() => {
    const candidates = new Map<string, TrackRow[]>();
    for (const p of inserted) {
      const row = byPath.get(p) as TrackRow | undefined;
      if (!row) continue;
      const key = relinkKey(row);
      const list = candidates.get(key) ?? [];
      list.push(row);
      candidates.set(key, list);
    }

    let relinked = 0;
    let removed = 0;
    // ascending id: the oldest row (most likely to carry history) gets first pick
    const old = vanished
      .map((v) => byId.get(v.id) as TrackRow | undefined)
      .filter((r): r is TrackRow => r !== undefined)
      .sort((a, b) => a.id - b.id);
    for (const row of old) {
      const list = candidates.get(relinkKey(row)) ?? [];
      let best: TrackRow | null = null;
      let bestDiff = Number.POSITIVE_INFINITY;
      for (const c of list) {
        const diff = Math.abs(c.duration - row.duration);
        if (diff <= RELINK_DURATION_TOLERANCE_S && diff < bestDiff) {
          best = c;
          bestDiff = diff;
        }
      }
      if (!best) {
        delTrack.run(row.id);
        removed++;
        continue;
      }
      list.splice(list.indexOf(best), 1);
      // the new row goes first so the UNIQUE(path) slot is free for the old id
      delTrack.run(best.id);
      takeOver.run({
        id: row.id,
        path: best.path,
        mtime: best.mtime,
        album_id: best.album_id,
        artist_id: best.artist_id,
        title: best.title,
        track_no: best.track_no,
        disc_no: best.disc_no,
        genre: best.genre,
        duration: best.duration,
        gain: best.gain,
      });
      relinked++;
    }
    return { relinked, removed };
  });
  return tx();
}

/** Embedded cover selection: the tagged front cover when there is one, else the first picture. */
function pickEmbeddedArt(pictures: { data: Uint8Array; type?: string }[]): Buffer | null {
  const pic = pictures.find((p) => p.type === 'Cover (front)') ?? pictures[0];
  if (!pic || pic.data.length === 0 || pic.data.length > MAX_EMBEDDED_ART_BYTES) return null;
  const buf = Buffer.from(pic.data);
  return imageContentType(buf) ? buf : null;
}

/** Write cover art via temp file + rename so a crash never leaves a truncated image. */
function writeArtAtomic(file: string, buf: Buffer): void {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temp, buf);
    // Windows cannot rename over an existing file; a stale has_art=0 leftover is safe to drop
    fs.rmSync(file, { force: true });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

export async function scanLibrary(options: { automatic?: boolean } = {}): Promise<void> {
  if (runtime.scanning) {
    if (runtime.schedulerStarted) scheduleNextAutoScan();
    return;
  }
  runtime.scanning = true;
  try {
    const db = getDb();
    // TS resolves the browser entry which lacks parseFile; runtime (node) has it
    const { parseFile } = (await import('music-metadata')) as unknown as {
      parseFile: (
        path: string,
        opts?: { duration?: boolean; skipCovers?: boolean }
      ) => Promise<import('music-metadata').IAudioMetadata>;
    };
    // fold pre-existing duplicate artists/albums together before matching new files
    dedupeLibrary(db);

    const musicDir = getMusicDir();
    const rootStat = fs.statSync(musicDir);
    if (!rootStat.isDirectory()) throw new Error(`Music directory is not a directory: ${musicDir}`);
    fs.accessSync(musicDir, fs.constants.R_OK);

    const unreadable: string[] = [];
    const files: AudioFile[] = [];
    await walk(musicDir, files, unreadable, semaphore(WALK_CONCURRENCY));
    // the concurrent walk finishes in I/O order; sort so scans are reproducible
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const fileSet = new Set(files.map((f) => f.path));

    const existing = db.prepare('SELECT id, path, mtime FROM tracks').all() as {
      id: number;
      path: string;
      mtime: number;
    }[];
    const knownMtime = new Map(existing.map((t) => [t.path, t.mtime]));

    // A temporarily missing bind/NAS mount can appear as a perfectly readable but
    // empty directory. Never let an unattended automatic scan erase a previously
    // populated library in that situation. A manual Rescan now still permits an
    // intentionally emptied library to be cleared.
    if (options.automatic && files.length === 0 && existing.length > 0) {
      throw new Error(`Automatic scan aborted: music directory is empty (${musicDir})`);
    }

    // Rows whose file is gone are NOT deleted yet: after the upsert phase they get a
    // chance to adopt a freshly inserted file (rename/move) so their id survives.
    const vanished = existing.filter(
      (row) => !fileSet.has(row.path) && !unreadable.some((d) => row.path.startsWith(d))
    );

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

    type TrackUpsert = {
      title: string;
      albumId: number;
      artistId: number;
      duration: number;
      trackNo: number;
      discNo: number;
      genre: string | null;
      path: string;
      mtime: number;
      gain: number | null;
    };
    let batch: TrackUpsert[] = [];
    const flushBatch = db.transaction((rows: TrackUpsert[]) => {
      for (const row of rows) upTrack.run(row);
    });
    const flush = async () => {
      if (batch.length === 0) return;
      flushBatch(batch);
      batch = [];
      // let queued HTTP requests (streams, status polls) run between batches
      await new Promise<void>((resolve) => setImmediate(resolve));
    };

    const inserted: string[] = [];
    let changed = 0;
    for (const { path: file, mtime } of files) {
      if (mtime === null) continue;
      const known = knownMtime.get(file);
      if (known === mtime) continue;

      try {
        // Covers are the bulk of the bytes a tag parse copies around, and most albums
        // already have art; the picture is fetched in a second cheap pass (no duration
        // scan) only when the album the file belongs to still lacks it.
        const meta = await parseFile(file, { duration: true, skipCovers: true });
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

        if (!album.has_art) {
          const pictures = (await parseFile(file, { duration: false, skipCovers: false })).common.picture;
          const art = pictures && pictures.length > 0 ? pickEmbeddedArt(pictures) : null;
          if (art) {
            writeArtAtomic(albumArtFile(album.id), art);
            setArt.run(album.id);
            album.has_art = 1;
          }
        }

        batch.push({
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
        changed++;
        if (known === undefined) inserted.push(file);
        if (batch.length >= UPSERT_BATCH) await flush();
      } catch (err) {
        console.warn(`scan: failed to parse ${file}:`, err);
      }
    }
    await flush();

    // moved/renamed files keep their old id (likes, history, playlists, lyrics);
    // only rows that found no new home are removed
    const { relinked, removed } = relinkVanishedTracks(db, vanished, inserted);
    const added = inserted.length - relinked;

    // prune empty albums/artists, then their cached art
    const emptyAlbums = db
      .prepare('SELECT id FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks)')
      .all() as { id: number }[];
    const emptyArtists = db
      .prepare('SELECT id FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM tracks)')
      .all() as { id: number }[];
    db.transaction(() => {
      db.exec(`
        DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks);
        DELETE FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM tracks);
      `);
    })();
    unlinkArtFiles([...emptyAlbums.map((a) => albumArtFile(a.id)), ...emptyArtists.map((a) => artistArtFile(a.id))]);

    // playlist placeholders (Spotify imports) fill in once the song lands in the library
    try {
      resolvePlaceholders(db);
    } catch (err) {
      console.warn('scan: placeholder resolve failed:', err);
    }

    const total = (db.prepare('SELECT COUNT(*) AS n FROM tracks').get() as { n: number }).n;
    runtime.lastScan = { at: new Date().toISOString(), added, removed, relinked, total };
    runtime.lastScanError = null;
    console.log(`scan: done. +${added} -${removed} ~${relinked} relinked, total ${total}`);

    // Preserve the existing behavior for startup/manual/webhook scans. Automatic
    // scans only trigger remote artwork backfill when the library actually changed,
    // avoiding unnecessary network requests every 5/15/etc. minutes.
    if (!options.automatic || changed > 0 || removed > 0) {
      const { fetchMissingArt } = await import('./art');
      fetchMissingArt().catch((err) => console.error('art fetch failed:', err));
    }

    // Optional synced-LRC sidecar job. It is process-locked, never overwrites an
    // existing .lrc/.LRC, and throttles its own LRCLIB requests.
    const { triggerLyricsSidecarSync } = await import('./lyrics');
    triggerLyricsSidecarSync();
  } catch (err) {
    runtime.lastScanError = {
      at: new Date().toISOString(),
      message: err instanceof Error ? err.message : String(err),
    };
    throw err;
  } finally {
    runtime.scanning = false;
    if (runtime.schedulerStarted) scheduleNextAutoScan();
  }
}
