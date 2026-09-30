import fs from 'fs';
import path from 'path';
import { getDb } from './db';

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
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
};

const TIME_TAG = /\[(\d+):([0-5]?\d)(?:[.:](\d{1,3}))?\]/g;
const ENHANCED_WORD_TAG = /<\d+:[0-5]?\d(?:[.:]\d{1,3})?>/g;
const META_TAG = /^\[(?:ar|al|ti|au|lr|by|length|offset|re|tool|ve|la):.*\]\s*$/i;

const LRCLIB_USER_AGENT = 'Spotless/0.1.0 (https://github.com/Dj2Swagittarius/spotless)';
const LRCLIB_TIMEOUT_MS = 15_000;

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

      // Multiple timestamp tags on one LRC line still represent one text line.
      plainLines.push(value);
      continue;
    }

    // Ignore normal LRC metadata such as [ar:], [ti:], [offset:], etc.
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

function localLrcCandidates(audioPath: string): string[] {
  const parsed = path.parse(audioPath);

  // Linux containers are case-sensitive, so check the two common forms.
  return [
    path.join(parsed.dir, `${parsed.name}.lrc`),
    path.join(parsed.dir, `${parsed.name}.LRC`),
  ];
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

async function fetchLrclib(params: URLSearchParams): Promise<Response> {
  return fetch(`https://lrclib.net/api/get?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': LRCLIB_USER_AGENT,
    },
    signal: AbortSignal.timeout(LRCLIB_TIMEOUT_MS),
  });
}

export async function resolveLyrics(trackId: number): Promise<ResolvedLyrics | null> {
  const db = getDb();
  const track = getTrack(trackId);

  if (!track) return null;

  /*
   * PRIORITY 1: local sidecar LRC beside the audio file.
   *
   * Example:
   * /music/Artist/Album/Song.flac
   * /music/Artist/Album/Song.lrc
   */
  for (const candidate of localLrcCandidates(track.path)) {
    try {
      if (!fs.existsSync(candidate)) continue;

      const raw = fs.readFileSync(candidate, 'utf8');
      const parsed = parseLrc(raw);

      if (parsed.lines.length === 0) continue;

      return {
        track,
        synced: parsed.synced,
        lines: parsed.lines,
        offset: parsed.offset,
        rawSynced: parsed.synced ? raw : null,
        plain: parsed.plain,
        source: 'local-lrc',
      };
    } catch (error) {
      // A bad/unreadable sidecar should not prevent fallback to cached/LRCLIB lyrics.
      console.warn(`lyrics: failed reading ${candidate}`, error);
    }
  }

  /*
   * PRIORITY 2: existing LRCLIB cache in SQLite.
   */
  const cached = db
    .prepare('SELECT synced, plain FROM lyrics WHERE track_id = ?')
    .get(trackId) as
    | {
        synced: string | null;
        plain: string | null;
      }
    | undefined;

  if (cached) {
    return fromStoredLyrics(track, cached.synced, cached.plain, 'cache');
  }

  /*
   * PRIORITY 3: query LRCLIB.
   *
   * First try the most precise signature. If that returns 404, retry without
   * the album constraint but keep duration because LRCLIB uses duration to
   * distinguish different recordings of the same song.
   */
  let synced: string | null = null;
  let plain: string | null = null;

  try {
    const duration = String(Math.round(track.duration));

    const exact = new URLSearchParams({
      artist_name: track.artist,
      track_name: track.title,
      album_name: track.album,
      duration,
    });

    let response = await fetchLrclib(exact);

    if (response.status === 404) {
      const fallback = new URLSearchParams({
        artist_name: track.artist,
        track_name: track.title,
        duration,
      });

      response = await fetchLrclib(fallback);
    }

    if (response.ok) {
      const data = (await response.json()) as LrclibResponse;
      synced = data.syncedLyrics || null;
      plain = data.plainLyrics || null;
    } else if (response.status === 429) {
      // Do not retry immediately and do not cache a temporary rate-limit miss.
      console.warn(
        `lyrics: LRCLIB rate limited request; Retry-After=${response.headers.get('retry-after') ?? 'unknown'}`
      );
      return emptyResult(track);
    } else if (response.status !== 404) {
      // Do not cache transient server/client errors as permanent misses.
      console.warn(`lyrics: LRCLIB request failed with HTTP ${response.status}`);
      return emptyResult(track);
    }
  } catch (error) {
    // Network/timeout failure is temporary, so do not cache it as a miss.
    console.warn('lyrics: LRCLIB request failed', error);
    return emptyResult(track);
  }

  /*
   * Preserve Spotless's existing behavior: cache successful lookups and real
   * LRCLIB 404 misses so repeated playback does not hammer the public API.
   */
  db.prepare(
    `
    INSERT OR REPLACE INTO lyrics
      (track_id, synced, plain)
    VALUES (?, ?, ?)
    `
  ).run(trackId, synced, plain);

  return fromStoredLyrics(track, synced, plain, 'lrclib');
}