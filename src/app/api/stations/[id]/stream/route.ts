import { NextRequest } from 'next/server';
import { getStation, streamUrlError, assertPublicStreamUrl } from '@/lib/stations';

export const dynamic = 'force-dynamic';

// Only genuinely audio-ish upstream types are relayed; anything else (text/html from a captive
// portal, an error page) is relabelled so the browser can never render it as a document.
const SAFE_UPSTREAM_TYPE = /^(audio\/|application\/ogg|application\/octet-stream)/i;

/**
 * Same-origin proxy for internet radio streams. Needed because the web player's
 * equalizer routes audio through Web Audio, and a cross-origin <audio> source
 * without CORS headers (most icecast/shoutcast servers) would play silence.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const station = getStation(Number(id));
  if (!station) return new Response('station not found', { status: 404 });
  // A station saved before the private-address block (or with the opt-in since removed) is
  // refused rather than relayed; say so in the log and the status, not as a phantom 404.
  const urlError = streamUrlError(station.streamUrl);
  if (urlError) {
    console.warn(`[stations] refusing to relay station ${station.id} (${station.name}): ${urlError}`);
    return new Response(urlError, { status: 403 });
  }

  // One controller for the whole relay: the client going away must tear down the upstream
  // socket too, otherwise every skipped station keeps pulling a live stream in the background.
  const ac = new AbortController();
  if (req.signal.aborted) ac.abort();
  else req.signal.addEventListener('abort', () => ac.abort(), { once: true });

  // Re-resolve right before connecting: the record may have changed since the station was saved
  // (DNS rebinding), and this is the last point before the LAN becomes reachable. The lookup is
  // not pinned into fetch's own connect, so a 0-TTL flip between here and there still gets by.
  try {
    await assertPublicStreamUrl(station.streamUrl);
  } catch (err) {
    const reason = (err as Error).message;
    console.warn(`[stations] refusing to relay station ${station.id} (${station.name}): ${reason}`);
    return new Response(reason, { status: 502 });
  }

  // connect timeout only: cleared once headers arrive so the live body can stream forever
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
  if (!upstream.ok || !upstream.body) {
    ac.abort();
    return new Response('stream unreachable', { status: 502 });
  }

  const upstreamType = upstream.headers.get('content-type') ?? '';
  return new Response(upstream.body, {
    headers: {
      'Content-Type': SAFE_UPSTREAM_TYPE.test(upstreamType) ? upstreamType : 'audio/mpeg',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}
