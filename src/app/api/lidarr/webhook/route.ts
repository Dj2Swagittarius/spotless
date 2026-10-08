import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { scanLibrary } from '@/lib/scanner';

export const dynamic = 'force-dynamic';

// Debounce rescans: Lidarr can fire several import events in a burst (multi-disc,
// multi-track). Coalesce them into a single scan a few seconds after the last event
// so a flood of webhook calls can't stack up concurrent scans (DoS). The deferral is
// capped from the first queued event, so a steady stream of POSTs can't push the
// rescan back indefinitely.
const DEBOUNCE_MS = 8000;
const MAX_DEFER_MS = 60_000;
let scanTimer: ReturnType<typeof setTimeout> | null = null;
let firstQueuedAt: number | null = null;

function scheduleScan() {
  const now = Date.now();
  if (firstQueuedAt === null) firstQueuedAt = now;
  const delay = Math.max(0, Math.min(DEBOUNCE_MS, firstQueuedAt + MAX_DEFER_MS - now));
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    scanTimer = null;
    firstQueuedAt = null;
    scanLibrary().catch((err) => console.error('webhook scan failed:', err));
  }, delay);
}

function tokenMatches(presented: string | null, secret: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  // Constant-time compare so response timing can't be used to guess the secret byte by byte.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Lidarr Connect → Webhook target. On import events, rescan the library so
// new downloads show up in Spotless automatically.
export async function POST(req: NextRequest) {
  // Optional shared secret: if LIDARR_WEBHOOK_SECRET is set, require it as an
  // X-Webhook-Token header or ?token= query parameter. Unset (default) keeps the
  // open LAN behavior. Set it before any non-LAN exposure.
  const secret = process.env.LIDARR_WEBHOOK_SECRET;
  if (secret) {
    const presented = req.headers.get('x-webhook-token') ?? req.nextUrl.searchParams.get('token');
    if (!tokenMatches(presented, secret)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => null);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'JSON object body required' }, { status: 400 });
  }
  const event = body as { eventType?: unknown; artist?: { name?: unknown }; album?: { title?: unknown } };
  const eventType = typeof event.eventType === 'string' ? event.eventType : 'unknown';

  if (eventType === 'Download' || eventType === 'AlbumImport' || eventType === 'Test') {
    if (eventType !== 'Test') {
      const artist = typeof event.artist?.name === 'string' ? event.artist.name : '?';
      const album = typeof event.album?.title === 'string' ? event.album.title : '?';
      console.log(`lidarr webhook: ${eventType} — ${artist} / ${album} — rescan queued`);
      scheduleScan();
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true, ignored: eventType });
}
