import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { Readable } from 'stream';

/**
 * Shared audio delivery for the web player (/api/stream) and the Subsonic API (/rest/stream):
 * raw file with byte-range support, or an ffmpeg transcode when a format/bitrate is requested.
 * Transcoded output is a live pipe (no ranges) — same tradeoff every Subsonic server makes.
 */

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

export const RAW_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
};

export function rawFile(req: Request, filePath: string, mime: string): Response {
  const size = fs.statSync(filePath).size;
  const range = req.headers.get('range');
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    if (isNaN(start) || start >= size) start = 0;
    if (isNaN(end) || end >= size) end = size - 1;
    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
    });
  }
  const stream = fs.createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      'Content-Type': mime,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    },
  });
}

export interface ServeOptions {
  format?: string | null; // mp3 | ogg | opus | aac | raw
  maxBitRate?: number; // kbps; 0 = no limit requested
  download?: boolean; // force the original file
}

export async function serveTrack(req: Request, filePath: string, opts: ServeOptions = {}): Promise<Response> {
  const suffix = path.extname(filePath).toLowerCase();
  const raw = () => rawFile(req, filePath, RAW_MIME[suffix] ?? 'application/octet-stream');

  const format = (opts.format ?? '').toLowerCase();
  const maxBitRate = opts.maxBitRate ?? 0;
  const wantsRaw =
    opts.download || format === 'raw' || (maxBitRate === 0 && (!format || format === suffix.slice(1)));
  if (wantsRaw) return raw();

  // transcode via ffmpeg; falls back to the raw file if ffmpeg isn't available
  const fmt = ['mp3', 'ogg', 'opus', 'aac'].includes(format) ? format : 'mp3';
  const br = Math.min(Math.max(maxBitRate || 192, 32), 320);
  const args = ['-v', 'error', '-i', filePath, '-map', '0:a:0', '-vn'];
  if (fmt === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', `${br}k`, '-f', 'mp3');
  else if (fmt === 'opus') args.push('-c:a', 'libopus', '-b:a', `${br}k`, '-f', 'ogg');
  else if (fmt === 'ogg') args.push('-c:a', 'libvorbis', '-b:a', `${br}k`, '-f', 'ogg');
  else args.push('-c:a', 'aac', '-b:a', `${br}k`, '-f', 'adts');
  args.push('pipe:1');

  const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'ignore'] });
  const spawned = await new Promise<boolean>((resolve) => {
    proc.once('error', () => resolve(false));
    proc.once('spawn', () => resolve(true));
  });
  if (!spawned) return raw();
  req.signal.addEventListener('abort', () => proc.kill('SIGKILL'));
  const mime = fmt === 'mp3' ? 'audio/mpeg' : fmt === 'aac' ? 'audio/aac' : 'audio/ogg';
  return new Response(Readable.toWeb(proc.stdout) as ReadableStream, {
    headers: { 'Content-Type': mime, 'Cache-Control': 'no-store' },
  });
}
