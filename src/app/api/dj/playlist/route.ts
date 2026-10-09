import { NextRequest, NextResponse } from 'next/server';
import { currentUserFrom } from '@/lib/user';
import { PLAYLIST_DESCRIPTION_MAX, PLAYLIST_NAME_MAX, textField } from '@/lib/data';
import { createPlaylist, type WantedSong } from '@/lib/dj/dj';
import { tracksByIds } from '@/lib/dj/library';

export const dynamic = 'force-dynamic';

const MAX_TRACKS = 100;
const MAX_MISSING = 50;

const song = (v: unknown): WantedSong | null => {
  const o = v as { title?: unknown; artist?: unknown } | null;
  return o && typeof o.title === 'string' && typeof o.artist === 'string' && o.title.trim() && o.artist.trim()
    ? { title: o.title.trim().slice(0, 200), artist: o.artist.trim().slice(0, 200) }
    : null;
};

// body { name, description?, trackIds: number[], missing?: {title, artist}[] } → { id, name, added, missing }
// The DJ only ever proposes a playlist; this call is the listener's explicit "save it".
export async function POST(req: NextRequest) {
  const user = currentUserFrom(req);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const name = textField(body.name, PLAYLIST_NAME_MAX);
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const description = textField(body.description, PLAYLIST_DESCRIPTION_MAX) ?? '';
  const ids = [...new Set((Array.isArray(body.trackIds) ? body.trackIds : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, MAX_TRACKS);
  // only ids the library still has: it may have been rescanned since the proposal was shown
  const existing = tracksByIds(ids).map((t) => t.id);
  const missing = (Array.isArray(body.missing) ? body.missing : []).map(song).filter((s): s is WantedSong => s !== null).slice(0, MAX_MISSING);
  if (!existing.length && !missing.length) return NextResponse.json({ error: 'no songs to add' }, { status: 400 });
  return NextResponse.json(createPlaylist(user.id, name, description, existing, missing), { status: 201 });
}
