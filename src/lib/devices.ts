import type { Track } from './types';

/**
 * "Play on" (device handoff). Every open Spotless page is a device of the signed-in user, connected
 * over a server-sent event stream. At most one device per user is *active*: it owns the audio and
 * reports its playback state here; every other device of that user mirrors that state and turns its
 * controls into commands sent to the active one. Transferring moves the session (queue, position,
 * settings) to another device.
 *
 * Everything lives in memory: a device is only a device while its page is open, and a restart just
 * means the pages reconnect and the next one to press play becomes active again.
 */

export type DeviceKind = 'computer' | 'phone' | 'tv';

export interface DeviceInfo {
  id: string;
  name: string;
  kind: DeviceKind;
}

export type Repeat = 'off' | 'all' | 'one';

/** What a device is playing. `queue` is left out of updates that did not change it. */
export interface PlaybackSnapshot {
  queue?: Track[];
  index: number;
  isPlaying: boolean;
  shuffle: boolean;
  repeat: Repeat;
  volume: number;
  radio: boolean;
  /** seconds into the current track, as of when the snapshot was sent */
  position: number;
}

/** Commands a remote sends to the active device. */
export type RemoteCommand =
  | { type: 'sync'; patch: Partial<Omit<PlaybackSnapshot, 'position'>> }
  | { type: 'seek'; position: number }
  | { type: 'toggleShuffle' };

export type DeviceEvent =
  | { type: 'devices'; devices: DeviceInfo[]; activeId: string | null; activeName: string | null }
  | { type: 'state'; state: PlaybackSnapshot }
  | { type: 'command'; cmd: RemoteCommand }
  | { type: 'activate'; state: PlaybackSnapshot | null; play: boolean }
  | { type: 'release' }
  | { type: 'replaced' };

interface Conn {
  device: DeviceInfo;
  send: (e: DeviceEvent) => void;
  close: () => void;
}

interface UserHub {
  conns: Map<string, Conn>;
  activeId: string | null;
  activeName: string | null;
  /** last full state of the active device; position is as of `positionAt` */
  state: (PlaybackSnapshot & { queue: Track[] }) | null;
  positionAt: number;
  /** pending "the active device is gone for good" timer */
  dropTimer: ReturnType<typeof setTimeout> | null;
  /** when each device was last told to stop, so a state report already in flight can't re-claim */
  releasedAt: Map<string, number>;
}

// A page reload or a short network blip reconnects within this; longer and the session is let go,
// so the remotes stop showing "playing on" a device that is not coming back.
const ACTIVE_GRACE_MS = 15_000;
const MAX_QUEUE = 5000;
// A device that was just told to stop may still have a "playing" report on the way; it can't claim
// playback back for this long.
const RELEASE_HOLD_MS = 3000;

// Route modules can be evaluated more than once per process (dev HMR, separate server chunks); the
// hub must be one map for all of them.
const g = globalThis as typeof globalThis & { __spotlessDevicesV1?: Map<number, UserHub> };
const hubs = (g.__spotlessDevicesV1 ??= new Map());

function hubFor(userId: number): UserHub {
  let hub = hubs.get(userId);
  if (!hub) {
    hub = { conns: new Map(), activeId: null, activeName: null, state: null, positionAt: 0, dropTimer: null, releasedAt: new Map() };
    hubs.set(userId, hub);
  }
  return hub;
}

function currentState(hub: UserHub): PlaybackSnapshot | null {
  const s = hub.state;
  if (!s) return null;
  const elapsed = s.isPlaying ? (Date.now() - hub.positionAt) / 1000 : 0;
  return { ...s, position: s.position + elapsed };
}

function devicesEvent(hub: UserHub): DeviceEvent {
  return {
    type: 'devices',
    devices: [...hub.conns.values()].map((c) => c.device),
    activeId: hub.activeId,
    activeName: hub.activeName,
  };
}

function broadcast(hub: UserHub, e: DeviceEvent, except?: string) {
  for (const [id, c] of hub.conns) if (id !== except) c.send(e);
}

function release(hub: UserHub, id: string | null) {
  if (!id) return;
  hub.releasedAt.set(id, Date.now());
  hub.conns.get(id)?.send({ type: 'release' });
}

function setActive(hub: UserHub, id: string | null) {
  if (hub.dropTimer) clearTimeout(hub.dropTimer);
  hub.dropTimer = null;
  hub.activeId = id;
  hub.activeName = id ? (hub.conns.get(id)?.device.name ?? hub.activeName) : null;
}

export function cleanDevice(raw: { id?: unknown; name?: unknown; kind?: unknown }): DeviceInfo | null {
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return null;
  const name = (typeof raw.name === 'string' ? raw.name.trim() : '').slice(0, 60) || 'Unnamed device';
  const kind: DeviceKind = raw.kind === 'tv' || raw.kind === 'phone' ? raw.kind : 'computer';
  return { id, name, kind };
}

function cleanTrack(t: unknown): t is Track {
  return !!t && typeof t === 'object' && typeof (t as Track).id === 'number';
}

/** Validate an untrusted (partial) snapshot; fields that are missing or wrong are left out. */
export function cleanPatch(raw: unknown): Partial<PlaybackSnapshot> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<PlaybackSnapshot> = {};
  if (Array.isArray(r.queue)) out.queue = r.queue.filter(cleanTrack).slice(0, MAX_QUEUE);
  if (Number.isInteger(r.index)) out.index = r.index as number;
  if (typeof r.isPlaying === 'boolean') out.isPlaying = r.isPlaying;
  if (typeof r.shuffle === 'boolean') out.shuffle = r.shuffle;
  if (r.repeat === 'off' || r.repeat === 'all' || r.repeat === 'one') out.repeat = r.repeat;
  if (typeof r.volume === 'number' && Number.isFinite(r.volume)) out.volume = Math.max(0, Math.min(1, r.volume));
  if (typeof r.radio === 'boolean') out.radio = r.radio;
  if (typeof r.position === 'number' && Number.isFinite(r.position)) out.position = Math.max(0, r.position);
  return out;
}

function mergeState(hub: UserHub, patch: Partial<PlaybackSnapshot>) {
  const base = currentState(hub);
  hub.state = {
    queue: patch.queue ?? hub.state?.queue ?? [],
    index: patch.index ?? base?.index ?? -1,
    isPlaying: patch.isPlaying ?? base?.isPlaying ?? false,
    shuffle: patch.shuffle ?? base?.shuffle ?? false,
    repeat: patch.repeat ?? base?.repeat ?? 'off',
    volume: patch.volume ?? base?.volume ?? 1,
    radio: patch.radio ?? base?.radio ?? false,
    position: patch.position ?? base?.position ?? 0,
  };
  hub.positionAt = Date.now();
}

/** A device's event stream opened. Returns the function to call when it closes. */
export function connectDevice(userId: number, device: DeviceInfo, send: Conn['send'], close: Conn['close']): () => void {
  const hub = hubFor(userId);
  const old = hub.conns.get(device.id);
  if (old) {
    // the same id from a second tab (a duplicated tab copies sessionStorage): the newcomer takes it
    old.send({ type: 'replaced' });
    old.close();
  }
  const conn: Conn = { device, send, close };
  hub.conns.set(device.id, conn);
  if (hub.activeId === device.id) setActive(hub, device.id); // back within the grace period
  send(devicesEvent(hub));
  const state = currentState(hub);
  if (state) send({ type: 'state', state });
  broadcast(hub, devicesEvent(hub), device.id);

  return () => {
    if (hub.conns.get(device.id) !== conn) return; // already replaced
    hub.conns.delete(device.id);
    hub.releasedAt.delete(device.id);
    if (hub.activeId === device.id && !hub.dropTimer) {
      hub.dropTimer = setTimeout(() => {
        hub.dropTimer = null;
        if (hub.activeId !== device.id || hub.conns.has(device.id)) return;
        setActive(hub, null);
        if (hub.state) {
          mergeState(hub, { isPlaying: false });
          broadcast(hub, { type: 'state', state: currentState(hub)! });
        }
        broadcast(hub, devicesEvent(hub));
      }, ACTIVE_GRACE_MS);
    }
    broadcast(hub, devicesEvent(hub));
  };
}

/**
 * Playback state from a device. Only the active device's reports count, except a `claim`: a device
 * that started playing by itself takes over (the last one to press play wins) and the previous active
 * device is told to stop.
 */
export function reportState(userId: number, from: string, patch: Partial<PlaybackSnapshot>, claim: boolean): boolean {
  const hub = hubFor(userId);
  if (!hub.conns.has(from)) return false;
  if (hub.activeId !== from) {
    if (!claim || Date.now() - (hub.releasedAt.get(from) ?? 0) < RELEASE_HOLD_MS) return false;
    const prev = hub.activeId;
    setActive(hub, from);
    release(hub, prev);
    broadcast(hub, devicesEvent(hub));
  }
  mergeState(hub, patch);
  const { queue, ...rest } = currentState(hub)!;
  // the queue only travels when it changed; the rest is small enough to send every time
  broadcast(hub, { type: 'state', state: patch.queue ? { ...rest, queue } : rest }, from);
  return true;
}

/** Forward a remote's command to the active device. */
export function sendCommand(userId: number, from: string, cmd: RemoteCommand): boolean {
  const hub = hubFor(userId);
  if (!hub.conns.has(from) || !hub.activeId || hub.activeId === from) return false;
  const target = hub.conns.get(hub.activeId);
  if (!target) return false;
  target.send({ type: 'command', cmd });
  return true;
}

/** Move playback to device `to`. A transfer from the active device carries its latest state along. */
export function transfer(userId: number, from: string, to: string, patch: Partial<PlaybackSnapshot> | null): boolean {
  const hub = hubFor(userId);
  const target = hub.conns.get(to);
  if (!target || !hub.conns.has(from)) return false;
  if (hub.activeId === to) return true;
  if (patch && (hub.activeId === from || !hub.activeId)) mergeState(hub, patch);
  const prev = hub.activeId;
  setActive(hub, to);
  hub.releasedAt.delete(to);
  release(hub, prev);
  target.send({ type: 'activate', state: currentState(hub), play: true });
  broadcast(hub, devicesEvent(hub));
  return true;
}

export function renameDevice(userId: number, id: string, name: string): boolean {
  const hub = hubFor(userId);
  const conn = hub.conns.get(id);
  const clean = cleanDevice({ ...conn?.device, name });
  if (!conn || !clean) return false;
  conn.device = clean;
  if (hub.activeId === id) hub.activeName = clean.name;
  broadcast(hub, devicesEvent(hub));
  return true;
}

/** Test hook: forget every device. */
export function resetDevices() {
  for (const hub of hubs.values()) if (hub.dropTimer) clearTimeout(hub.dropTimer);
  hubs.clear();
}
