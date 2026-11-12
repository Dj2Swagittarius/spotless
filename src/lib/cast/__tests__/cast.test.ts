import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectDevice,
  resetDevices,
  setExternalDevices,
  transfer,
  sendCommand,
  reportState,
  externalState,
  externalStopped,
  type DeviceEvent,
} from '../../devices';
import type { Track } from '../../types';
import type { CastSession, LoadRequest, MediaStatus } from '../client';
import { CastController, type CastHost, type CastTarget } from '../controller';
import { buildQuery, parseResponse } from '../mdns';
import { decodeMessage, encodeMessage, MessageReader } from '../protocol';

const track = (id: number, extra: Partial<Track> = {}) =>
  ({ id, title: `t${id}`, artist: 'a', album: 'b', albumId: 1, duration: 200, ...extra }) as Track;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('cast wire format', () => {
  it('round-trips a message, including long and non-ASCII payloads', () => {
    const m = {
      sourceId: 'sender-0',
      destinationId: 'receiver-0',
      namespace: 'urn:x-cast:com.google.cast.media',
      data: JSON.stringify({ t: 'é'.repeat(300) }),
    };
    const framed = encodeMessage(m);
    expect(framed.readUInt32BE(0)).toBe(framed.length - 4);
    expect(decodeMessage(framed.subarray(4))).toEqual(m);
  });

  it('reassembles messages split across and packed into socket chunks', () => {
    const a = encodeMessage({ sourceId: 's', destinationId: 'd', namespace: 'n', data: '{"a":1}' });
    const b = encodeMessage({ sourceId: 's', destinationId: 'd', namespace: 'n', data: '{"b":2}' });
    const all = Buffer.concat([a, b]);
    const r = new MessageReader();
    expect(r.push(all.subarray(0, 3))).toEqual([]);
    expect(r.push(all.subarray(3, a.length + 5)).map((m) => m.data)).toEqual(['{"a":1}']);
    expect(r.push(all.subarray(a.length + 5)).map((m) => m.data)).toEqual(['{"b":2}']);
  });

  it('refuses an absurd length instead of buffering forever', () => {
    const r = new MessageReader();
    const head = Buffer.alloc(4);
    head.writeUInt32BE(50_000_000, 0);
    expect(() => r.push(head)).toThrow(/too large/);
  });
});

function name(n: string): Buffer {
  return Buffer.concat([
    ...n.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])),
    Buffer.from([0]),
  ]);
}

function rr(owner: string, type: number, data: Buffer): Buffer {
  const head = Buffer.alloc(10);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(1, 2);
  head.writeUInt32BE(120, 4);
  head.writeUInt16BE(data.length, 8);
  return Buffer.concat([name(owner), head, data]);
}

describe('mDNS discovery', () => {
  it('asks for the googlecast service', () => {
    const q = buildQuery();
    expect(q.readUInt16BE(4)).toBe(1);
    expect(q.includes(Buffer.from('_googlecast'))).toBe(true);
  });

  it('reads name, model, address and port from a receiver answer', () => {
    const inst = 'Chromecast-abc123._googlecast._tcp.local';
    const txtEntries = ['id=ABC123DEF456', 'md=Chromecast', 'fn=Living Room TV'].map((e) =>
      Buffer.concat([Buffer.from([e.length]), Buffer.from(e)])
    );
    const srv = Buffer.alloc(6);
    srv.writeUInt16BE(8009, 4);
    const header = Buffer.alloc(12);
    header.writeUInt16BE(0x8400, 2);
    header.writeUInt16BE(1, 6); // one answer
    header.writeUInt16BE(3, 10); // three additional
    const packet = Buffer.concat([
      header,
      rr('_googlecast._tcp.local', 12, name(inst)),
      rr(inst, 16, Buffer.concat(txtEntries)),
      rr(inst, 33, Buffer.concat([srv, name('abc123.local')])),
      rr('abc123.local', 1, Buffer.from([192, 168, 0, 42])),
    ]);
    expect(parseResponse(packet, '10.0.0.1')).toEqual([
      { id: 'abc123def456', name: 'Living Room TV', model: 'Chromecast', host: '192.168.0.42', port: 8009 },
    ]);
  });

  it('ignores junk', () => {
    expect(parseResponse(Buffer.from([1, 2, 3]), '1.2.3.4')).toEqual([]);
    expect(parseResponse(Buffer.alloc(40, 0xff), '1.2.3.4')).toEqual([]);
  });
});

/** A receiver that remembers what it was told and lets the test say what it does next. */
function fakeReceiver() {
  const loads: LoadRequest[] = [];
  const calls: string[] = [];
  let status: ((s: MediaStatus) => void) | null = null;
  let ended: ((r: string) => void) | null = null;
  let failNext = false;
  const session: CastSession = {
    async load(req) {
      loads.push(req);
      if (failNext) {
        failNext = false;
        throw new Error('LOAD_FAILED');
      }
      return {
        mediaSessionId: 1,
        playerState: req.autoplay ? 'PLAYING' : 'PAUSED',
        currentTime: req.startAt,
        contentId: req.url,
      };
    },
    play: async () => void calls.push('play'),
    pause: async () => void calls.push('pause'),
    seek: async (s) => void calls.push(`seek ${s}`),
    setVolume: async (v) => void calls.push(`volume ${v}`),
    volume: () => 0.3,
    requestStatus: async () => {},
    stop: async () => void calls.push('stop'),
    close: () => void calls.push('close'),
    onStatus: (cb) => (status = cb),
    onEnded: (cb) => (ended = cb),
  };
  return {
    session,
    loads,
    calls,
    failNextLoad: () => (failNext = true),
    finish: () =>
      status!({
        mediaSessionId: 1,
        playerState: 'IDLE',
        idleReason: 'FINISHED',
        currentTime: 0,
        contentId: loads.at(-1)?.url,
      }),
    drop: () => ended!('gone'),
  };
}

function setup() {
  const rx = fakeReceiver();
  const reports: { userId: number; patch: Record<string, unknown> }[] = [];
  const stopped: number[] = [];
  const host: CastHost = {
    open: vi.fn(async () => rx.session),
    loadFor: (_u, base, t, o) => ({
      url: `${base}/s/${t.id}${o.transcode ? '?mp3' : ''}`,
      contentType: 'audio/flac',
      live: false,
      title: t.title,
      artist: t.artist,
      album: t.album,
      startAt: o.startAt,
      autoplay: o.autoplay,
      transcoded: o.transcode,
    }),
    report: (userId, _id, patch) => reports.push({ userId, patch }),
    stopped: (userId) => stopped.push(userId),
    radioTracks: () => [track(99)],
    baseUrl: () => 'http://server:4000',
    log: () => {},
  };
  const target: CastTarget = { info: { id: 'cast-tv', name: 'TV', kind: 'cast' }, host: '192.168.0.42', port: 8009 };
  const c = new CastController(target, host);
  const activate = async (
    userId: number,
    state: Partial<Parameters<typeof c.deliver>[1] & { type: 'activate' }>['state'],
    play = true
  ) => {
    c.deliver(userId, { type: 'activate', state: state ?? null, play });
    await flush();
    await flush();
  };
  return { rx, reports, stopped, host, c, activate };
}

const session = (over: Record<string, unknown> = {}) => ({
  queue: [track(1), track(2), track(3)],
  index: 0,
  isPlaying: true,
  shuffle: false,
  repeat: 'off' as const,
  volume: 1,
  radio: false,
  position: 42,
  ...over,
});

describe('cast controller', () => {
  it('takes the session over where it was, at the TV volume', async () => {
    const { rx, c, activate, reports } = setup();
    await activate(1, session());
    expect(rx.loads).toHaveLength(1);
    expect(rx.loads[0]).toMatchObject({ url: 'http://server:4000/s/1', startAt: 42, autoplay: true });
    expect(c.volume).toBe(0.3);
    expect(reports[0].patch).toMatchObject({ index: 0, volume: 0.3, isPlaying: true });
    expect(reports[0].patch.queue).toHaveLength(3);
  });

  it('moves on when a song finishes, and stops at the end of the queue', async () => {
    const { rx, c, activate } = setup();
    await activate(1, session({ index: 1 }));
    rx.finish();
    await flush();
    expect(c.index).toBe(2);
    expect(rx.loads.at(-1)?.url).toMatch(/\/s\/3$/);
    rx.finish();
    await flush();
    expect(c.isPlaying).toBe(false);
    expect(rx.loads).toHaveLength(2);
  });

  it('repeat one plays the song again; repeat all wraps around', async () => {
    const { rx, c, activate } = setup();
    await activate(1, session({ index: 2, repeat: 'one' }));
    rx.finish();
    await flush();
    expect(c.index).toBe(2);
    expect(rx.loads).toHaveLength(2);
    c.repeat = 'all';
    rx.finish();
    await flush();
    expect(c.index).toBe(0);
  });

  it('retries a song the receiver cannot decode as MP3', async () => {
    const { rx, activate } = setup();
    rx.failNextLoad();
    await activate(1, session());
    await flush();
    expect(rx.loads.map((l) => l.url)).toEqual(['http://server:4000/s/1', 'http://server:4000/s/1?mp3']);
  });

  it('follows remote commands: next, pause, seek, volume', async () => {
    const { rx, c, activate } = setup();
    await activate(1, session());
    c.deliver(1, { type: 'command', cmd: { type: 'sync', patch: { index: 1, isPlaying: true } } });
    await flush();
    expect(rx.loads.at(-1)?.url).toMatch(/\/s\/2$/);
    c.deliver(1, { type: 'command', cmd: { type: 'sync', patch: { isPlaying: false } } });
    c.deliver(1, { type: 'command', cmd: { type: 'seek', position: 30 } });
    c.deliver(1, { type: 'command', cmd: { type: 'sync', patch: { volume: 0.5 } } });
    await flush();
    expect(rx.calls).toEqual(['pause', 'seek 30', 'volume 0.5']);
    // someone else's commands don't count
    c.deliver(2, { type: 'command', cmd: { type: 'sync', patch: { isPlaying: true } } });
    await flush();
    expect(rx.calls).not.toContain('play');
  });

  it('radio adds similar songs when the last one starts', async () => {
    const { c, activate } = setup();
    await activate(1, session({ queue: [track(1)], radio: true, position: 0 }));
    expect(c.queue.map((t) => t.id)).toEqual([1, 99]);
  });

  it('frees the TV when playback moves elsewhere, and tells the hub when the TV is lost', async () => {
    const { rx, c, activate, stopped } = setup();
    await activate(1, session());
    c.deliver(1, { type: 'release' });
    await flush();
    expect(rx.calls).toContain('stop');
    expect(c.owner).toBeNull();
    await activate(1, session());
    rx.drop();
    expect(stopped).toEqual([1]);
  });

  it('a second user taking the TV ends the first user’s session', async () => {
    const { c, activate, stopped } = setup();
    await activate(1, session());
    await activate(2, session());
    expect(stopped).toEqual([1]);
    expect(c.owner).toBe(2);
  });
});

describe('devices hub with a Chromecast', () => {
  beforeEach(() => resetDevices());

  it('lists the receiver, hands it the session, and routes commands and state', () => {
    const got: { userId: number; e: DeviceEvent }[] = [];
    setExternalDevices(() => [
      { info: { id: 'cast-tv', name: 'TV', kind: 'cast' }, deliver: (userId, e) => got.push({ userId, e }) },
    ]);
    const events: DeviceEvent[] = [];
    connectDevice(
      1,
      { id: 'page-a', name: 'A', kind: 'computer' },
      (e) => events.push(e),
      () => {}
    );
    const devices = events.filter((e) => e.type === 'devices').at(-1);
    expect(devices && 'devices' in devices && devices.devices.map((d) => d.id)).toEqual(['page-a', 'cast-tv']);

    reportState(1, 'page-a', session(), true);
    expect(transfer(1, 'page-a', 'cast-tv', session({ position: 50 }))).toBe(true);
    expect(got.at(-1)).toMatchObject({ userId: 1, e: { type: 'activate', play: true, state: { position: 50 } } });
    expect(events.filter((e) => e.type === 'release')).toHaveLength(1);

    expect(sendCommand(1, 'page-a', { type: 'seek', position: 10 })).toBe(true);
    expect(got.at(-1)?.e).toEqual({ type: 'command', cmd: { type: 'seek', position: 10 } });

    expect(externalState(1, 'cast-tv', { index: 1, isPlaying: true, position: 3 })).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'state', state: { index: 1 } });

    externalStopped(1, 'cast-tv');
    const last = events.filter((e) => e.type === 'devices').at(-1);
    expect(last && 'activeId' in last && last.activeId).toBeNull();
  });
});
