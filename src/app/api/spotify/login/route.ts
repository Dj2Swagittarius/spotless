import { NextRequest, NextResponse } from 'next/server';
import { beginOAuth, createHandoff, getSpotifyRedirectConfig, hasSpotifyClient, takeHandoff } from '@/lib/spotify';
import { userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

// Public in the proxy: the second hop lands on the configured redirect origin, where
// this browser may not have a session. It authenticates with a one-time handoff instead.
export async function GET(req: NextRequest) {
  if (!hasSpotifyClient) {
    return NextResponse.redirect(new URL('/discover?spotify_error=SPOTIFY_CLIENT_ID+not+set', req.url));
  }

  const config = getSpotifyRedirectConfig();
  const handoff = req.nextUrl.searchParams.get('handoff');

  // Always enter OAuth through the exact origin that will receive the callback, so the
  // state cookie is set where the callback can read it. Reverse proxies don't forward
  // Host/X-Forwarded-* consistently, so don't try to detect "already there".
  if (!handoff) {
    const userId = userIdFrom(req);
    if (!userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const login = new URL('/api/spotify/login', config.origin);
    login.searchParams.set('handoff', createHandoff(userId));
    return NextResponse.redirect(login);
  }

  const userId = takeHandoff(handoff);
  if (!userId) {
    const reason = 'connection link expired; start the Spotify connection again';
    return NextResponse.redirect(`${config.origin}/discover?spotify_error=${encodeURIComponent(reason)}`);
  }

  const { state, url } = beginOAuth(userId, config.redirectUri);
  const res = NextResponse.redirect(url);
  // binds the callback to this browser, so a crafted callback link can't attach someone else's account
  res.cookies.set('spotify_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.origin.startsWith('https://'),
    maxAge: 600,
    path: '/',
  });
  return res;
}
