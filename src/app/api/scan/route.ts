import { NextRequest, NextResponse } from 'next/server';
import { scanLibrary, scanStatus } from '@/lib/scanner';
import { requireAdmin } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(scanStatus());
}

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  // fire and forget; poll GET for status
  scanLibrary().catch((err) => console.error('scan failed:', err));
  return NextResponse.json({ started: true });
}
