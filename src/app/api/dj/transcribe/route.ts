import { NextRequest, NextResponse } from 'next/server';
import { currentUserFrom } from '@/lib/user';
import { getDjConfig } from '@/lib/dj/config';
import { djErrorResponse, djRateLimit } from '@/lib/dj/guard';
import { transcribe } from '@/lib/dj/speech';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_BYTES = 10 * 1024 * 1024;
// the multipart framing around the audio part: boundaries, part headers, the filename
const MAX_BODY_BYTES = MAX_BYTES + 64 * 1024;

/**
 * The raw body, or null once it is known to exceed `max`. A declared Content-Length is refused
 * before any byte is read; a chunked body is read with a budget and cancelled past it, so an
 * oversized upload never has to be buffered to be rejected.
 */
async function readCapped(req: NextRequest, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

// multipart { audio: Blob } → { text }
export async function POST(req: NextRequest) {
  const user = currentUserFrom(req);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const limited = djRateLimit('transcribe', user.id);
  if (limited) return limited;
  const raw = await readCapped(req, MAX_BODY_BYTES).catch(() => new Uint8Array(0));
  if (!raw) return NextResponse.json({ error: 'recording too long' }, { status: 413 });
  const form = await new Response(raw, { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData().catch(() => null);
  const audio = form?.get('audio');
  if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: 'audio required' }, { status: 400 });
  // backstop for the part itself, after the body-level cap above
  if (audio.size > MAX_BYTES) return NextResponse.json({ error: 'recording too long' }, { status: 413 });
  const type = audio.type || 'audio/webm';
  const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') || type.includes('m4a') ? 'm4a' : type.includes('wav') ? 'wav' : 'webm';
  try {
    return NextResponse.json({ text: await transcribe(getDjConfig(), audio, `speech.${ext}`) });
  } catch (err) {
    return djErrorResponse(req, err, 'transcribe');
  }
}
