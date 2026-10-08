import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ownedPlaylistId } from '@/lib/data';
import { resolvePlaceholders } from '@/lib/playlistMatch';

export const dynamic = 'force-dynamic';

// Re-check this playlist's placeholders against the library (e.g. after a download landed).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playlistId = ownedPlaylistId(req, id);
  if (playlistId === null) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const resolved = resolvePlaceholders(getDb(), playlistId);
  return NextResponse.json({ ok: true, resolved });
}
