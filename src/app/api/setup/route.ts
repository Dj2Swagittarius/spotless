import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting } from '@/lib/db';
import { listUsers, requireAdmin } from '@/lib/user';

export const dynamic = 'force-dynamic';

// First-run state: the wizard shows only when nothing has ever been set up.
export async function GET() {
  return NextResponse.json({
    complete: getSetting('setup_complete') === '1',
    userCount: listUsers().length,
  });
}

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  setSetting('setup_complete', '1');
  return NextResponse.json({ complete: true });
}
