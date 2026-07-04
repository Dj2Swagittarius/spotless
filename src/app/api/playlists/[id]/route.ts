import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getPlaylist } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pl = getPlaylist(Number(id));
  if (!pl) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(pl);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  getDb()
    .prepare('UPDATE playlists SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?')
    .run(body.name ?? null, body.description ?? null, Number(id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  getDb().prepare('DELETE FROM playlists WHERE id = ?').run(Number(id));
  return NextResponse.json({ ok: true });
}
