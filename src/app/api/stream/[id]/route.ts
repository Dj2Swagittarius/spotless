import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
};

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getDb().prepare('SELECT path FROM tracks WHERE id = ?').get(Number(id)) as { path: string } | undefined;
  if (!row || !fs.existsSync(row.path)) {
    return new Response('not found', { status: 404 });
  }

  const stat = fs.statSync(row.path);
  const size = stat.size;
  const mime = MIME[path.extname(row.path).toLowerCase()] ?? 'application/octet-stream';
  const range = req.headers.get('range');

  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    if (isNaN(start) || start >= size) start = 0;
    if (isNaN(end) || end >= size) end = size - 1;

    const stream = fs.createReadStream(row.path, { start, end });
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

  const stream = fs.createReadStream(row.path);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    },
  });
}
