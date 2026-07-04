import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const trackId = Number(body.trackId);
  if (!trackId) return NextResponse.json({ error: 'trackId required' }, { status: 400 });
  const db = getDb();
  const max = db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM playlist_tracks WHERE playlist_id = ?').get(Number(id)) as { m: number };
  db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)').run(Number(id), trackId, max.m + 1);
  return NextResponse.json({ ok: true });
}

// full reorder: body { order: trackId[] }
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const order = Array.isArray(body.order) ? body.order.map(Number).filter(Number.isInteger) : null;
  if (!order?.length) return NextResponse.json({ error: 'order required' }, { status: 400 });
  const db = getDb();
  const set = db.prepare('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?');
  db.transaction(() => {
    order.forEach((trackId: number, i: number) => set.run(i + 1, Number(id), trackId));
  })();
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trackId = Number(req.nextUrl.searchParams.get('trackId'));
  if (!trackId) return NextResponse.json({ error: 'trackId required' }, { status: 400 });
  getDb().prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(Number(id), trackId);
  return NextResponse.json({ ok: true });
}
