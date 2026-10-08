import { NextRequest, NextResponse } from 'next/server';
import { scanLibrary, scanStatus, setAutoScanIntervalMinutes } from '@/lib/scanner';
import { isAdmin, requireAdmin } from '@/lib/user';

export const dynamic = 'force-dynamic';

// Progress is polled by every profile (library page, setup wizard); the failure text can
// contain server paths, so only the admin profile sees it.
export async function GET(req: NextRequest) {
  const status = scanStatus();
  if (isAdmin(req) || !status.lastScanError) return NextResponse.json(status);
  return NextResponse.json({
    ...status,
    lastScanError: { at: status.lastScanError.at, message: 'Scan failed (details are shown to the admin profile)' },
  });
}

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  if (scanStatus().scanning) {
    return NextResponse.json({ started: false, reason: 'scan already running' }, { status: 202 });
  }

  // Fire and forget; the settings page polls GET for completion.
  scanLibrary().catch((err) => console.error('scan failed:', err));
  return NextResponse.json({ started: true });
}

export async function PUT(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const intervalMinutes = Number(body.intervalMinutes);

  try {
    setAutoScanIntervalMinutes(intervalMinutes);
    return NextResponse.json(scanStatus());
  } catch {
    return NextResponse.json(
      {
        error: 'Invalid interval. Choose Off, 5, 15, 30 minutes, or 1, 3, 6, 12, 24 hours.',
      },
      { status: 400 }
    );
  }
}
