import { NextRequest, NextResponse } from 'next/server';
import { lastfmApiKey } from '@/lib/lastfm';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const apiKey = lastfmApiKey();
  if (!apiKey) return NextResponse.json({ error: 'Last.fm API key not configured' }, { status: 400 });
  // callback follows whatever host the browser used, so LAN IPs work (no pinned redirect URI like Spotify)
  const cb = `http://${req.headers.get('host')}/api/lastfm/callback`;
  return NextResponse.redirect(`https://www.last.fm/api/auth/?api_key=${apiKey}&cb=${encodeURIComponent(cb)}`);
}
