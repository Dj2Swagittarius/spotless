import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getPlaylist, ownedPlaylistId, textField, PLAYLIST_NAME_MAX, PLAYLIST_DESCRIPTION_MAX } from '@/lib/data';
import { userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playlistId = ownedPlaylistId(req, id);
  if (playlistId === null) return notFound();
  const pl = getPlaylist(playlistId, userIdFrom(req));
  if (!pl) return notFound();
  return NextResponse.json(pl);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playlistId = ownedPlaylistId(req, id);
  if (playlistId === null) return notFound();
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  // null keeps the current value (COALESCE below); a name that is provided must be non-empty
  const name = body.name == null ? null : textField(body.name, PLAYLIST_NAME_MAX);
  if (body.name != null && !name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const description = typeof body.description === 'string' ? textField(body.description, PLAYLIST_DESCRIPTION_MAX) : null;
  getDb()
    .prepare(
      'UPDATE playlists SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ? AND user_id = ?'
    )
    .run(name, description, playlistId, userIdFrom(req));
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playlistId = ownedPlaylistId(req, id);
  if (playlistId === null) return notFound();
  const db = getDb();
  // foreign_keys is ON (db.ts) so ON DELETE CASCADE would handle the children; the explicit
  // deletes keep the clean-up visible and correct even if that pragma is ever changed
  db.transaction(() => {
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlistId);
    db.prepare('DELETE FROM playlist_placeholders WHERE playlist_id = ?').run(playlistId);
    db.prepare('DELETE FROM playlists WHERE id = ? AND user_id = ?').run(playlistId, userIdFrom(req));
  })();
  return NextResponse.json({ ok: true });
}
