import { NextRequest, NextResponse } from 'next/server';
import { similarTracks } from '@/lib/radio';

export const dynamic = 'force-dynamic';

// Radio: given a seed track, return similar library tracks to keep the queue going.
export async function GET(req: NextRequest) {
  const seedId = Number(req.nextUrl.searchParams.get('seed'));
  const exclude = (req.nextUrl.searchParams.get('exclude') ?? '')
    .split(',')
    .filter(Boolean)
    .map(Number)
    .filter(Number.isInteger)
    .slice(0, 500);
  const requested = Number(req.nextUrl.searchParams.get('limit'));
  // floor before binding: SQLite rejects a fractional LIMIT with a datatype mismatch
  const limit = Number.isFinite(requested) && requested >= 1 ? Math.min(Math.floor(requested), 30) : 15;
  return NextResponse.json({ tracks: similarTracks(seedId, exclude, limit) });
}
