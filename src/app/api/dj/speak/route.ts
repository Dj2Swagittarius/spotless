import { NextRequest, NextResponse } from 'next/server';
import { currentUserFrom } from '@/lib/user';
import { getDjConfig } from '@/lib/dj/config';
import { synthesize } from '@/lib/dj/speech';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// body { text } → audio bytes, or { browser: true } when the browser should speak it itself
export async function POST(req: NextRequest) {
  const user = currentUserFrom(req);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? '').trim();
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });
  const cfg = getDjConfig();
  try {
    const out = await synthesize(cfg, text);
    if (!out) return NextResponse.json({ browser: cfg.tts.provider === 'browser', off: cfg.tts.provider === 'off' });
    return new NextResponse(out.audio, { headers: { 'Content-Type': out.type, 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
