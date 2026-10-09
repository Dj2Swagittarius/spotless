import fs from 'fs';
import path from 'path';
import { artDir } from '@/lib/db';
import { imageContentType } from '@/lib/art';
import { fileValidators, isNotModified } from '@/lib/streaming';

export const dynamic = 'force-dynamic';

const COLORS = [
  ['#1db954', '#191414'],
  ['#e91429', '#1e1e1e'],
  ['#8d67ab', '#1e1e1e'],
  ['#1e3264', '#27856a'],
  ['#ba5d07', '#191414'],
  ['#e8115b', '#191414'],
  ['#148a08', '#1e1e1e'],
  ['#503750', '#1e1e1e'],
];

function placeholder(id: number): Response {
  const [c1, c2] = COLORS[id % COLORS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
  </linearGradient></defs>
  <rect width="300" height="300" fill="url(#g)"/>
  <g fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="10">
    <circle cx="150" cy="150" r="62"/>
  </g>
  <circle cx="150" cy="150" r="14" fill="rgba(255,255,255,0.55)"/>
</svg>`;
  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ albumId: string }> }) {
  const { albumId } = await params;
  const id = Number(albumId);
  if (!Number.isInteger(id)) return placeholder(0);
  const file = path.join(artDir(), `${id}.img`);
  const st = await fs.promises.stat(file).catch(() => null);
  if (!st?.isFile()) return placeholder(id);

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
  if (!buf) return placeholder(id);
  // stored bytes are only ever served under a sniffed raster type, never text/html or svg
  const contentType = imageContentType(buf);
  if (!contentType) return placeholder(id);
  return new Response(new Uint8Array(buf), {
    headers: { ...headers, 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' },
  });
}
