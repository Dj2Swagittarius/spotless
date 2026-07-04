import { NextRequest, NextResponse } from 'next/server';
import { spotifyStatus, importTaste, disconnect, hasSpotifyClient } from '@/lib/spotify';
import { userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return NextResponse.json({ ...spotifyStatus(userIdFrom(req)), clientConfigured: hasSpotifyClient });
}

// re-import taste data using stored tokens
export async function POST(req: NextRequest) {
  try {
    const taste = await importTaste(userIdFrom(req));
    return NextResponse.json({ ok: true, topCount: taste.topArtists.length, savedCount: taste.savedArtists.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  disconnect(userIdFrom(req));
  return NextResponse.json({ ok: true });
}
