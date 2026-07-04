import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getPlaylists } from '@/lib/data';
import { userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return NextResponse.json(getPlaylists(userIdFrom(req)));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const name = String(body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const result = getDb()
    .prepare('INSERT INTO playlists (name, description, user_id) VALUES (?, ?, ?)')
    .run(name, body.description ?? null, userIdFrom(req));
  return NextResponse.json({ id: Number(result.lastInsertRowid) }, { status: 201 });
}
