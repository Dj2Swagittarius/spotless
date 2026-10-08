import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getPlaylists, textField, PLAYLIST_NAME_MAX, PLAYLIST_DESCRIPTION_MAX } from '@/lib/data';
import { userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return NextResponse.json(getPlaylists(userIdFrom(req)));
}

export async function POST(req: NextRequest) {
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const name = textField(body.name, PLAYLIST_NAME_MAX);
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  // description is optional free text; anything that is not a string is stored as "none"
  const description = textField(body.description, PLAYLIST_DESCRIPTION_MAX);
  const result = getDb()
    .prepare('INSERT INTO playlists (name, description, user_id) VALUES (?, ?, ?)')
    .run(name, description, userIdFrom(req));
  return NextResponse.json({ id: Number(result.lastInsertRowid) }, { status: 201 });
}
