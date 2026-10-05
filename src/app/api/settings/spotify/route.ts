import { NextRequest, NextResponse } from 'next/server';
import { getSpotifyRedirectConfig, saveSpotifyRedirectOrigin } from '@/lib/spotify';
import { requireAdmin } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getSpotifyRedirectConfig());
}

export async function PUT(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const origin = typeof body.origin === 'string' ? body.origin : '';

  try {
    return NextResponse.json(saveSpotifyRedirectOrigin(origin));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid Spotify redirect domain' },
      { status: 400 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json(saveSpotifyRedirectOrigin(''));
}
