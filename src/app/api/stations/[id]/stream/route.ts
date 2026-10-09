import { NextRequest } from 'next/server';
import { getStation, streamUrlError, assertPublicStreamUrl } from '@/lib/stations';
import { USER_AGENT } from '@/lib/version';

export const dynamic = 'force-dynamic';

// Only genuinely audio-ish upstream types are relayed; anything else (text/html from a captive
// portal, an error page) is relabelled so the browser can never render it as a document.
const SAFE_UPSTREAM_TYPE = /^(audio\/|application\/ogg|application\/octet-stream)/i;

// Redirects are walked by hand so that every hop goes through the same literal + DNS checks as
// the stored URL. fetch's own 'follow' validates nothing, so a public host answering 302 to
// http://127.0.0.1:... or a LAN address would have its body relayed, which is exactly what the
// private-address block exists to prevent. Five hops is what browsers and curl allow by default.
const MAX_REDIRECTS = 5;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
// one budget for the whole chain, cleared once the final headers arrive so the live body can
// stream forever
const CONNECT_TIMEOUT_MS = 15000;

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

  const refuse = (reason: string) => {
    console.warn(`[stations] refusing to relay station ${station.id} (${station.name}): ${reason}`);
    ac.abort();
    return new Response(reason, { status: 502 });
  };

  const connectTimer = setTimeout(() => ac.abort(), CONNECT_TIMEOUT_MS);
  let url = station.streamUrl;
  let upstream: Response;
  try {
    for (let hop = 0; ; hop++) {
      // Re-resolve right before connecting: the record may have changed since the station was
      // saved (DNS rebinding), and this is the last point before the LAN becomes reachable. The
      // lookup is not pinned into fetch's own connect, so a 0-TTL flip between here and there
      // still gets by. On a redirect hop this is also the first time the target is seen at all.
      try {
        await assertPublicStreamUrl(url);
      } catch (err) {
        return refuse(hop === 0 ? (err as Error).message : `redirect to ${url}: ${(err as Error).message}`);
      }
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
          redirect: 'manual',
          signal: ac.signal,
        });
      } catch {
        return new Response('stream unreachable', { status: 502 });
      }
      if (!REDIRECT_STATUS.has(res.status)) {
        upstream = res;
        break;
      }
      // a redirect's body is of no use; drop it so the socket is released before the next hop
      await res.body?.cancel().catch(() => {});
      const location = res.headers.get('location');
      if (!location) return refuse(`redirect (${res.status}) without a Location header`);
      if (hop >= MAX_REDIRECTS) return refuse(`more than ${MAX_REDIRECTS} redirects`);
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        return refuse(`redirect to an invalid URL: ${location}`);
      }
      url = next.href;
    }
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
