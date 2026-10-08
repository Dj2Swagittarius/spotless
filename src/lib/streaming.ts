import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { Readable } from 'stream';

/**
 * Shared audio delivery for the web player (/api/stream) and the Subsonic API (/rest/stream):
 * raw file with byte-range support, or an ffmpeg transcode when a format/bitrate is requested.
 * Transcoded output is a live pipe (no ranges) — same tradeoff every Subsonic server makes.
 */

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

// Lossless sources are many times larger than any requested bitrate, so a maxBitRate
// on them always means "shrink me" and never qualifies for the raw-file shortcut.
const LOSSLESS = new Set(['.flac', '.wav', '.aiff', '.aif']);

// Each ffmpeg saturates a core; past this many at once every stream starts stuttering,
// so extra listeners get the raw file instead of a transcode that would starve the rest
// (or a 503 when they asked to start mid-track, where a raw file would be the wrong audio).
const TRANSCODE_MAX_ACTIVE = (() => {
  const n = Number(process.env.TRANSCODE_MAX_ACTIVE);
  return Number.isInteger(n) && n > 0 ? n : Math.max(1, os.cpus().length);
})();
const CAP_LOG_INTERVAL_MS = 60_000;
// A transcode that stops producing output (stuck decoder, hung network share) would hold
// a slot and a connection forever; nothing legitimate pauses output this long.
const IDLE_KILL_MS = 30_000;
let activeTranscodes = 0;
let lastCapLogAt = 0;

export const RAW_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
};

interface FileStat {
  size: number;
  mtimeMs: number;
}

/** Query-string numbers arrive as NaN/Infinity/negative; only a finite positive value is usable. */
function positiveFinite(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

export interface FileValidators {
  etag: string; // weak: derived from size + mtime, not content
  lastModified: string; // HTTP-date
  mtimeSec: number; // mtime floored to whole seconds, the precision HTTP dates carry
}

/** Cache validators for a file on disk; mtime+size is what every static server uses. */
export function fileValidators(st: FileStat): FileValidators {
  const mtimeSec = Math.floor(st.mtimeMs / 1000);
  return {
    etag: `W/"${st.size.toString(16)}-${mtimeSec.toString(16)}"`,
    lastModified: new Date(mtimeSec * 1000).toUTCString(),
    mtimeSec,
  };
}

/** Compare an entity tag ignoring the W/ prefix (weak comparison, RFC 9110 §8.8.3.2). */
function etagMatches(candidate: string, etag: string): boolean {
  const strip = (t: string) => t.trim().replace(/^W\//i, '');
  return strip(candidate) === strip(etag);
}

/** True when the request's If-None-Match / If-Modified-Since say the client's copy is current. */
export function isNotModified(req: Request, v: FileValidators): boolean {
  const inm = req.headers.get('if-none-match');
  if (inm) {
    // If-None-Match wins over If-Modified-Since when both are present (RFC 9110 §13.1.3)
    return inm.trim() === '*' || inm.split(',').some((t) => etagMatches(t, v.etag));
  }
  const ims = req.headers.get('if-modified-since');
  if (ims) {
    const since = Date.parse(ims);
    return Number.isFinite(since) && v.mtimeSec * 1000 <= since;
  }
  return false;
}

/**
 * If-Range: honour the Range only when the client's validator still matches, otherwise
 * send the whole file so a resumed download can't splice two versions together.
 * We only ever hand out our own weak tag, so a literal match against it is the right test.
 */
function ifRangeMatches(ifRange: string, v: FileValidators): boolean {
  const t = ifRange.trim();
  if (t.startsWith('"') || /^W\//i.test(t)) return etagMatches(t, v.etag);
  const at = Date.parse(t);
  return Number.isFinite(at) && v.mtimeSec * 1000 <= at;
}

type ByteRange = { start: number; end: number } | 'unsatisfiable' | null;

/**
 * RFC 9110 §14.1.2 byte ranges. Returns null when the header is absent or not a byte range
 * we understand (serve the full 200), 'unsatisfiable' for a 416, else the inclusive range.
 * Multiple ranges: only the first is served. multipart/byteranges is never needed by audio
 * clients, and a 206 for a subset of the requested ranges is permitted by the spec.
 */
function parseRange(header: string | null, size: number): ByteRange {
  if (!header) return null;
  const m = header.match(/^\s*bytes\s*=\s*(.+)$/i);
  if (!m) return null;
  const spec = m[1].split(',')[0].trim();
  const parts = spec.match(/^(\d*)-(\d*)$/);
  if (!parts || (!parts[1] && !parts[2])) return null;
  if (size === 0) return 'unsatisfiable';
  if (!parts[1]) {
    // suffix range: the last N bytes
    const suffix = Number(parts[2]);
    if (suffix === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(parts[1]);
  const end = parts[2] ? Number(parts[2]) : size - 1;
  if (!Number.isSafeInteger(start) || start >= size || start > end) return 'unsatisfiable';
  return { start, end: Math.min(end, size - 1) };
}

function serveRaw(req: Request, filePath: string, mime: string, st: FileStat): Response {
  const v = fileValidators(st);
  const isHead = req.method === 'HEAD';
  const base: Record<string, string> = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    ETag: v.etag,
    'Last-Modified': v.lastModified,
  };

  const ifRange = req.headers.get('if-range');
  const rangeHeader = ifRange && !ifRangeMatches(ifRange, v) ? null : req.headers.get('range');
  const range = parseRange(rangeHeader, st.size);

  if (range === 'unsatisfiable') {
    return new Response(isHead ? null : 'range not satisfiable', {
      status: 416,
      headers: { ...base, 'Content-Range': `bytes */${st.size}` },
    });
  }
  if (range) {
    const headers = {
      ...base,
      'Content-Length': String(range.end - range.start + 1),
      'Content-Range': `bytes ${range.start}-${range.end}/${st.size}`,
    };
    if (isHead) return new Response(null, { status: 206, headers });
    const stream = fs.createReadStream(filePath, { start: range.start, end: range.end });
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: 206, headers });
  }
  const headers = { ...base, 'Content-Length': String(st.size) };
  if (isHead) return new Response(null, { headers });
  return new Response(Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream, { headers });
}

/** Serve a file verbatim with byte-range, validator and HEAD support; 404 when it is missing. */
export async function rawFile(req: Request, filePath: string, mime: string): Promise<Response> {
  let st: fs.Stats;
  try {
    st = await fs.promises.stat(filePath);
  } catch {
    return new Response('not found', { status: 404 });
  }
  if (!st.isFile()) return new Response('not found', { status: 404 });
  return serveRaw(req, filePath, mime, st);
}

export interface ServeOptions {
  format?: string | null; // mp3 | ogg | opus | aac | raw
  maxBitRate?: number; // kbps; 0 = no limit requested
  download?: boolean; // force the original file
  offset?: number; // seconds to start the transcode at (adaptive quality switches mid-track)
  durationSec?: number; // track length when known: bounds offset and lets a fitting source skip the transcode
}

export async function serveTrack(req: Request, filePath: string, opts: ServeOptions = {}): Promise<Response> {
  const suffix = path.extname(filePath).toLowerCase();
  const mime = RAW_MIME[suffix] ?? 'application/octet-stream';

  let st: fs.Stats;
  try {
    st = await fs.promises.stat(filePath);
  } catch {
    return new Response('not found', { status: 404 });
  }
  if (!st.isFile()) return new Response('not found', { status: 404 });
  const raw = () => serveRaw(req, filePath, mime, st);

  const format = (opts.format ?? '').toLowerCase();
  const maxBitRate = opts.maxBitRate ?? 0;
  const durationSec = positiveFinite(opts.durationSec);
  const sameContainer = !format || format === suffix.slice(1);
  const wantsRaw = opts.download || format === 'raw' || (maxBitRate === 0 && sameContainer);
  if (wantsRaw) return raw();

  // Infinity/NaN would reach ffmpeg as "-ss Infinity"; past the end there is nothing to seek to.
  // Resolved before the raw-file shortcuts below: a client that asked for a transcode starting
  // at `offset` treats whatever comes back as starting there (the web player shifts its clock
  // by it), so a raw file from byte 0 would play from the top while the progress bar reads
  // offset + currentTime. Those shortcuts are therefore only safe when no offset was asked for.
  let offset = positiveFinite(opts.offset);
  if (durationSec > 0) offset = Math.min(offset, durationSec);

  // A bitrate cap is a request to not exceed it, not to re-encode: when the source is already
  // a lossy file in the wanted container and fits the cap (10% slack for container overhead
  // and VBR estimation error), re-encoding would only burn CPU and lose quality.
  if (offset === 0 && maxBitRate > 0 && sameContainer && !LOSSLESS.has(suffix) && durationSec > 0) {
    const sourceKbps = (st.size * 8) / durationSec / 1000;
    if (sourceKbps <= maxBitRate * 1.1) return raw();
  }

  if (activeTranscodes >= TRANSCODE_MAX_ACTIVE) {
    const now = Date.now();
    if (now - lastCapLogAt > CAP_LOG_INTERVAL_MS) {
      lastCapLogAt = now;
      console.warn(`[stream] ${activeTranscodes} transcodes active (cap ${TRANSCODE_MAX_ACTIVE}); serving raw files`);
    }
    if (offset === 0) return raw();
    // A mid-track resume can't be served raw (see above) and must not add to the overload;
    // tell the client to try again shortly, when a slot has likely freed up.
    return new Response('transcoder busy', {
      status: 503,
      headers: { 'Retry-After': '5', 'Cache-Control': 'no-store' },
    });
  }

  // transcode via ffmpeg; falls back to the raw file if ffmpeg isn't available
  const fmt = ['mp3', 'ogg', 'opus', 'aac'].includes(format) ? format : 'mp3';
  const br = Math.min(Math.max(maxBitRate || 192, 32), 320);
  // -ss before -i seeks by keyframe/packet before decoding: near-instant, and the pipe
  // then starts at the requested second so a quality switch resumes instead of restarting
  const args = ['-v', 'error'];
  if (offset > 0) args.push('-ss', offset.toFixed(3));
  args.push('-i', filePath, '-map', '0:a:0', '-vn');
  if (fmt === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', `${br}k`, '-f', 'mp3');
  else if (fmt === 'opus') args.push('-c:a', 'libopus', '-b:a', `${br}k`, '-f', 'ogg');
  else if (fmt === 'ogg') args.push('-c:a', 'libvorbis', '-b:a', `${br}k`, '-f', 'ogg');
  else args.push('-c:a', 'aac', '-b:a', `${br}k`, '-f', 'adts');
  args.push('pipe:1');

  const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const spawned = await new Promise<boolean>((resolve) => {
    proc.once('error', () => resolve(false));
    proc.once('spawn', () => resolve(true));
  });
  if (!spawned) return raw();
  // a late error (e.g. a failed kill) must not become an uncaught exception
  proc.on('error', (err) => console.warn(`[stream] ffmpeg error for ${filePath}: ${err.message}`));

  activeTranscodes++;
  let released = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const release = () => {
    if (released) return;
    released = true;
    activeTranscodes--;
    clearTimeout(idleTimer);
  };
  const kill = (why: string) => {
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    console.warn(`[stream] killing ffmpeg for ${filePath}: ${why}`);
    proc.kill('SIGKILL');
  };

  // An ffmpeg that dies partway through reads to the browser as a clean end of stream:
  // the song just stops early, with nothing in the log to say why. Keep its complaint.
  // The data listener also keeps stderr drained so a chatty ffmpeg can't block on a full pipe.
  let stderr = '';
  proc.stderr?.on('data', (d: Buffer) => {
    if (stderr.length < 2000) stderr += d.toString();
  });
  proc.once('close', (code, signal) => {
    release();
    if (code && signal !== 'SIGKILL')
      console.warn(`[stream] ffmpeg exited ${code} transcoding ${filePath}${stderr ? `: ${stderr.trim()}` : ''}`);
  });

  // Idle watchdog. Readable.toWeb pauses stdout when the client stops reading (a full media
  // buffer), and a paused pipe is the consumer's doing, not a stalled encoder: only a pipe
  // that is flowing yet silent counts as stuck.
  const armWatchdog = () => {
    clearTimeout(idleTimer);
    if (released) return;
    idleTimer = setTimeout(() => {
      if (proc.stdout.readableFlowing === false) armWatchdog();
      else kill(`no output for ${IDLE_KILL_MS / 1000}s`);
    }, IDLE_KILL_MS);
  };
  proc.stdout.on('data', armWatchdog);
  armWatchdog();

  req.signal.addEventListener('abort', () => kill('request aborted'));
  // Cancelling the web stream destroys stdout without ending it; a natural EOF ends it first.
  proc.stdout.once('close', () => {
    if (!proc.stdout.readableEnded) kill('response stream cancelled');
  });

  const outMime = fmt === 'mp3' ? 'audio/mpeg' : fmt === 'aac' ? 'audio/aac' : 'audio/ogg';
  return new Response(Readable.toWeb(proc.stdout) as ReadableStream, {
    // say plainly that this one is not range-resumable, so a client doesn't drop the
    // connection expecting to range-request its way back into a stream that has no ranges
    headers: { 'Content-Type': outMime, 'Cache-Control': 'no-store', 'Accept-Ranges': 'none' },
  });
}
