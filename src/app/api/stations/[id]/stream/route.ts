import { NextRequest } from 'next/server';
import { getStation, validStreamUrl } from '@/lib/stations';

export const dynamic = 'force-dynamic';

/**
 * Same-origin proxy for internet radio streams. Needed because the web player's
 * equalizer routes audio through Web Audio, and a cross-origin <audio> source
 * without CORS headers (most icecast/shoutcast servers) would play silence.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const station = getStation(Number(id));
  if (!station || !validStreamUrl(station.streamUrl)) return new Response('station not found', { status: 404 });

  // connect timeout only: cleared once headers arrive so the live body can stream forever
  const ac = new AbortController();
  const connectTimer = setTimeout(() => ac.abort(), 15000);
  let upstream: Response;
  try {
    upstream = await fetch(station.streamUrl, {
      headers: { 'User-Agent': 'Spotless/1.0', Accept: '*/*' },
      redirect: 'follow',
      signal: ac.signal,
    });
  } catch {
    return new Response('stream unreachable', { status: 502 });
  } finally {
    clearTimeout(connectTimer);
  }
  if (!upstream.ok || !upstream.body) return new Response('stream unreachable', { status: 502 });

  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  });
}
