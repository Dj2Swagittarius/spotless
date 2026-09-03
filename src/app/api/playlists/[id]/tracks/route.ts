import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { nextPosition } from '@/lib/playlistMatch';

export const dynamic = 'force-dynamic';

// body { trackId } or { trackIds: number[] } — appends, duplicates ignored
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const ids: number[] = (Array.isArray(body.trackIds) ? body.trackIds : [body.trackId])
    .map(Number)
    .filter((n: number) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return NextResponse.json({ error: 'trackId required' }, { status: 400 });
  const db = getDb();
  const playlistId = Number(id);
  const add = db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)');
  let added = 0;
  db.transaction(() => {
    let pos = nextPosition(db, playlistId);
    for (const trackId of ids) added += add.run(playlistId, trackId, pos++).changes;
  })();
  return NextResponse.json({ ok: true, added });
}

// full reorder: body { items: ('t:<trackId>' | 'p:<placeholderId>')[] } — legacy { order: trackId[] } still accepted
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const items: string[] = Array.isArray(body.items)
    ? body.items.map(String)
    : Array.isArray(body.order)
      ? body.order.map((n: unknown) => `t:${Number(n)}`)
      : [];
  if (!items.length) return NextResponse.json({ error: 'items required' }, { status: 400 });
  const db = getDb();
  const playlistId = Number(id);
  const setTrack = db.prepare('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?');
  const setPlaceholder = db.prepare('UPDATE playlist_placeholders SET position = ? WHERE playlist_id = ? AND id = ?');
  db.transaction(() => {
    items.forEach((item, i) => {
      const [kind, raw] = item.split(':');
      const n = Number(raw);
      if (!Number.isInteger(n)) return;
      if (kind === 't') setTrack.run(i + 1, playlistId, n);
      else if (kind === 'p') setPlaceholder.run(i + 1, playlistId, n);
    });
  })();
  return NextResponse.json({ ok: true });
}

// ?trackId=  removes a song; ?placeholderId=  removes a missing-song placeholder
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trackId = Number(req.nextUrl.searchParams.get('trackId'));
  const placeholderId = Number(req.nextUrl.searchParams.get('placeholderId'));
  if (placeholderId) {
    getDb().prepare('DELETE FROM playlist_placeholders WHERE playlist_id = ? AND id = ?').run(Number(id), placeholderId);
    return NextResponse.json({ ok: true });
  }
  if (!trackId) return NextResponse.json({ error: 'trackId or placeholderId required' }, { status: 400 });
  getDb().prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(Number(id), trackId);
  return NextResponse.json({ ok: true });
}
