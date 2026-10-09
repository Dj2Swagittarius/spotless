import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCoalescingStorage, usePlayer } from '@/store/player';
import type { Track } from '@/lib/types';

const DELAY = 500;

function memoryBacking() {
  const map = new Map<string, string>();
  const write = vi.fn((k: string, v: string) => {
    map.set(k, v);
  });
  const remove = vi.fn((k: string) => {
    map.delete(k);
  });
  const read = vi.fn((k: string) => map.get(k) ?? null);
  return { map, read, write, remove };
}

describe('createCoalescingStorage', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes once per delay window, with the newest value', () => {
    const b = memoryBacking();
    const storage = createCoalescingStorage<{ volume: number }>({ ...b, delayMs: DELAY });
    for (let i = 1; i <= 50; i++) storage.setItem('k', { state: { volume: i / 100 }, version: 1 });
    expect(b.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DELAY - 1);
    expect(b.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(b.write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(b.map.get('k')!)).toEqual({ state: { volume: 0.5 }, version: 1 });
  });

  it('drops writes while canWrite is false', () => {
    const b = memoryBacking();
    let hydrated = false;
    const storage = createCoalescingStorage<{ n: number }>({ ...b, delayMs: DELAY, canWrite: () => hydrated });
    storage.setItem('k', { state: { n: 1 }, version: 1 });
    vi.advanceTimersByTime(DELAY * 2);
    expect(b.write).not.toHaveBeenCalled();
    hydrated = true;
    storage.setItem('k', { state: { n: 2 }, version: 1 });
    vi.advanceTimersByTime(DELAY);
    expect(b.write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(b.map.get('k')!).state).toEqual({ n: 2 });
  });

  it('flush writes the pending value immediately and only once', () => {
    const b = memoryBacking();
    const storage = createCoalescingStorage<{ n: number }>({ ...b, delayMs: DELAY });
    storage.setItem('k', { state: { n: 1 }, version: 1 });
    storage.flush();
    expect(b.write).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DELAY * 2);
    expect(b.write).toHaveBeenCalledTimes(1);
    storage.flush(); // nothing pending: no-op
    expect(b.write).toHaveBeenCalledTimes(1);
  });

  it('removeItem discards a pending write for that key', () => {
    const b = memoryBacking();
    const storage = createCoalescingStorage<{ n: number }>({ ...b, delayMs: DELAY });
    storage.setItem('k', { state: { n: 1 }, version: 1 });
    storage.removeItem('k');
    vi.advanceTimersByTime(DELAY);
    expect(b.remove).toHaveBeenCalledWith('k');
    expect(b.write).not.toHaveBeenCalled();
  });

  it('getItem parses what was saved and reads garbage or a blocked store as nothing', () => {
    const b = memoryBacking();
    const storage = createCoalescingStorage<{ n: number }>({ ...b, delayMs: DELAY });
    expect(storage.getItem('k')).toBeNull();
    b.map.set('k', JSON.stringify({ state: { n: 3 }, version: 1 }));
    expect(storage.getItem('k')).toEqual({ state: { n: 3 }, version: 1 });
    b.map.set('k', '{not json');
    expect(storage.getItem('k')).toBeNull();
    const blocked = createCoalescingStorage<{ n: number }>({
      ...b,
      delayMs: DELAY,
      read: () => {
        throw new Error('SecurityError');
      },
    });
    expect(blocked.getItem('k')).toBeNull();
  });

  it('swallows write failures (quota, private mode)', () => {
    const storage = createCoalescingStorage<{ n: number }>({
      read: () => null,
      remove: () => {},
      write: () => {
        throw new Error('QuotaExceededError');
      },
      delayMs: DELAY,
    });
    storage.setItem('k', { state: { n: 1 }, version: 1 });
    expect(() => vi.advanceTimersByTime(DELAY)).not.toThrow();
  });
});

describe('usePlayer duck', () => {
  const track = { id: 1, title: 't', artist: 'a', album: 'b', albumId: 1, duration: 100 } as unknown as Track;

  it('defaults to 1 and is clamped to 0..1', () => {
    const s = usePlayer.getState();
    expect(s.duck).toBe(1);
    s.setDuck(0.3);
    expect(usePlayer.getState().duck).toBe(0.3);
    s.setDuck(1.5);
    expect(usePlayer.getState().duck).toBe(1);
    s.setDuck(-1);
    expect(usePlayer.getState().duck).toBe(0);
    s.setDuck(Number.NaN);
    expect(usePlayer.getState().duck).toBe(1);
  });

  it('is left out of the persisted slice, which keeps the real volume', () => {
    const { setVolume, setDuck } = usePlayer.getState();
    setVolume(0.8);
    setDuck(0.3);
    const partialize = usePlayer.persist.getOptions().partialize!;
    const saved = partialize({ ...usePlayer.getState(), queue: [track], index: 0 });
    expect(saved).not.toHaveProperty('duck');
    expect(saved.volume).toBe(0.8);
    expect(saved.queue).toEqual([track]);
    setDuck(1);
  });
});
