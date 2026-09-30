import { NextRequest, NextResponse } from 'next/server';
import { resolveLyrics } from '@/lib/lyrics';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> }
) {
  const { trackId } = await params;
  const id = Number(trackId);

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  const lyrics = await resolveLyrics(id);

  if (!lyrics) {
    return NextResponse.json({ error: 'track not found' }, { status: 404 });
  }

  // Preserve the existing Spotless frontend API shape.
  return NextResponse.json({
    synced: lyrics.rawSynced,
    plain: lyrics.plain,
  });
}