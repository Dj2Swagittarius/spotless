import { NextRequest, NextResponse } from 'next/server';
import { currentUserFrom } from '@/lib/user';
import { getTrack } from '@/lib/data';
import { segue } from '@/lib/dj/dj';
import { djErrorResponse, djRateLimit } from '@/lib/dj/guard';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const trackId = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

// body { trackId, previousId? } → { say }
export async function POST(req: NextRequest) {
  const user = currentUserFrom(req);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const limited = djRateLimit('segue', user.id);
  if (limited) return limited;
  const body = await req.json().catch(() => ({}));
  const track = getTrack(trackId(body.trackId));
  if (!track) return NextResponse.json({ error: 'track not found' }, { status: 404 });
  const prev = trackId(body.previousId) ? getTrack(trackId(body.previousId)) : undefined;
  try {
    const say = await segue(user.name, track, prev);
    return NextResponse.json({ say });
  } catch (err) {
    return djErrorResponse(req, err, 'segue');
  }
}
