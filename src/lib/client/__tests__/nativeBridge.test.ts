import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connect, type NativeEvent, type NativePort } from '@/lib/client/nativeBridge';

function fakePort() {
  const sent: string[] = [];
  let listener: ((e: { data: unknown }) => void) | null = null;
  const port: NativePort = {
    postMessage: (m) => {
      sent.push(m);
    },
    addEventListener: (_type, l) => {
      listener = l;
    },
  };
  const reply = (msg: unknown) => listener?.({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) });
  return { port, sent, reply };
}

describe('nativeBridge.connect', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('says hello and resolves on a supported version', async () => {
    const { port, sent, reply } = fakePort();
    const pending = connect(port);
    expect(JSON.parse(sent[0])).toEqual({ type: 'hello' });
    reply({ type: 'hello', bridgeVersion: 1, appVersion: '0.3.1', caps: ['eq'] });
    const bridge = await pending;
    expect(bridge?.appVersion).toBe('0.3.1');
    expect(bridge?.caps).toEqual(['eq']);
  });

  it('refuses an unknown bridge version', async () => {
    const { port, reply } = fakePort();
    const pending = connect(port);
    reply({ type: 'hello', bridgeVersion: 2, appVersion: '9.0.0', caps: [] });
    expect(await pending).toBeNull();
  });

  it('gives up when nothing answers', async () => {
    const { port } = fakePort();
    const pending = connect(port, 500);
    vi.advanceTimersByTime(500);
    expect(await pending).toBeNull();
  });

  it('delivers events after the handshake and ignores junk', async () => {
    const { port, reply, sent } = fakePort();
    const pending = connect(port);
    reply({ type: 'hello', bridgeVersion: 1, appVersion: '0.3.1', caps: [] });
    const bridge = (await pending)!;
    const seen: NativeEvent[] = [];
    const off = bridge.on((e) => seen.push(e));
    reply('not json');
    reply({ nope: true });
    reply({ type: 'authLost' });
    off();
    reply({ type: 'authLost' });
    expect(seen).toEqual([{ type: 'authLost' }]);
    bridge.send({ type: 'play' });
    expect(JSON.parse(sent.at(-1)!)).toEqual({ type: 'play' });
  });
});
