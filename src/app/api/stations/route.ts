import { NextRequest, NextResponse } from 'next/server';
import { listStations, createStation, updateStation, deleteStation, validStreamUrl } from '@/lib/stations';
import { requireAdmin } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(listStations());
}

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json();
  const name = String(body.name ?? '').trim();
  const streamUrl = String(body.streamUrl ?? '').trim();
  const homePageUrl = String(body.homePageUrl ?? '').trim() || null;
  if (!name || !validStreamUrl(streamUrl))
    return NextResponse.json({ error: 'name and a valid http(s) stream URL required' }, { status: 400 });
  return NextResponse.json(createStation(name, streamUrl, homePageUrl));
}

export async function PUT(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json();
  const id = Number(body.id);
  const name = String(body.name ?? '').trim();
  const streamUrl = String(body.streamUrl ?? '').trim();
  const homePageUrl = String(body.homePageUrl ?? '').trim() || null;
  if (!id || !name || !validStreamUrl(streamUrl))
    return NextResponse.json({ error: 'id, name and a valid http(s) stream URL required' }, { status: 400 });
  if (!updateStation(id, name, streamUrl, homePageUrl))
    return NextResponse.json({ error: 'station not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json();
  const id = Number(body.id);
  if (!id || !deleteStation(id)) return NextResponse.json({ error: 'station not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
