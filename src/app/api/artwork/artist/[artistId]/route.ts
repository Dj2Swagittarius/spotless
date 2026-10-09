import fs from 'fs';
import { NextRequest } from 'next/server';
import { artistArtPath, imageContentType } from '@/lib/art';
import { fileValidators, isNotModified } from '@/lib/streaming';

export const dynamic = 'force-dynamic';

/** The initial comes straight from the query string, so it must not be able to close the <text>. */
function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

function placeholder(letter: string): Response {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#2a2a2a"/><stop offset="100%" stop-color="#121212"/>
  </linearGradient></defs>
  <rect width="300" height="300" fill="url(#g)"/>
  <text x="150" y="150" font-family="sans-serif" font-size="120" font-weight="bold"
        fill="rgba(255,255,255,0.35)" text-anchor="middle" dominant-baseline="central">${escapeXml(letter)}</text>
</svg>`;
  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ artistId: string }> }) {
  const { artistId } = await params;
  const id = Number(artistId);
  // first code point, not first UTF-16 unit: half an emoji is not valid XML
  const letter = (Array.from(req.nextUrl.searchParams.get('l') || '♪')[0] ?? '♪').toUpperCase();
  if (!Number.isInteger(id)) return placeholder(letter);
  const file = artistArtPath(id);
  const st = await fs.promises.stat(file).catch(() => null);
  if (!st?.isFile()) return placeholder(letter);

  const v = fileValidators(st);
  const headers = {
    'Cache-Control': 'public, max-age=86400',
    ETag: v.etag,
    'Last-Modified': v.lastModified,
  };
  if (isNotModified(req, v)) return new Response(null, { status: 304, headers });

  // The scanner may unlink or atomically replace the file between the stat and this read
  // (orphan cleanup, rm+rename rewrite); a vanished file is a placeholder, not a 500.
  const buf = await fs.promises.readFile(file).catch(() => null);
  if (!buf) return placeholder(letter);
  // stored bytes are only ever served under a sniffed raster type, never text/html or svg
  const contentType = imageContentType(buf);
  if (!contentType) return placeholder(letter);
  return new Response(new Uint8Array(buf), {
    headers: { ...headers, 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' },
  });
}
