import { NextRequest, NextResponse } from 'next/server';
import {
  addManualCast,
  castEnabled,
  castStatus,
  cleanCastHost,
  removeManualCast,
  rescan,
  startCast,
} from '@/lib/cast/registry';
import { requireAdmin } from '@/lib/user';

export const dynamic = 'force-dynamic';

/** GET /api/settings/cast — Chromecasts found on the network and added by hand. */
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  startCast();
  return NextResponse.json(castStatus());
}

function target(body: Record<string, unknown>): { host: string; port: number } | null {
  const host = typeof body.host === 'string' ? cleanCastHost(body.host) : null;
  const port = body.port === undefined || body.port === '' ? 8009 : Number(body.port);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

/**
 * POST /api/settings/cast
 *   { action: 'add', host, port?, name? }   add a Chromecast by address
 *   { action: 'remove', host, port? }       forget one added by hand
 *   { action: 'scan' }                      search the network again now
 */
export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (!castEnabled())
    return NextResponse.json({ error: 'Casting is turned off (CAST_ENABLED=false)' }, { status: 409 });
  startCast();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.action === 'scan') {
    await rescan();
    return NextResponse.json(castStatus());
  }
  const t = target(body);
  if (!t) return NextResponse.json({ error: "Enter the Chromecast's IP address, like 192.168.1.40" }, { status: 400 });
  if (body.action === 'add') addManualCast({ ...t, name: typeof body.name === 'string' ? body.name : '' });
  else if (body.action === 'remove') removeManualCast(t.host, t.port);
  else return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  return NextResponse.json(castStatus());
}
