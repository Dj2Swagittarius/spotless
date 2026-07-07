import { NextRequest, NextResponse } from 'next/server';
import { getLastfmSession, saveLastfmSession } from '@/lib/lastfm';
import { userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const origin = `http://${req.headers.get('host')}`;
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.redirect(`${origin}/settings?lastfm_error=no+token`);
  try {
    const session = await getLastfmSession(token);
    saveLastfmSession(userIdFrom(req), session);
  } catch (err) {
    console.error('lastfm connect failed:', err);
    return NextResponse.redirect(`${origin}/settings?lastfm_error=${encodeURIComponent('session exchange failed')}`);
  }
  return NextResponse.redirect(`${origin}/settings?lastfm=connected`);
}
