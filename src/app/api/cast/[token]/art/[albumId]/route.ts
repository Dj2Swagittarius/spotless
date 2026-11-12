import { checkCastToken } from '@/lib/cast/media';
import { GET as artwork } from '@/app/api/artwork/[albumId]/route';

export const dynamic = 'force-dynamic';

/** GET /api/cast/<token>/art/<albumId> — album artwork for a Chromecast's now-playing screen. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string; albumId: string }> }) {
  const { token, albumId } = await params;
  if (checkCastToken(token) === null) return new Response('not found', { status: 404 });
  const res = await artwork(req, { params: Promise.resolve({ albumId }) });
  res.headers.set('Access-Control-Allow-Origin', '*');
  return res;
}
