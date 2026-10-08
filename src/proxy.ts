import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie, sessionFromRequest } from '@/lib/auth';

// spotify login/callback authenticate themselves (session or one-time handoff, server-side OAuth state);
// health is a liveness probe for Docker/uptime monitors and exposes nothing user-specific
const PUBLIC_API = new Set([
  '/api/users',
  '/api/users/select',
  '/api/setup',
  '/api/spotify/login',
  '/api/spotify/callback',
  '/api/health',
]);
// These routes choose their own Cache-Control (long-lived public artwork, no-store streams);
// forcing no-store on them would make every album cover re-download on each page view.
const SELF_CACHED = /^\/api\/(?:artwork|stream)\/|^\/api\/stations\/[^/]+\/stream$/;
const CSRF_EXEMPT = new Set(['/api/lidarr/webhook']);
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function sameOrigin(req: NextRequest): boolean {
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;

  const origin = req.headers.get('origin');
  if (!origin) return true; // non-browser clients may legitimately omit Origin
  try {
    const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    const expectedHost = forwardedHost || req.headers.get('host') || req.nextUrl.host;
    return new URL(origin).host === expectedHost;
  } catch {
    return false;
  }
}

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (UNSAFE.has(req.method) && !CSRF_EXEMPT.has(path) && !sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-site request rejected' }, { status: 403 });
  }

  // Lidarr must be able to call its webhook without a browser session. Protect it with
  // LIDARR_WEBHOOK_SECRET as already supported by Spotless when reachable beyond a trusted LAN.
  if (CSRF_EXEMPT.has(path) || PUBLIC_API.has(path)) return NextResponse.next();

  const session = sessionFromRequest(req);
  if (session) {
    const res = NextResponse.next();
    // Prevent a reverse proxy/shared cache from serving one authenticated user's API response to another.
    if (!SELF_CACHED.test(path)) res.headers.set('Cache-Control', 'private, no-store');
    res.headers.append('Vary', 'Cookie');
    return res;
  }

  const res = NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  res.headers.set('Cache-Control', 'no-store');
  clearSessionCookie(res, req);
  return res;
}

export const config = {
  matcher: ['/api/:path*'],
};
