import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode, importTaste } from '@/lib/spotify';
import { userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const code = params.get('code');
  const verifier = req.cookies.get('spotify_verifier')?.value;

  if (params.get('error') || !code || !verifier) {
    const reason = params.get('error') || (!verifier ? 'missing PKCE cookie (start from the Connect button)' : 'no code');
    return NextResponse.redirect(`http://127.0.0.1:3000/discover?spotify_error=${encodeURIComponent(reason)}`);
  }

  try {
    const uid = userIdFrom(req);
    await exchangeCode(uid, code, verifier);
    await importTaste(uid);
  } catch (err) {
    console.error('spotify connect failed:', err);
    return NextResponse.redirect(`http://127.0.0.1:3000/discover?spotify_error=${encodeURIComponent('token exchange or import failed')}`);
  }

  const res = NextResponse.redirect('http://127.0.0.1:3000/discover?spotify=connected');
  res.cookies.delete('spotify_verifier');
  return res;
}
