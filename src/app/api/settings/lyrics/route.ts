import { NextRequest, NextResponse } from 'next/server';
import {
  getAutoLyricsSidecarsEnabled,
  lyricsSidecarStatus,
  setAutoLyricsSidecarsEnabled,
  syncMissingLyricsSidecars,
} from '@/lib/lyrics';
import { requireAdmin } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json(lyricsSidecarStatus());
}

export async function PUT(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be true or false' }, { status: 400 });
  }

  setAutoLyricsSidecarsEnabled(body.enabled);
  return NextResponse.json({
    ...lyricsSidecarStatus(),
    enabled: getAutoLyricsSidecarsEnabled(),
  });
}

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  if (lyricsSidecarStatus().running) {
    return NextResponse.json(
      { started: false, reason: 'lyrics sidecar sync already running', ...lyricsSidecarStatus() },
      { status: 202 }
    );
  }

  syncMissingLyricsSidecars().catch(() => {});
  return NextResponse.json({ started: true, ...lyricsSidecarStatus() });
}
