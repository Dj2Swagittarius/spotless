import { NextRequest, NextResponse } from 'next/server';
import { currentUserFrom } from '@/lib/user';
import { getTrack } from '@/lib/data';
import { segue } from '@/lib/dj/dj';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// body { trackId, previousId? } → { say }
export async function POST(req: NextRequest) {
  const user = currentUserFrom(req);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const track = getTrack(Number(body.trackId));
  if (!track) return NextResponse.json({ error: 'track not found' }, { status: 404 });
  const prev = body.previousId ? getTrack(Number(body.previousId)) : undefined;
  try {
    const say = await segue(user.name, track, prev);
    return NextResponse.json({ say });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
