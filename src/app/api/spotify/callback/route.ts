import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode, getSpotifyRedirectConfig, importTaste, SpotifyApiError, takeOAuth } from '@/lib/spotify';

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
  } catch (err) {
    console.error('spotify token exchange failed:', err);
    return done(origin, `spotify_error=${encodeURIComponent('token exchange failed; start the Spotify connection again')}`);
  }

  // Tokens are stored, so the profile is connected whatever happens next. A failed first import
  // (429, a user missing from the app's dev-mode allowlist, a Spotify outage) must not be reported
  // as a failed connection: Settings would show Connected while Discover says it failed. Surface it
  // as a warning instead; Re-import in Settings retries it. The exception is a 401, which drops the
  // tokens again (see api() in lib/spotify), so the connection really did not stick.
  try {
    await importTaste(pending.userId);
  } catch (err) {
    console.error('spotify first import failed:', err);
    const status = err instanceof SpotifyApiError ? err.status : null;
    if (status === 401) {
      return done(origin, `spotify_error=${encodeURIComponent('Spotify rejected the new authorization; start the connection again')}`);
    }
    const detail = status === null ? 'Spotify unreachable' : `HTTP ${status}`;
    const warning = `connected, but the first import failed (${detail}); use Re-import in Settings`;
    return done(origin, `spotify=connected&spotify_warning=${encodeURIComponent(warning)}`);
  }
  return done(origin, 'spotify=connected');
}
