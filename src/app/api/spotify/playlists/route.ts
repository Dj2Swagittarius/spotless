import { NextRequest, NextResponse } from 'next/server';
import { listPlaylists, importPlaylist } from '@/lib/spotify';
import { userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(await listPlaylists(userIdFrom(req)));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? '');
  const name = String(body.name ?? '').trim();
  if (!id || !name) return NextResponse.json({ error: 'id and name required' }, { status: 400 });
  try {
    return NextResponse.json(await importPlaylist(userIdFrom(req), id, name));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
