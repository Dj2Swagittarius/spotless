import { NextRequest, NextResponse } from 'next/server';
import { currentUserFrom } from '@/lib/user';
import { runDj } from '@/lib/dj/dj';
import { djErrorResponse, djRateLimit } from '@/lib/dj/guard';
import type { ChatMessage } from '@/lib/dj/llm';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const song = (v: unknown) => {
  const o = v as { title?: unknown; artist?: unknown } | null;
  return o && typeof o.title === 'string' && typeof o.artist === 'string'
    ? { title: o.title.slice(0, 200), artist: o.artist.slice(0, 200) }
    : null;
};

// body { messages: {role, content}[], nowPlaying?, upNext?, localTime? }
export async function POST(req: NextRequest) {
  const user = currentUserFrom(req);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  // one message costs up to two model calls and a batch of Deezer lookups
  const limited = djRateLimit('chat', user.id);
  if (limited) return limited;
  const body = await req.json().catch(() => ({}));
  const messages: ChatMessage[] = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m: { role?: unknown; content?: unknown }) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-16)
    .map((m: ChatMessage) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  // conversations must start with the listener
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'message required' }, { status: 400 });
  }
  try {
    const reply = await runDj(user.id, user.name, messages, {
      nowPlaying: song(body.nowPlaying),
      upNext: (Array.isArray(body.upNext) ? body.upNext : []).map(song).filter(Boolean).slice(0, 5),
      localTime: typeof body.localTime === 'string' ? body.localTime.slice(0, 80) : undefined,
    });
    return NextResponse.json(reply);
  } catch (err) {
    return djErrorResponse(req, err, 'chat');
  }
}
