import fs from 'fs';
import { getDb } from '@/lib/db';
import { serveTrack } from '@/lib/streaming';

export const dynamic = 'force-dynamic';

// Serves the web/PWA player. No params = raw file (byte-range, unchanged default);
// ?format=&maxBitRate= triggers an ffmpeg transcode via the shared streaming helper;
// ?offset= starts that transcode partway into the track (adaptive quality switches).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getDb()
    .prepare('SELECT path, duration FROM tracks WHERE id = ?')
    .get(Number(id)) as { path: string; duration: number } | undefined;
  if (!row) return new Response('not found', { status: 404 });
  // async stat: a missing file on a slow network share must not block the event loop
  const st = await fs.promises.stat(row.path).catch(() => null);
  if (!st?.isFile()) return new Response('not found', { status: 404 });

  const url = new URL(req.url);
  const offset = Number(url.searchParams.get('offset'));
  return serveTrack(req, row.path, {
    format: url.searchParams.get('format'),
    maxBitRate: Number(url.searchParams.get('maxBitRate')) || 0,
    // serveTrack also validates, but refuse the obvious junk (Infinity, NaN, negatives) here
    offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
    durationSec: Number(row.duration) || 0,
  });
}
