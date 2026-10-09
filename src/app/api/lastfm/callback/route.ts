import { NextRequest, NextResponse } from 'next/server';
import { requestOrigin, safeEqual, secureCookieFor } from '@/lib/auth';
import { getLastfmSession, saveLastfmSession } from '@/lib/lastfm';
import { userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'lastfm_oauth_state';

/** The state cookie is single-use: drop it on every exit from the callback. */
function clearState(res: NextResponse, req: NextRequest): NextResponse {
  res.cookies.set(STATE_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookieFor(req),
    path: '/api/lastfm',
    maxAge: 0,
  });
  return res;
}

export async function GET(req: NextRequest) {
  const userId = userIdFrom(req);
  if (!userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const origin = requestOrigin(req);
  const state = req.nextUrl.searchParams.get('state');
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;
  if (!state || !cookieState || !safeEqual(state, cookieState)) {
    // Not this browser's login attempt (or it expired): refuse to link rather than redirecting,
    // so a forged callback can't quietly bind someone else's Last.fm session to this profile.
    return clearState(
      NextResponse.json({ error: 'Last.fm sign-in state mismatch; start the connection again' }, { status: 403 }),
      req
    );
  }

  const token = req.nextUrl.searchParams.get('token');
  if (!token) return clearState(NextResponse.redirect(`${origin}/settings?lastfm_error=no+token`), req);
  try {
    const session = await getLastfmSession(token);
    saveLastfmSession(userId, session);
  } catch (err) {
    console.error('lastfm connect failed:', err);
    return clearState(
      NextResponse.redirect(`${origin}/settings?lastfm_error=${encodeURIComponent('session exchange failed')}`),
      req
    );
  }
  return clearState(NextResponse.redirect(`${origin}/settings?lastfm=connected`), req);
}
