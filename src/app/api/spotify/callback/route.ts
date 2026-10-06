import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode, getSpotifyRedirectConfig, importTaste, takeOAuth } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

function done(origin: string, query: string): NextResponse {
  const res = NextResponse.redirect(`${origin}/discover?${query}`);
  res.cookies.delete('spotify_oauth_state');
  return res;
}

// Public in the proxy: identity comes from the server-side OAuth record, not a session.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const state = params.get('state');
  const cookieState = req.cookies.get('spotify_oauth_state')?.value;
  const pending = state && cookieState === state ? takeOAuth(state) : null;
  const origin = pending ? new URL(pending.redirectUri).origin : getSpotifyRedirectConfig().origin;

  const oauthError = params.get('error');
  if (oauthError) return done(origin, `spotify_error=${encodeURIComponent(oauthError)}`);

  const code = params.get('code');
  if (!pending || !code) {
    const reason = !pending ? 'invalid or expired OAuth state (start the Spotify connection again)' : 'no code';
    return done(origin, `spotify_error=${encodeURIComponent(reason)}`);
  }

  try {
    await exchangeCode(pending.userId, code, pending.verifier, pending.redirectUri);
    await importTaste(pending.userId);
  } catch (err) {
    console.error('spotify connect failed:', err);
    return done(origin, `spotify_error=${encodeURIComponent('token exchange or import failed')}`);
  }
  return done(origin, 'spotify=connected');
}
