import { NextRequest, NextResponse } from 'next/server';
import { search } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!q) return NextResponse.json({ tracks: [], albums: [], artists: [] });
  return NextResponse.json(search(q));
}
