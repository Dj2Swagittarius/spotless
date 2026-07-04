import fs from 'fs';
import { NextRequest } from 'next/server';
import { artistArtPath } from '@/lib/art';

export const dynamic = 'force-dynamic';

function placeholder(letter: string): Response {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#2a2a2a"/><stop offset="100%" stop-color="#121212"/>
  </linearGradient></defs>
  <rect width="300" height="300" fill="url(#g)"/>
  <text x="150" y="150" font-family="sans-serif" font-size="120" font-weight="bold"
        fill="rgba(255,255,255,0.35)" text-anchor="middle" dominant-baseline="central">${letter}</text>
</svg>`;
  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ artistId: string }> }) {
  const { artistId } = await params;
  const id = Number(artistId);
  const letter = (req.nextUrl.searchParams.get('l') || '♪').slice(0, 1).toUpperCase();
  if (!Number.isInteger(id)) return placeholder(letter);
  const file = artistArtPath(id);
  if (!fs.existsSync(file)) return placeholder(letter);
  const buf = fs.readFileSync(file);
  const isPng = buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50;
  return new Response(new Uint8Array(buf), {
    headers: { 'Content-Type': isPng ? 'image/png' : 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
  });
}
