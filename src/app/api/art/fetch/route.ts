import { NextRequest, NextResponse } from 'next/server';
import { fetchMissingArt, artStatus } from '@/lib/art';
import { isAdmin, requireAdmin } from '@/lib/user';

export const dynamic = 'force-dynamic';

// The failure text can name server paths; only the admin profile, which runs the fetch, sees it.
export async function GET(req: NextRequest) {
  const status = artStatus();
  if (isAdmin(req) || !status.lastError) return NextResponse.json(status);
  return NextResponse.json({ ...status, lastError: 'Artwork fetch failed (details are shown to the admin profile)' });
}

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  if (artStatus().running) {
    return NextResponse.json({ started: false, reason: 'artwork fetch already running', ...artStatus() }, { status: 202 });
  }

  // Fire and forget; the Settings page polls GET for progress/completion.
  fetchMissingArt().catch(() => {});
  return NextResponse.json({ started: true });
}
