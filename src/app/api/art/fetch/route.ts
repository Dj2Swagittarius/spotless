import { NextRequest, NextResponse } from 'next/server';
import { fetchMissingArt, artStatus } from '@/lib/art';
import { requireAdmin } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(artStatus());
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
