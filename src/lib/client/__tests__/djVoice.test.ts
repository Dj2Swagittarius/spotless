import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NativeBridge, NativeCommand, NativeEvent } from '@/lib/client/nativeBridge';
import { startNativeSync } from '@/lib/client/nativeSync';
import { bytesToBase64, speak } from '@/lib/client/djVoice';
import { usePlayer } from '@/store/player';

function answeringBridge() {
  const sent: NativeCommand[] = [];
  const listeners = new Set<(e: NativeEvent) => void>();
  const bridge: NativeBridge = {
    appVersion: '0.3.1',
    caps: [],
    send: (c) => {
      sent.push(c);
      // the app plays the clip and reports when it is done
      if (c.type === 'speak')
        queueMicrotask(() => listeners.forEach((l) => l({ type: 'speaking', id: c.id, active: false })));
    },
    on: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
  return { bridge, sent };
}

describe('djVoice in the Android app', () => {
  let stop: () => void = () => {};
  afterEach(() => {
    stop();
    vi.unstubAllGlobals();
  });

  it('base64-encodes bytes', () => {
    expect(bytesToBase64(new Uint8Array([1, 2, 3]))).toBe('AQID');
    expect(bytesToBase64(new Uint8Array(70000).fill(65)).length).toBe(93336);
  });

  it('hands server voice clips to native and does not duck in JS', async () => {
    const { bridge, sent } = answeringBridge();
    stop = startNativeSync(bridge);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } }))
    );
    await speak('hello there');
    const cmd = sent.find((c) => c.type === 'speak');
    expect(cmd).toMatchObject({ type: 'speak', audio: 'AQID', mime: 'audio/mpeg' });
    expect(usePlayer.getState().duck).toBe(1);
  });

  it('routes browser-voice mode to the device voice', async () => {
    const { bridge, sent } = answeringBridge();
    stop = startNativeSync(bridge);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ browser: true }))
    );
    await speak('hi');
    expect(sent.find((c) => c.type === 'speak')).toMatchObject({ type: 'speak', text: 'hi' });
  });
});
