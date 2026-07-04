import { NextRequest, NextResponse } from 'next/server';
import { addArtistToLidarr, addAlbumToLidarr } from '@/lib/lidarr';
import { isAdmin, userIdFrom } from '@/lib/user';
import { createRequest } from '@/lib/requests';

export const dynamic = 'force-dynamic';

// { artist } → add/search whole artist; { artist, album } → monitor + search just that album.
// Admin downloads directly; everyone else files a request for the admin to approve.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const artist = String(body.artist ?? '').trim();
  const album = String(body.album ?? '').trim();
  if (!artist) return NextResponse.json({ error: 'artist required' }, { status: 400 });

  if (!isAdmin(req)) {
    const request = createRequest(userIdFrom(req), artist, album || null);
    return NextResponse.json({ status: 'requested', id: request.id }, { status: 202 });
  }

  try {
    if (album) return NextResponse.json(await addAlbumToLidarr(artist, album));
    return NextResponse.json(await addArtistToLidarr(artist));
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 300) }, { status: 400 });
  }
}
