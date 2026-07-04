import { NextRequest, NextResponse } from 'next/server';
import { dislikeArtist } from '@/lib/discover';
import { getDb, delSetting } from '@/lib/db';
import { userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const rows = getDb().prepare('SELECT name, disliked_at FROM discover_dislikes WHERE user_id = ? ORDER BY disliked_at DESC').all(userIdFrom(req));
  return NextResponse.json(rows);
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const artist = String(body.artist ?? '').trim();
  if (!artist) return NextResponse.json({ error: 'artist required' }, { status: 400 });
  const uid = userIdFrom(req);
  getDb().prepare('DELETE FROM discover_dislikes WHERE user_id = ? AND name = ?').run(uid, artist);
  delSetting(`discover_cache:${uid}`); // let them reappear on next rebuild
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const artist = String(body.artist ?? '').trim();
  if (!artist) return NextResponse.json({ error: 'artist required' }, { status: 400 });
  dislikeArtist(userIdFrom(req), artist);
  return NextResponse.json({ ok: true });
}
