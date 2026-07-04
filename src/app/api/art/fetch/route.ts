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
  // fire and forget; poll GET for status
  fetchMissingArt().catch((err) => console.error('art fetch failed:', err));
  return NextResponse.json({ started: true });
}
