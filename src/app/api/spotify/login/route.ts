import { NextResponse } from 'next/server';
import { makePkce, authUrl, hasSpotifyClient } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!hasSpotifyClient) {
    return NextResponse.redirect(new URL('/discover?spotify_error=SPOTIFY_CLIENT_ID+not+set', req.url));
  }
  // Spotify's redirect URI is pinned to 127.0.0.1, and the PKCE cookie must be
  // set on that same origin — so bounce over there first if needed.
  if (req.headers.get('host') !== '127.0.0.1:3000') {
    return NextResponse.redirect('http://127.0.0.1:3000/api/spotify/login');
  }

  const { verifier, challenge } = makePkce();
  const res = NextResponse.redirect(authUrl(challenge));
  res.cookies.set('spotify_verifier', verifier, { httpOnly: true, maxAge: 600, path: '/' });
  return res;
}
