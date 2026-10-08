import { NextRequest, NextResponse } from 'next/server';
import {
  listStations,
  createStation,
  updateStation,
  deleteStation,
  streamUrlError,
  assertPublicStreamUrl,
} from '@/lib/stations';
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
  if (!name) return NextResponse.json({ error: 'name and a valid http(s) stream URL required' }, { status: 400 });
  // the URL check names the rule it tripped (scheme vs. private address) so the form can show why
  const urlError = streamUrlError(streamUrl);
  if (urlError) return NextResponse.json({ error: urlError }, { status: 400 });
  // literals passed; now make sure the hostname does not resolve back into the LAN either
  try {
    await assertPublicStreamUrl(streamUrl);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
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
  if (!id || !name)
    return NextResponse.json({ error: 'id, name and a valid http(s) stream URL required' }, { status: 400 });
  const urlError = streamUrlError(streamUrl);
  if (urlError) return NextResponse.json({ error: urlError }, { status: 400 });
  try {
    await assertPublicStreamUrl(streamUrl);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
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
