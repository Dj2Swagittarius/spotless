import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ids = (
    getDb().prepare('SELECT artist_id FROM collections WHERE user_id = ?').all(userIdFrom(req)) as { artist_id: number }[]
  ).map((r) => r.artist_id);
  return NextResponse.json(ids);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const artistId = Number(body.artistId);
  if (!Number.isInteger(artistId)) return NextResponse.json({ error: 'artistId required' }, { status: 400 });
  getDb().prepare('INSERT OR IGNORE INTO collections (user_id, artist_id) VALUES (?, ?)').run(userIdFrom(req), artistId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const artistId = Number(req.nextUrl.searchParams.get('artistId'));
  if (!Number.isInteger(artistId)) return NextResponse.json({ error: 'artistId required' }, { status: 400 });
  getDb().prepare('DELETE FROM collections WHERE user_id = ? AND artist_id = ?').run(userIdFrom(req), artistId);
  return NextResponse.json({ ok: true });
}
