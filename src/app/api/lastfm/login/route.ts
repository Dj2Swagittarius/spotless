import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requestOrigin, secureCookieFor } from '@/lib/auth';
import { lastfmApiKey } from '@/lib/lastfm';
import { userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'lastfm_oauth_state';

export async function GET(req: NextRequest) {
  if (!userIdFrom(req)) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const apiKey = lastfmApiKey();
  if (!apiKey) return NextResponse.json({ error: 'Last.fm API key not configured' }, { status: 400 });

  // The callback follows whatever origin the browser used, so LAN IPs work (no pinned redirect
  // URI like Spotify). The state travels both in the cb query string (Last.fm preserves it) and
  // in a cookie, so a crafted callback link can't attach a stranger's Last.fm account to this profile.
  const state = crypto.randomBytes(32).toString('hex');
  const cb = `${requestOrigin(req)}/api/lastfm/callback?state=${state}`;
  const res = NextResponse.redirect(
    `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(apiKey)}&cb=${encodeURIComponent(cb)}`
  );
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookieFor(req),
    path: '/api/lastfm',
    maxAge: 600,
  });
  return res;
}
