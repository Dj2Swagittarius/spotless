import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanDevice,
  cleanPatch,
  connectDevice,
  renameDevice,
  reportState,
  resetDevices,
  sendCommand,
  transfer,
  type DeviceEvent,
} from '../devices';
import type { Track } from '../types';

const track = (id: number) => ({ id, title: `t${id}`, duration: 200 }) as unknown as Track;

function device(userId: number, id: string, name = id) {
  const events: DeviceEvent[] = [];
  const close = vi.fn();
  const disconnect = connectDevice(userId, { id, name, kind: 'computer' }, (e) => events.push(e), close);
  const last = <T extends DeviceEvent['type']>(type: T) =>
    events.filter((e): e is Extract<DeviceEvent, { type: T }> => e.type === type).at(-1);
  return { events, close, disconnect, last };
}

const playing = { queue: [track(1), track(2)], index: 0, isPlaying: true, shuffle: false, repeat: 'off' as const, volume: 1, radio: false, position: 10 };

beforeEach(() => resetDevices());
afterEach(() => vi.useRealTimers());

describe('devices hub', () => {
  it('lists every open device of the user, and only that user', () => {
    const a = device(1, 'device-a');
    device(1, 'device-b');
    device(2, 'device-c');
    expect(a.last('devices')?.devices.map((d) => d.id)).toEqual(['device-a', 'device-b']);
  });

  it('a device that starts playing claims playback and the others follow its state', () => {
    const a = device(1, 'device-a');
    const b = device(1, 'device-b');
    expect(reportState(1, 'device-a', playing, false)).toBe(false); // no claim, not active
    expect(reportState(1, 'device-a', playing, true)).toBe(true);
    expect(b.last('devices')?.activeId).toBe('device-a');
    expect(b.last('state')?.state.queue).toHaveLength(2);
    // a later report without the queue does not resend it
    reportState(1, 'device-a', { index: 1, isPlaying: true, position: 0 }, false);
    expect(b.last('state')?.state.queue).toBeUndefined();
    expect(b.last('state')?.state.index).toBe(1);
    expect(a.last('release')).toBeUndefined();
  });

  it('the last device to press play wins', () => {
    const a = device(1, 'device-a');
    device(1, 'device-b');
    reportState(1, 'device-a', playing, true);
    reportState(1, 'device-b', playing, true);
    expect(a.last('release')).toBeDefined();
    expect(a.last('devices')?.activeId).toBe('device-b');
  });

  it('forwards remote commands to the active device only', () => {
    const a = device(1, 'device-a');
    const b = device(1, 'device-b');
    expect(sendCommand(1, 'device-b', { type: 'seek', position: 5 })).toBe(false); // nobody active
    reportState(1, 'device-a', playing, true);
    expect(sendCommand(1, 'device-b', { type: 'seek', position: 5 })).toBe(true);
    expect(a.last('command')?.cmd).toEqual({ type: 'seek', position: 5 });
    expect(b.last('command')).toBeUndefined();
  });

  it('transfers the session to another device and stops the old one', () => {
    const a = device(1, 'device-a');
    const b = device(1, 'device-b');
    reportState(1, 'device-a', playing, true);
    expect(transfer(1, 'device-a', 'device-b', { ...playing, position: 42 })).toBe(true);
    expect(a.last('release')).toBeDefined();
    const act = b.last('activate');
    expect(act?.play).toBe(true);
    expect(act?.state?.queue).toHaveLength(2);
    expect(act?.state?.position).toBeGreaterThanOrEqual(42);
    expect(b.last('devices')?.activeId).toBe('device-b');
    // a report from the released device that was already in flight can't take it back
    expect(reportState(1, 'device-a', playing, true)).toBe(false);
  });

  it('lets the active device go after it has been gone for a while', () => {
    vi.useFakeTimers();
    const a = device(1, 'device-a');
    const b = device(1, 'device-b');
    reportState(1, 'device-a', playing, true);
    a.disconnect();
    expect(b.last('devices')?.activeId).toBe('device-a'); // a reload gets a grace period
    vi.advanceTimersByTime(20_000);
    expect(b.last('devices')?.activeId).toBeNull();
    expect(b.last('state')?.state.isPlaying).toBe(false);
  });

  it('keeps the active device across a quick reconnect', () => {
    vi.useFakeTimers();
    const a = device(1, 'device-a');
    const b = device(1, 'device-b');
    reportState(1, 'device-a', playing, true);
    a.disconnect();
    device(1, 'device-a');
    vi.advanceTimersByTime(20_000);
    expect(b.last('devices')?.activeId).toBe('device-a');
  });

  it('a second connection with the same id replaces the first', () => {
    const first = device(1, 'device-a');
    device(1, 'device-a');
    expect(first.last('replaced')).toBeDefined();
    expect(first.close).toHaveBeenCalled();
  });

  it('renames a device for everyone', () => {
    device(1, 'device-a');
    const b = device(1, 'device-b');
    expect(renameDevice(1, 'device-a', '  Living room  ')).toBe(true);
    expect(b.last('devices')?.devices.find((d) => d.id === 'device-a')?.name).toBe('Living room');
  });
});

describe('input cleaning', () => {
  it('rejects bad device ids and defaults the rest', () => {
    expect(cleanDevice({ id: 'x' })).toBeNull();
    expect(cleanDevice({ id: '../../etc' })).toBeNull();
    expect(cleanDevice({ id: 'abcdef123', kind: 'toaster' })).toEqual({ id: 'abcdef123', name: 'Unnamed device', kind: 'computer' });
  });

  it('keeps only well-formed snapshot fields', () => {
    expect(cleanPatch({ index: 1.5, volume: 7, repeat: 'sometimes', queue: [{ id: 3 }, 'junk', null], position: -4 })).toEqual({
      volume: 1,
      queue: [{ id: 3 }],
      position: 0,
    });
  });
});
