import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NativeBridge, NativeCommand, NativeEvent } from '@/lib/client/nativeBridge';
import { connectNative, nativeBridge, startNativeSync, useNative } from '@/lib/client/nativeSync';
import { usePlayer } from '@/store/player';
import type { Track } from '@/lib/types';

const t = (id: number): Track => ({
  id,
  title: `t${id}`,
  artist: 'a',
  artistId: 1,
  album: 'al',
  albumId: 1,
  duration: 200,
  trackNo: 1,
  discNo: 1,
  genre: null,
});

function fakeBridge() {
  const sent: NativeCommand[] = [];
  const listeners = new Set<(e: NativeEvent) => void>();
  const bridge: NativeBridge = {
    appVersion: '0.3.1',
    caps: [],
    send: (c) => {
      sent.push(c);
    },
    on: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
  const emit = (e: NativeEvent) => listeners.forEach((l) => l(e));
  return { bridge, sent, emit };
}

const emptyQueue: NativeEvent = {
  type: 'queue',
  tracks: [],
  index: -1,
  queueVersion: 0,
  positionMs: 0,
  isPlaying: false,
};

describe('nativeSync', () => {
  let stop: () => void = () => {};

  beforeEach(() => {
    usePlayer.setState({
      queue: [],
      originalQueue: [],
      index: -1,
      isPlaying: false,
      repeat: 'off',
      volume: 1,
      duck: 1,
      shuffle: false,
      radio: false,
    });
  });
  afterEach(() => stop());

  it('asks for native state first and sends nothing else until it answers', () => {
    const { bridge, sent } = fakeBridge();
    stop = startNativeSync(bridge);
    usePlayer.getState().playQueue([t(1)]);
    expect(sent).toEqual([{ type: 'getState' }]);
    expect(useNative.getState().active).toBe(true);
    expect(nativeBridge()).toBe(bridge);
  });

  it('adopts the native queue when native has one', () => {
    const { bridge, sent, emit } = fakeBridge();
    usePlayer.setState({ queue: [t(9)], index: 0 });
    stop = startNativeSync(bridge);
    emit({ type: 'queue', tracks: [t(1), t(2)], index: 1, queueVersion: 3, positionMs: 5000, isPlaying: true });
    const s = usePlayer.getState();
    expect(s.queue.map((x) => x.id)).toEqual([1, 2]);
    expect(s.index).toBe(1);
    expect(s.isPlaying).toBe(true);
    expect(sent.some((c) => c.type === 'setQueue')).toBe(false);
    expect(useNative.getState().positionMs).toBe(5000);
  });

  it('keeps the pre-shuffle order while native holds the same tracks, else replaces it', () => {
    const { bridge, emit } = fakeBridge();
    usePlayer.setState({ queue: [t(3), t(1), t(2)], originalQueue: [t(1), t(2), t(3)], index: 0 });
    stop = startNativeSync(bridge);
    emit({ type: 'queue', tracks: [t(3), t(1), t(2)], index: 0, queueVersion: 1, positionMs: 0, isPlaying: false });
    expect(usePlayer.getState().originalQueue.map((x) => x.id)).toEqual([1, 2, 3]);
    expect(usePlayer.getState().queue.map((x) => x.id)).toEqual([3, 1, 2]);

    // a queue with different tracks (same length) is a new queue: its own order becomes the original
    emit({ type: 'queue', tracks: [t(7), t(1), t(2)], index: 0, queueVersion: 2, positionMs: 0, isPlaying: false });
    expect(usePlayer.getState().originalQueue.map((x) => x.id)).toEqual([7, 1, 2]);

    // a different length replaces it too
    emit({ type: 'queue', tracks: [t(7), t(1)], index: 0, queueVersion: 3, positionMs: 0, isPlaying: false });
    expect(usePlayer.getState().originalQueue.map((x) => x.id)).toEqual([7, 1]);
  });

  it('pushes the restored queue, paused, when native is empty', () => {
    const { bridge, sent, emit } = fakeBridge();
    usePlayer.setState({ queue: [t(9)], index: 0, repeat: 'all', volume: 0.5 });
    stop = startNativeSync(bridge);
    emit(emptyQueue);
    expect(sent).toContainEqual({
      type: 'setQueue',
      tracks: [t(9)],
      index: 0,
      positionMs: 0,
      play: false,
      baseVersion: 0,
    });
    expect(sent).toContainEqual({ type: 'setRepeat', mode: 'all' });
    expect(sent).toContainEqual({ type: 'setVolume', value: 0.5 });
  });

  it('forwards store actions', () => {
    const { bridge, sent, emit } = fakeBridge();
    stop = startNativeSync(bridge);
    emit(emptyQueue);
    sent.length = 0;
    usePlayer.getState().playQueue([t(1), t(2), t(3)], 0);
    expect(sent.at(-1)).toEqual({
      type: 'setQueue',
      tracks: [t(1), t(2), t(3)],
      index: 0,
      positionMs: 0,
      play: true,
      baseVersion: 0,
    });
    usePlayer.getState().appendTracks([t(4)]);
    expect(sent.at(-1)).toMatchObject({ type: 'syncQueue', index: 0, baseVersion: 0 });
    usePlayer.getState().jumpTo(2);
    expect(sent).toContainEqual({ type: 'jumpTo', index: 2 });
    usePlayer.getState().toggle();
    expect(sent.at(-1)).toEqual({ type: 'pause' });
    usePlayer.getState().cycleRepeat();
    expect(sent.at(-1)).toEqual({ type: 'setRepeat', mode: 'all' });
  });

  it('applies native state without echoing it back', () => {
    const { bridge, sent, emit } = fakeBridge();
    stop = startNativeSync(bridge);
    emit(emptyQueue);
    usePlayer.getState().playQueue([t(1), t(2)], 0);
    sent.length = 0;
    emit({
      type: 'state',
      isPlaying: true,
      index: 1,
      positionMs: 1000,
      durationMs: 200000,
      buffering: false,
      queueVersion: 0,
      sleepUntil: 123,
    });
    expect(usePlayer.getState().index).toBe(1);
    expect(sent).toEqual([]);
    expect(useNative.getState()).toMatchObject({ positionMs: 1000, durationMs: 200000, sleepUntil: 123 });
  });

  it('takes the queue native sends and carries its version into the next sync', () => {
    const { bridge, sent, emit } = fakeBridge();
    stop = startNativeSync(bridge);
    emit(emptyQueue);
    usePlayer.getState().playQueue([t(1)], 0);
    emit({ type: 'queue', tracks: [t(7), t(8)], index: 0, queueVersion: 1, positionMs: 0, isPlaying: true });
    expect(usePlayer.getState().queue.map((x) => x.id)).toEqual([7, 8]);
    usePlayer.getState().appendTracks([t(9)]);
    expect(sent.at(-1)).toMatchObject({ type: 'syncQueue', baseVersion: 1 });
  });

  it('does not trust a state from a newer queue version; it asks for the queue once', () => {
    const { bridge, sent, emit } = fakeBridge();
    stop = startNativeSync(bridge);
    emit(emptyQueue);
    usePlayer.getState().playQueue([t(1), t(2)], 0);
    sent.length = 0;
    const newer = (index: number, queueVersion = 1): NativeEvent => ({
      type: 'state',
      isPlaying: true,
      index,
      positionMs: 2000,
      durationMs: 200000,
      buffering: false,
      queueVersion,
    });
    emit(newer(1));
    emit(newer(1));
    expect(usePlayer.getState().index).toBe(0);
    expect(sent).toEqual([{ type: 'getState' }]);
    expect(useNative.getState().positionMs).toBe(2000);
    emit({ type: 'queue', tracks: [t(7), t(8)], index: 1, queueVersion: 1, positionMs: 2000, isPlaying: true });
    expect(usePlayer.getState().queue.map((x) => x.id)).toEqual([7, 8]);
    expect(usePlayer.getState().index).toBe(1);
    sent.length = 0;
    usePlayer.getState().appendTracks([t(9)]);
    expect(sent.at(-1)).toMatchObject({ type: 'syncQueue', baseVersion: 1 });
    // a later mismatch can ask again
    emit(newer(0, 2));
    expect(sent.at(-1)).toEqual({ type: 'getState' });
  });

  it('resumes the same song in place when playQueue re-plays it from paused', () => {
    const { bridge, sent, emit } = fakeBridge();
    stop = startNativeSync(bridge);
    emit({ type: 'queue', tracks: [t(1), t(2)], index: 0, queueVersion: 0, positionMs: 4000, isPlaying: false });
    sent.length = 0;
    usePlayer.getState().playQueue([t(1), t(2), t(3)], 0);
    expect(sent.some((c) => c.type === 'setQueue')).toBe(false);
    expect(sent).toEqual([
      { type: 'syncQueue', tracks: [t(1), t(2), t(3)], index: 0, baseVersion: 0 },
      { type: 'play' },
    ]);
  });

  it('stops cleanly', () => {
    const { bridge } = fakeBridge();
    stop = startNativeSync(bridge);
    stop();
    expect(useNative.getState().active).toBe(false);
    expect(nativeBridge()).toBeNull();
  });

  it('connectNative does nothing without an injected port', () => {
    const stopFn = connectNative();
    expect(typeof stopFn).toBe('function');
    expect(() => stopFn()).not.toThrow();
    expect(useNative.getState().active).toBe(false);
  });
});
