import { NextRequest, NextResponse } from 'next/server';
import { isAdmin, userIdFrom, requireAdmin } from '@/lib/user';
import { listAllRequests, listUserRequests, getRequest, resolveRequest } from '@/lib/requests';
import { addArtistToLidarr, addAlbumToLidarr } from '@/lib/lidarr';

export const dynamic = 'force-dynamic';

// Admin sees the whole queue; everyone else sees their own requests.
export async function GET(req: NextRequest) {
  const requests = isAdmin(req) ? listAllRequests() : listUserRequests(userIdFrom(req));
  return NextResponse.json({ requests });
}

// { id, action: 'approve' | 'deny' } — admin only. Approve fires the real Lidarr add.
export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  const action = String(body.action ?? '');
  const request = Number.isInteger(id) ? getRequest(id) : null;
  if (!request) return NextResponse.json({ error: 'request not found' }, { status: 404 });
  if (request.status !== 'pending') return NextResponse.json({ error: 'already resolved' }, { status: 400 });

  if (action === 'deny') {
    resolveRequest(id, 'denied');
    return NextResponse.json({ ...request, status: 'denied' });
  }
  if (action !== 'approve') return NextResponse.json({ error: 'action must be approve or deny' }, { status: 400 });

  try {
    const result = request.album
      ? await addAlbumToLidarr(request.artist, request.album)
      : await addArtistToLidarr(request.artist);
    resolveRequest(id, 'approved');
    return NextResponse.json({ ...request, status: 'approved', lidarr: result });
  } catch (err) {
    // stays pending so it can be retried after fixing whatever broke
    return NextResponse.json({ error: String(err).slice(0, 300) }, { status: 400 });
  }
}
