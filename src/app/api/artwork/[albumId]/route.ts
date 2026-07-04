import fs from 'fs';
import path from 'path';
import { artDir } from '@/lib/db';

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

export async function GET(_req: Request, { params }: { params: Promise<{ albumId: string }> }) {
  const { albumId } = await params;
  const id = Number(albumId);
  const file = path.join(artDir(), `${id}.img`);
  if (!Number.isInteger(id) || !fs.existsSync(file)) return placeholder(Number.isInteger(id) ? id : 0);
  const buf = fs.readFileSync(file);
  // sniff jpeg/png
  const isPng = buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50;
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': isPng ? 'image/png' : 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
