import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode, importTaste, normalizeSpotifyRedirectUri, getSpotifyRedirectConfig } from '@/lib/spotify';
import { getUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

const OAUTH_COOKIES = ['spotify_verifier', 'spotify_oauth_state', 'spotify_oauth_user', 'spotify_redirect_uri'] as const;

function redirectAndClear(url: string, userId?: number): NextResponse {
  const res = NextResponse.redirect(url);
  for (const name of OAUTH_COOKIES) res.cookies.delete(name);
  // If OAuth started on a LAN/IP origin and bounced to a configured public
  // domain, preserve the selected Spotless profile on that public origin too.
  if (userId && getUser(userId)) {
    res.cookies.set('uid', String(userId), { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  }
  return res;
}

function fallbackOrigin(): string {
  return getSpotifyRedirectConfig().origin;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const code = params.get('code');
  const returnedState = params.get('state');
  const verifier = req.cookies.get('spotify_verifier')?.value;
  const expectedState = req.cookies.get('spotify_oauth_state')?.value;
  const rawUserId = req.cookies.get('spotify_oauth_user')?.value;
  const rawRedirectUri = req.cookies.get('spotify_redirect_uri')?.value;

  let redirectUri: string;
  try {
    redirectUri = rawRedirectUri ? normalizeSpotifyRedirectUri(rawRedirectUri) : getSpotifyRedirectConfig().redirectUri;
  } catch {
    redirectUri = getSpotifyRedirectConfig().redirectUri;
  }
  const origin = new URL(redirectUri).origin || fallbackOrigin();

  const oauthError = params.get('error');
  if (oauthError) {
    return redirectAndClear(`${origin}/discover?spotify_error=${encodeURIComponent(oauthError)}`);
  }

  if (!code || !verifier || !returnedState || !expectedState || returnedState !== expectedState) {
    const reason = !verifier
      ? 'missing PKCE cookie (start from the Connect button)'
      : !returnedState || !expectedState || returnedState !== expectedState
        ? 'invalid OAuth state (start the Spotify connection again)'
        : 'no code';
    return redirectAndClear(`${origin}/discover?spotify_error=${encodeURIComponent(reason)}`);
  }

  const userId = Number(rawUserId);
  if (!Number.isInteger(userId) || !getUser(userId)) {
    return redirectAndClear(`${origin}/discover?spotify_error=${encodeURIComponent('profile session lost; start the Spotify connection again')}`);
  }

  try {
    await exchangeCode(userId, code, verifier, redirectUri);
    await importTaste(userId);
  } catch (err) {
    console.error('spotify connect failed:', err);
    return redirectAndClear(`${origin}/discover?spotify_error=${encodeURIComponent('token exchange or import failed')}`);
  }

  return redirectAndClear(`${origin}/discover?spotify=connected`, userId);
}
