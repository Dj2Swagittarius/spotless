import { NextRequest, NextResponse } from 'next/server';
import { currentUserFrom } from '@/lib/user';
import { getDjConfig } from '@/lib/dj/config';
import { transcribe } from '@/lib/dj/speech';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_BYTES = 10 * 1024 * 1024;

// multipart { audio: Blob } → { text }
export async function POST(req: NextRequest) {
  const user = currentUserFrom(req);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const audio = form?.get('audio');
  if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: 'audio required' }, { status: 400 });
  if (audio.size > MAX_BYTES) return NextResponse.json({ error: 'recording too long' }, { status: 413 });
  const type = audio.type || 'audio/webm';
  const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') || type.includes('m4a') ? 'm4a' : type.includes('wav') ? 'wav' : 'webm';
  try {
    return NextResponse.json({ text: await transcribe(getDjConfig(), audio, `speech.${ext}`) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
