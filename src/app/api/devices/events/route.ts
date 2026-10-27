import { NextRequest, NextResponse } from 'next/server';
import { cleanDevice, connectDevice, type DeviceEvent } from '@/lib/devices';
import { userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

// Proxies and load balancers drop a connection that has been silent for a minute or so.
const HEARTBEAT_MS = 20_000;

/**
 * GET /api/devices/events?id=&name=&kind= — a page's event stream for "Play on". Opening it makes the
 * page one of the user's devices; closing it (tab closed, network gone) takes it off the list.
 */
export async function GET(req: NextRequest) {
  const uid = userIdFrom(req);
  if (!uid) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const device = cleanDevice({ id: q.get('id'), name: q.get('name'), kind: q.get('kind') });
  if (!device) return NextResponse.json({ error: 'invalid device' }, { status: 400 });

  const encoder = new TextEncoder();
  let disconnect: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          finish();
        }
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        disconnect?.();
        try {
          controller.close();
        } catch {
          // already closed by the client going away
        }
      };
      // tells EventSource how soon to come back after a drop
      write('retry: 3000\n\n');
      disconnect = connectDevice(uid, device, (e: DeviceEvent) => write(`data: ${JSON.stringify(e)}\n\n`), finish);
      heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
      req.signal.addEventListener('abort', finish);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      disconnect?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // nginx and similar reverse proxies buffer responses by default, which holds events back
      'X-Accel-Buffering': 'no',
    },
  });
}
