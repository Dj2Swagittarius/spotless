import { NextRequest, NextResponse } from 'next/server';
import { cleanPatch, renameDevice, reportState, sendCommand, transfer, type RemoteCommand } from '@/lib/devices';
import { userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * POST /api/devices — "Play on" actions from a page that has its event stream open.
 *   { action: 'state', from, state, claim? }   the active device's playback state (claim: it started playing by itself)
 *   { action: 'command', from, cmd }           a remote's command for the active device
 *   { action: 'transfer', from, to, state? }   move playback to device `to`
 *   { action: 'rename', from, name }           rename this device
 */
export async function POST(req: NextRequest) {
  const uid = userIdFrom(req);
  if (!uid) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const from = typeof body.from === 'string' ? body.from : '';
  let ok = false;
  switch (body.action) {
    case 'state':
      ok = reportState(uid, from, cleanPatch(body.state), body.claim === true);
      break;
    case 'command': {
      const cmd = cleanCommand(body.cmd);
      if (!cmd) return NextResponse.json({ error: 'invalid command' }, { status: 400 });
      ok = sendCommand(uid, from, cmd);
      break;
    }
    case 'transfer':
      ok = transfer(uid, from, typeof body.to === 'string' ? body.to : '', body.state ? cleanPatch(body.state) : null);
      break;
    case 'rename':
      ok = renameDevice(uid, from, typeof body.name === 'string' ? body.name : '');
      break;
    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }
  // 409: this page's view of the devices is out of date (not connected, not active, target gone)
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false }, { status: 409 });
}

function cleanCommand(raw: unknown): RemoteCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (c.type === 'toggleShuffle') return { type: 'toggleShuffle' };
  if (c.type === 'seek' && typeof c.position === 'number' && Number.isFinite(c.position)) {
    return { type: 'seek', position: Math.max(0, c.position) };
  }
  if (c.type === 'sync') {
    const patch = cleanPatch(c.patch);
    delete patch.position;
    return { type: 'sync', patch };
  }
  return null;
}
