import { NextRequest, NextResponse } from 'next/server';
import { authUrl, getSpotifyRedirectConfig, hasSpotifyClient, makePkce } from '@/lib/spotify';
import { getUser, userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

function initiatingUserId(req: NextRequest): number {
  // When OAuth moves from a LAN/IP origin to the configured public origin,
  // preserve which Spotless profile started the connection.
  const transferred = Number(req.nextUrl.searchParams.get('spotify_profile'));
  if (Number.isInteger(transferred) && getUser(transferred)) return transferred;
  return userIdFrom(req);
}

export async function GET(req: NextRequest) {
  if (!hasSpotifyClient) {
    return NextResponse.redirect(new URL('/discover?spotify_error=SPOTIFY_CLIENT_ID+not+set', req.url));
  }

  const config = getSpotifyRedirectConfig();
  const userId = initiatingUserId(req);

  // Always enter OAuth through the exact origin that will receive the callback.
  // The one-time marker avoids relying on reverse-proxy Host/X-Forwarded-* headers,
  // which are not configured consistently across self-hosted proxies.
  if (req.nextUrl.searchParams.get('spotify_origin_ready') !== '1') {
    const login = new URL('/api/spotify/login', config.origin);
    login.searchParams.set('spotify_origin_ready', '1');
    login.searchParams.set('spotify_profile', String(userId));
    return NextResponse.redirect(login);
  }

  const { verifier, challenge, state } = makePkce();
  const res = NextResponse.redirect(authUrl(challenge, config.redirectUri, state));
  const secure = config.origin.startsWith('https://');
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    maxAge: 600,
    path: '/',
  };

  res.cookies.set('spotify_verifier', verifier, cookieOptions);
  res.cookies.set('spotify_oauth_state', state, cookieOptions);
  res.cookies.set('spotify_oauth_user', String(userId), cookieOptions);
  res.cookies.set('spotify_redirect_uri', config.redirectUri, cookieOptions);
  return res;
}
