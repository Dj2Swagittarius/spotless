import { NextRequest, NextResponse } from 'next/server';
import { scanLibrary } from '@/lib/scanner';

export const dynamic = 'force-dynamic';

// Debounce rescans: Lidarr can fire several import events in a burst (multi-disc,
// multi-track). Coalesce them into a single scan a few seconds after the last event
// so a flood of webhook calls can't stack up concurrent scans (DoS).
let scanTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleScan() {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    scanTimer = null;
    scanLibrary().catch((err) => console.error('webhook scan failed:', err));
  }, 8000);
}

// Lidarr Connect → Webhook target. On import events, rescan the library so
// new downloads show up in Spotless automatically.
export async function POST(req: NextRequest) {
  // Optional shared secret: if LIDARR_WEBHOOK_SECRET is set, require it as ?token=.
  // Unset (default) keeps the open LAN behavior. Set it before any non-LAN exposure.
  const secret = process.env.LIDARR_WEBHOOK_SECRET;
  if (secret && req.nextUrl.searchParams.get('token') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const eventType = body.eventType ?? 'unknown';

  if (eventType === 'Download' || eventType === 'AlbumImport' || eventType === 'Test') {
    if (eventType !== 'Test') {
      console.log(`lidarr webhook: ${eventType} — ${body.artist?.name ?? '?'} / ${body.album?.title ?? '?'} — rescan queued`);
      scheduleScan();
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true, ignored: eventType });
}
