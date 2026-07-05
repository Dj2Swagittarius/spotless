import fs from 'fs';
import { getDb } from '@/lib/db';
import { serveTrack } from '@/lib/streaming';

export const dynamic = 'force-dynamic';

// Serves the web/PWA player. No params = raw file (byte-range, unchanged default);
// ?format=&maxBitRate= triggers an ffmpeg transcode via the shared streaming helper.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getDb().prepare('SELECT path FROM tracks WHERE id = ?').get(Number(id)) as { path: string } | undefined;
  if (!row || !fs.existsSync(row.path)) {
    return new Response('not found', { status: 404 });
  }
  const url = new URL(req.url);
  return serveTrack(req, row.path, {
    format: url.searchParams.get('format'),
    maxBitRate: Number(url.searchParams.get('maxBitRate')) || 0,
  });
}
