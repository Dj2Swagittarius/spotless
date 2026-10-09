import { NextRequest, NextResponse } from 'next/server';
import { currentUserFrom } from '@/lib/user';
import { getDjConfig } from '@/lib/dj/config';
import { djErrorResponse, djRateLimit } from '@/lib/dj/guard';
import { synthesize } from '@/lib/dj/speech';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// DJ lines are a few sentences; synthesize() itself trims to 1500 characters, so anything past
// this is not something the page produced and is refused rather than billed to the admin's key
const MAX_CHARS = 2000;

// body { text } → audio bytes, or { browser: true } when the browser should speak it itself
export async function POST(req: NextRequest) {
  const user = currentUserFrom(req);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const limited = djRateLimit('speak', user.id);
  if (limited) return limited;
  const body = await req.json().catch(() => ({}));
  // over-long lines are spoken truncated rather than refused: the model occasionally runs long
  const text = String(body.text ?? '').trim().slice(0, MAX_CHARS);
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });
  const cfg = getDjConfig();
  try {
    const out = await synthesize(cfg, text);
    if (!out) return NextResponse.json({ browser: cfg.tts.provider === 'browser', off: cfg.tts.provider === 'off' });
    return new NextResponse(out.audio, { headers: { 'Content-Type': out.type, 'Cache-Control': 'no-store' } });
  } catch (err) {
    return djErrorResponse(req, err, 'speak');
  }
}
