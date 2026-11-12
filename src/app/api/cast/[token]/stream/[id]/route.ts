import { checkCastToken } from '@/lib/cast/media';
import { GET as streamTrack } from '@/app/api/stream/[id]/route';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cast/<token>/stream/<id> — a track's audio for a Chromecast, which has no session
 * cookie. The token (see lib/cast/media) stands in for it; the rest is the web player's stream.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  if (checkCastToken(token) === null) return new Response('not found', { status: 404 });
  const res = await streamTrack(req, { params: Promise.resolve({ id }) });
  // the receiver fetches cross-origin from its own page
  res.headers.set('Access-Control-Allow-Origin', '*');
  return res;
}
