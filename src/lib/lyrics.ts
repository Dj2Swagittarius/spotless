import fs from 'fs';
import path from 'path';
import { getDb, getSetting, setSetting } from './db';

export type LyricLine = {
  start?: number;
  value: string;
};

export type ResolvedLyrics = {
  track: {
    id: number;
    title: string;
    artist: string;
    album: string;
    duration: number;
    path: string;
  };
  synced: boolean;
  lines: LyricLine[];
  offset: number;
  rawSynced: string | null;
  plain: string | null;
  source: 'local-lrc' | 'cache' | 'lrclib' | 'none';
};

type TrackRow = {
  id: number;
  title: string;
  artist: string;
  album: string;
  duration: number;
  path: string;
};

type LrclibResponse = {
  instrumental?: boolean;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
};

type CachedLyricsRow = {
  synced: string | null;
  plain: string | null;
  fetched_at: string;
};

export type LyricsSidecarRun = {
  at: string;
  total: number;
  existing: number;
  written: number;
  cached: number;
  noSyncedLyrics: number;
  deferred: number;
  errors: number;
  stoppedByRateLimit: boolean;
};

type LyricsSidecarRuntime = {
  running: boolean;
  lastRun: LyricsSidecarRun | null;
  lastError: string | null;
};

const TIME_TAG = /\[(\d+):([0-5]?\d)(?:[.:](\d{1,3}))?\]/g;
const ENHANCED_WORD_TAG = /<\d+:[0-5]?\d(?:[.:]\d{1,3})?>/g;
const META_TAG = /^\[(?:ar|al|ti|au|lr|by|length|offset|re|tool|ve|la):.*\]\s*$/i;

const LRCLIB_USER_AGENT = 'Spotless/0.1.0 (https://github.com/Dj2Swagittarius/spotless)';
const LRCLIB_TIMEOUT_MS = 15_000;
const LRCLIB_BATCH_DELAY_MS = 350;
const MISSING_SYNC_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const AUTO_SIDECAR_SETTING = 'lyrics_auto_sidecar_enabled';

const runtimeGlobal = globalThis as typeof globalThis & {
  __spotlessLyricsSidecarRuntimeV1?: LyricsSidecarRuntime;
};
const sidecarRuntime: LyricsSidecarRuntime =
  runtimeGlobal.__spotlessLyricsSidecarRuntimeV1 ??
  (runtimeGlobal.__spotlessLyricsSidecarRuntimeV1 = {
    running: false,
    lastRun: null,
    lastError: null,
  });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimOuterBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;

  return lines.slice(start, end);
}

export function parseLrc(raw: string): {
  synced: boolean;
  lines: LyricLine[];
  offset: number;
  plain: string | null;
} {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  const offsetMatch = text.match(/^\[offset:([+-]?\d+)\]\s*$/im);
  const offset = offsetMatch ? Number(offsetMatch[1]) || 0 : 0;

  const timedLines: LyricLine[] = [];
  const plainLines: string[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    const timestamps = Array.from(line.matchAll(TIME_TAG));

    if (timestamps.length > 0) {
      const value = line.replace(TIME_TAG, '').replace(ENHANCED_WORD_TAG, '').trim();

      for (const match of timestamps) {
        const minutes = Number(match[1]);
        const seconds = Number(match[2]);
        const fraction = (match[3] ?? '0').padEnd(3, '0').slice(0, 3);

        timedLines.push({
          start: minutes * 60_000 + seconds * 1_000 + Number(fraction),
          value,
        });
      }

      plainLines.push(value);
      continue;
    }

    if (META_TAG.test(line)) continue;
    plainLines.push(line);
  }

  timedLines.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const cleanedPlain = trimOuterBlankLines(plainLines).join('\n');

  if (timedLines.length > 0) {
    return {
      synced: true,
      lines: timedLines,
      offset,
      plain: cleanedPlain || null,
    };
  }

  const unsyncedLines = trimOuterBlankLines(plainLines).map((value) => ({ value }));

  return {
    synced: false,
    lines: unsyncedLines,
    offset,
    plain: cleanedPlain || null,
  };
}

function getTrack(id: number): TrackRow | undefined {
  return getDb()
    .prepare(
      `
      SELECT
        t.id,
        t.title,
        t.duration,
        t.path,
        ar.name AS artist,
        al.name AS album
      FROM tracks t
      JOIN artists ar ON ar.id = t.artist_id
      JOIN albums al ON al.id = t.album_id
      WHERE t.id = ?
      `
    )
    .get(id) as TrackRow | undefined;
}

function getAllTracks(): TrackRow[] {
  return getDb()
    .prepare(
      `
      SELECT
        t.id,
        t.title,
        t.duration,
        t.path,
        ar.name AS artist,
        al.name AS album
      FROM tracks t
      JOIN artists ar ON ar.id = t.artist_id
      JOIN albums al ON al.id = t.album_id
      ORDER BY ar.name COLLATE NOCASE, al.name COLLATE NOCASE, t.disc_no, t.track_no, t.title COLLATE NOCASE
      `
    )
    .all() as TrackRow[];
}

export function localLrcCandidates(audioPath: string): string[] {
  const parsed = path.parse(audioPath);
  return [
    path.join(parsed.dir, `${parsed.name}.lrc`),
    path.join(parsed.dir, `${parsed.name}.LRC`),
  ];
}

function existingLocalLrc(audioPath: string): string | null {
  for (const candidate of localLrcCandidates(audioPath)) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // Keep trying the remaining candidate/fallback sources.
    }
  }
  return null;
}

function emptyResult(track: TrackRow): ResolvedLyrics {
  return {
    track,
    synced: false,
    lines: [],
    offset: 0,
    rawSynced: null,
    plain: null,
    source: 'none',
  };
}

function fromStoredLyrics(
  track: TrackRow,
  synced: string | null,
  plain: string | null,
  source: 'cache' | 'lrclib'
): ResolvedLyrics {
  if (synced) {
    const parsed = parseLrc(synced);
    if (parsed.synced && parsed.lines.length > 0) {
      return {
        track,
        synced: true,
        lines: parsed.lines,
        offset: parsed.offset,
        rawSynced: synced,
        plain: parsed.plain ?? plain,
        source,
      };
    }
  }

  if (plain) {
    const parsed = parseLrc(plain);
    return {
      track,
      synced: false,
      lines: parsed.lines,
      offset: parsed.offset,
      rawSynced: null,
      plain,
      source,
    };
  }

  return emptyResult(track);
}

function cacheAgeMs(fetchedAt: string): number {
  const iso = fetchedAt.includes('T') ? fetchedAt : `${fetchedAt.replace(' ', 'T')}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.max(0, Date.now() - ms) : Number.POSITIVE_INFINITY;
}

function upsertLyrics(trackId: number, synced: string | null, plain: string | null): void {
  getDb()
    .prepare(
      `
      INSERT INTO lyrics (track_id, synced, plain, fetched_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(track_id) DO UPDATE SET
        synced = excluded.synced,
        plain = excluded.plain,
        fetched_at = datetime('now')
      `
    )
    .run(trackId, synced, plain);
}

async function fetchLrclib(params: URLSearchParams): Promise<Response> {
  return fetch(`https://lrclib.net/api/get?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': LRCLIB_USER_AGENT,
    },
    signal: AbortSignal.timeout(LRCLIB_TIMEOUT_MS),
  });
}

type LrclibLookup = {
  synced: string | null;
  plain: string | null;
  notFound: boolean;
  rateLimited: boolean;
  retryAfterSeconds: number | null;
};

async function lookupLrclib(track: TrackRow): Promise<LrclibLookup> {
  const duration = String(Math.round(track.duration));
  const exact = new URLSearchParams({
    artist_name: track.artist,
    track_name: track.title,
    album_name: track.album,
    duration,
  });

  let response = await fetchLrclib(exact);

  // Reissues/deluxe editions often carry the same recording under a different
  // album name. Keep duration for safety, but relax only the album constraint.
  if (response.status === 404) {
    const fallback = new URLSearchParams({
      artist_name: track.artist,
      track_name: track.title,
      duration,
    });
    response = await fetchLrclib(fallback);
  }

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after'));
    return {
      synced: null,
      plain: null,
      notFound: false,
      rateLimited: true,
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    };
  }

  if (response.status === 404) {
    return { synced: null, plain: null, notFound: true, rateLimited: false, retryAfterSeconds: null };
  }

  if (!response.ok) {
    throw new Error(`LRCLIB request failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as LrclibResponse;
  return {
    synced: data.syncedLyrics || null,
    plain: data.plainLyrics || null,
    notFound: false,
    rateLimited: false,
    retryAfterSeconds: null,
  };
}

export async function resolveLyrics(trackId: number): Promise<ResolvedLyrics | null> {
  const db = getDb();
  const track = getTrack(trackId);
  if (!track) return null;

  const local = existingLocalLrc(track.path);
  if (local) {
    try {
      const raw = fs.readFileSync(local, 'utf8');
      const parsed = parseLrc(raw);
      if (parsed.lines.length > 0) {
        return {
          track,
          synced: parsed.synced,
          lines: parsed.lines,
          offset: parsed.offset,
          rawSynced: parsed.synced ? raw : null,
          plain: parsed.plain,
          source: 'local-lrc',
        };
      }
    } catch (error) {
      console.warn(`lyrics: failed reading ${local}`, error);
    }
  }

  const cached = db
    .prepare('SELECT synced, plain, fetched_at FROM lyrics WHERE track_id = ?')
    .get(trackId) as CachedLyricsRow | undefined;

  // A synchronized cache hit is immediately useful. Plain-only/miss results are
  // refreshed weekly so tracks can automatically gain synced lyrics later.
  if (cached?.synced) return fromStoredLyrics(track, cached.synced, cached.plain, 'cache');
  if (cached && cacheAgeMs(cached.fetched_at) < MISSING_SYNC_RETRY_MS) {
    return fromStoredLyrics(track, cached.synced, cached.plain, 'cache');
  }

  try {
    const result = await lookupLrclib(track);

    if (result.rateLimited) {
      console.warn(
        `lyrics: LRCLIB rate limited request; Retry-After=${result.retryAfterSeconds ?? 'unknown'}`
      );
      return cached ? fromStoredLyrics(track, cached.synced, cached.plain, 'cache') : emptyResult(track);
    }

    upsertLyrics(trackId, result.synced, result.plain);
    return fromStoredLyrics(track, result.synced, result.plain, 'lrclib');
  } catch (error) {
    console.warn('lyrics: LRCLIB request failed', error);
    return cached ? fromStoredLyrics(track, cached.synced, cached.plain, 'cache') : emptyResult(track);
  }
}

export function getAutoLyricsSidecarsEnabled(): boolean {
  return getSetting(AUTO_SIDECAR_SETTING) === '1';
}

export function setAutoLyricsSidecarsEnabled(enabled: boolean): void {
  setSetting(AUTO_SIDECAR_SETTING, enabled ? '1' : '0');
}

function getConfiguredMusicRoot(): string {
  const configured = getSetting('music_dir') || process.env.MUSIC_DIR || path.join(process.cwd(), 'music');
  return path.resolve(configured);
}

function resolveMusicRoots(): { readRoot: string; writeRoot: string } {
  const readRoot = getConfiguredMusicRoot();
  const writeBase = process.env.MUSIC_WRITE_DIR;
  if (!writeBase) return { readRoot, writeRoot: readRoot };

  // In Docker the same host library is mounted at /music:ro and /music-write:rw.
  // If Settings points Spotless at /music/subfolder, preserve that subfolder on
  // the write mirror instead of incorrectly writing to /music-write's root.
  const readBase = path.resolve(process.env.MUSIC_DIR || readRoot);
  const relativeConfiguredRoot = path.relative(readBase, readRoot);
  if (relativeConfiguredRoot.startsWith('..') || path.isAbsolute(relativeConfiguredRoot)) {
    throw new Error(
      `Configured music directory (${readRoot}) is outside MUSIC_DIR (${readBase}); cannot map it safely to MUSIC_WRITE_DIR`
    );
  }

  return {
    readRoot,
    writeRoot: path.resolve(writeBase, relativeConfiguredRoot),
  };
}

export function getLyricsWriteRoot(): string {
  try {
    return resolveMusicRoots().writeRoot;
  } catch {
    return path.resolve(process.env.MUSIC_WRITE_DIR || getConfiguredMusicRoot());
  }
}

function sidecarWritePath(trackPath: string): string {
  const { readRoot, writeRoot } = resolveMusicRoots();
  const absoluteTrack = path.resolve(trackPath);
  const relativeTrack = path.relative(readRoot, absoluteTrack);

  if (!relativeTrack || relativeTrack.startsWith('..') || path.isAbsolute(relativeTrack)) {
    throw new Error(`Track path is outside the configured music directory: ${trackPath}`);
  }

  const writeAudioPath = path.join(writeRoot, relativeTrack);
  const parsed = path.parse(writeAudioPath);
  return path.join(parsed.dir, `${parsed.name}.lrc`);
}

function ensureLyricsWriteRoot(): void {
  const { writeRoot } = resolveMusicRoots();
  const stat = fs.statSync(writeRoot);
  if (!stat.isDirectory()) throw new Error(`Lyrics write directory is not a directory: ${writeRoot}`);
  fs.accessSync(writeRoot, fs.constants.R_OK | fs.constants.W_OK);
}

function writeSidecarExclusive(destination: string, contents: string): boolean {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temp = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.spotless-${process.pid}-${Date.now()}.tmp`
  );

  try {
    fs.writeFileSync(temp, contents.endsWith('\n') ? contents : `${contents}\n`, 'utf8');
    try {
      fs.copyFileSync(temp, destination, fs.constants.COPYFILE_EXCL);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch {
      // no-op
    }
  }
}

export function lyricsSidecarStatus() {
  return {
    enabled: getAutoLyricsSidecarsEnabled(),
    running: sidecarRuntime.running,
    lastRun: sidecarRuntime.lastRun,
    lastError: sidecarRuntime.lastError,
    writeRoot: getLyricsWriteRoot(),
  };
}

/**
 * Fetch missing synchronized lyrics and save only synced `.lrc` sidecars.
 * Existing `.lrc`/`.LRC` files are never overwritten.
 */
export async function syncMissingLyricsSidecars(): Promise<void> {
  if (sidecarRuntime.running) return;
  sidecarRuntime.running = true;
  sidecarRuntime.lastError = null;

  const stats: LyricsSidecarRun = {
    at: new Date().toISOString(),
    total: 0,
    existing: 0,
    written: 0,
    cached: 0,
    noSyncedLyrics: 0,
    deferred: 0,
    errors: 0,
    stoppedByRateLimit: false,
  };

  try {
    ensureLyricsWriteRoot();
    const db = getDb();
    const tracks = getAllTracks();
    stats.total = tracks.length;

    const getCached = db.prepare('SELECT synced, plain, fetched_at FROM lyrics WHERE track_id = ?');

    for (const track of tracks) {
      if (existingLocalLrc(track.path)) {
        stats.existing++;
        continue;
      }

      let destination: string;
      try {
        destination = sidecarWritePath(track.path);
        if (fs.existsSync(destination) || fs.existsSync(destination.replace(/\.lrc$/i, '.LRC'))) {
          stats.existing++;
          continue;
        }
      } catch (error) {
        stats.errors++;
        console.warn(`lyrics sidecar: cannot map ${track.path}`, error);
        continue;
      }

      const cached = getCached.get(track.id) as CachedLyricsRow | undefined;
      let synced = cached?.synced ?? null;

      if (synced) {
        try {
          if (writeSidecarExclusive(destination, synced)) stats.written++;
          else stats.existing++;
          stats.cached++;
        } catch (error) {
          stats.errors++;
          console.warn(`lyrics sidecar: failed writing ${destination}`, error);
        }
        continue;
      }

      if (cached && cacheAgeMs(cached.fetched_at) < MISSING_SYNC_RETRY_MS) {
        stats.deferred++;
        continue;
      }

      try {
        const result = await lookupLrclib(track);

        if (result.rateLimited) {
          stats.stoppedByRateLimit = true;
          if (result.retryAfterSeconds) await sleep(result.retryAfterSeconds * 1000);
          break;
        }

        upsertLyrics(track.id, result.synced, result.plain);
        synced = result.synced;

        if (!synced) {
          stats.noSyncedLyrics++;
        } else {
          try {
            if (writeSidecarExclusive(destination, synced)) stats.written++;
            else stats.existing++;
          } catch (error) {
            stats.errors++;
            console.warn(`lyrics sidecar: failed writing ${destination}`, error);
          }
        }
      } catch (error) {
        stats.errors++;
        console.warn(`lyrics sidecar: LRCLIB lookup failed for ${track.artist} - ${track.title}`, error);
      }

      // LRCLIB asks batch clients to send requests sequentially with a short delay.
      await sleep(LRCLIB_BATCH_DELAY_MS);
    }

    stats.at = new Date().toISOString();
    sidecarRuntime.lastRun = stats;
    console.log(
      `lyrics sidecar: wrote ${stats.written}, existing ${stats.existing}, no synced ${stats.noSyncedLyrics}, deferred ${stats.deferred}, errors ${stats.errors}`
    );
  } catch (error) {
    sidecarRuntime.lastError = error instanceof Error ? error.message : String(error);
    console.error('lyrics sidecar sync failed:', error);
    throw error;
  } finally {
    sidecarRuntime.running = false;
  }
}

/** Trigger the background sidecar job after a successful library scan when enabled. */
export function triggerLyricsSidecarSync(): void {
  if (!getAutoLyricsSidecarsEnabled() || sidecarRuntime.running) return;
  syncMissingLyricsSidecars().catch(() => {});
}
