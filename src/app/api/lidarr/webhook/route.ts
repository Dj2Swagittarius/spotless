import { NextRequest, NextResponse } from 'next/server';
import { scanLibrary } from '@/lib/scanner';

export const dynamic = 'force-dynamic';

// Lidarr Connect → Webhook target. On import events, rescan the library so
// new downloads show up in Spotless automatically.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const eventType = body.eventType ?? 'unknown';

  if (eventType === 'Download' || eventType === 'AlbumImport' || eventType === 'Test') {
    if (eventType !== 'Test') {
      console.log(`lidarr webhook: ${eventType} — ${body.artist?.name ?? '?'} / ${body.album?.title ?? '?'} — rescanning`);
      scanLibrary().catch((err) => console.error('webhook scan failed:', err));
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true, ignored: eventType });
}
