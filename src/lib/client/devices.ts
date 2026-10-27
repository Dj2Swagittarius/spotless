'use client';

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { usePlayer } from '@/store/player';
import type { DeviceEvent, DeviceInfo, DeviceKind, PlaybackSnapshot, RemoteCommand } from '@/lib/devices';
import { findPort } from './nativeBridge';
import { isTv } from './tvNav';

/**
 * "Play on": this page as one of the user's devices (see lib/devices for the server side).
 *
 * The player store stays the single source of what the UI shows. While another device is active this
 * page is a *remote*: the active device's state is mirrored into the store (without echoing it back),
 * local audio stays silent, and whatever the user does to the store is sent to the active device as a
 * command instead. While this page is active, or plays with nobody active, it reports its state so the
 * remotes can follow along.
 */

interface DevicesState {
  me: DeviceInfo | null;
  devices: DeviceInfo[];
  activeId: string | null;
  activeName: string | null;
  /** another device is playing: this page only controls it */
  remote: boolean;
  /** the active device's position (seconds) as last heard, and when (Date.now()) */
  position: number;
  positionAt: number;
}

export const useDevices = create<DevicesState>(() => ({
  me: null,
  devices: [],
  activeId: null,
  activeName: null,
  remote: false,
  position: 0,
  positionAt: 0,
}));

/** Live read for code outside React: is another device playing? */
export const isRemote = () => useDevices.getState().remote;

const ID_KEY = 'spotless-device-id';
const NAME_KEY = 'spotless-device-name';
// How often the active device repeats its position while playing, so remotes don't drift.
const HEARTBEAT_MS = 5000;
// Coalescing windows: a volume drag or a burst of store writes goes out as one request.
const REPORT_DELAY_MS = 150;
const COMMAND_DELAY_MS = 60;

type Snap = ReturnType<typeof usePlayer.getState>;

// --- local playback hooks, registered by the Player -------------------------------------------

let localPosition: () => number = () => 0;
let localSeek: (seconds: number) => void = () => {};

/** The Player tells us how to read and move the local playhead. */
export function registerLocalPlayback(getPosition: () => number, seek: (seconds: number) => void) {
  localPosition = getPosition;
  localSeek = seek;
}

// A handoff starts the incoming track part-way in; whoever loads that track takes the offset.
let pendingStart: { trackId: number; position: number } | null = null;

/** Seconds to start `trackId` at because playback was handed over mid-song (0 if not). */
export function takePendingStart(trackId: number): number {
  if (!pendingStart || pendingStart.trackId !== trackId) return 0;
  const { position } = pendingStart;
  pendingStart = null;
  return position;
}

// --- identity ---------------------------------------------------------------------------------

function newId(): string {
  let id = '';
  while (id.length < 16) id += Math.random().toString(36).slice(2);
  return id.slice(0, 16);
}

/** Per tab (sessionStorage): two tabs in one browser are two devices; a reload stays the same one. */
function loadId(fresh = false): string {
  try {
    const saved = sessionStorage.getItem(ID_KEY);
    if (saved && !fresh) return saved;
    const id = newId();
    sessionStorage.setItem(ID_KEY, id);
    return id;
  } catch {
    return newId();
  }
}

export function detectKind(ua: string): DeviceKind {
  if (isTv(ua)) return 'tv';
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) return 'phone';
  return 'computer';
}

export function defaultName(ua: string, nativeApp: boolean): string {
  if (isTv(ua)) return 'TV';
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /CrOS/.test(ua)
          ? 'Chromebook'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Windows/.test(ua)
              ? 'Windows'
              : /Linux/.test(ua)
                ? 'Linux'
                : 'Device';
  if (nativeApp) return `${os} app`;
  if (/Electron\//.test(ua)) return `${os} desktop app`;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  return `${browser} on ${os}`;
}

function loadDevice(fresh = false): DeviceInfo {
  const ua = navigator.userAgent;
  let name = '';
  try {
    name = localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    // storage blocked
  }
  return { id: loadId(fresh), name: name || defaultName(ua, !!findPort()), kind: detectKind(ua) };
}

// --- talking to the server --------------------------------------------------------------------

async function post(body: Record<string, unknown>): Promise<boolean> {
  const me = useDevices.getState().me;
  if (!me) return false;
  try {
    const res = await fetch('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, from: me.id }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function snapshot(withQueue: boolean): PlaybackSnapshot {
  const s = usePlayer.getState();
  return {
    ...(withQueue ? { queue: s.queue } : {}),
    index: s.index,
    isPlaying: s.isPlaying,
    shuffle: s.shuffle,
    repeat: s.repeat,
    volume: s.volume,
    radio: s.radio,
    position: localPosition(),
  };
}

let applying = false; // store writes made on the active device's behalf must not be sent back

function apply(patch: Partial<Snap>) {
  applying = true;
  try {
    usePlayer.setState(patch);
  } finally {
    applying = false;
  }
}

// reports from this page while it is (or is becoming) the one playing
let reportTimer: ReturnType<typeof setTimeout> | null = null;
let reportQueue = false;

function sendReport() {
  reportTimer = null;
  const withQueue = reportQueue;
  reportQueue = false;
  const st = useDevices.getState();
  if (!st.me || st.remote) return;
  const active = st.activeId === st.me.id;
  const playing = usePlayer.getState().isPlaying;
  // a page that is neither active nor playing has nothing anyone needs to follow
  if (!active && !playing) return;
  // starting to play with nobody (or somebody else) active claims playback; a claim carries the queue
  void post({ action: 'state', state: snapshot(withQueue || !active), claim: !active && playing });
}

/** Send this page's playback state soon (coalesced). Call after a local seek. */
export function reportSoon(withQueue = false) {
  reportQueue ||= withQueue;
  if (reportTimer === null) reportTimer = setTimeout(sendReport, REPORT_DELAY_MS);
}

// commands from this page while it is a remote
let commandTimer: ReturnType<typeof setTimeout> | null = null;
let commandPatch: Partial<Omit<PlaybackSnapshot, 'position'>> = {};

function sendCommand(cmd: RemoteCommand) {
  void post({ action: 'command', cmd });
}

function flushCommand() {
  commandTimer = null;
  const patch = commandPatch;
  commandPatch = {};
  if (Object.keys(patch).length > 0) sendCommand({ type: 'sync', patch });
}

/** Keep the remote's progress bar honest until the active device's next report. */
function freezePosition(reset: boolean, playing: boolean) {
  const st = useDevices.getState();
  const position = reset ? 0 : st.position + (playing ? (Date.now() - st.positionAt) / 1000 : 0);
  useDevices.setState({ position, positionAt: Date.now() });
}

function forward(s: Snap, prev: Snap) {
  if (s.shuffle !== prev.shuffle) {
    // the active device reshuffles with its own pre-shuffle order; ours may not match it
    if (commandTimer) clearTimeout(commandTimer);
    flushCommand();
    sendCommand({ type: 'toggleShuffle' });
    return;
  }
  const patch = commandPatch;
  const trackChanged = s.queue[s.index]?.id !== prev.queue[prev.index]?.id || s.index !== prev.index;
  if (s.queue !== prev.queue) patch.queue = s.queue;
  if (s.index !== prev.index || patch.queue) patch.index = s.index;
  if (s.isPlaying !== prev.isPlaying || trackChanged) {
    // pausing freezes the bar where it is; a new track starts it from zero
    freezePosition(trackChanged, prev.isPlaying);
    patch.isPlaying = s.isPlaying;
  }
  if (s.repeat !== prev.repeat) patch.repeat = s.repeat;
  if (s.volume !== prev.volume) patch.volume = s.volume;
  if (s.radio !== prev.radio) patch.radio = s.radio;
  if (Object.keys(patch).length === 0) return;
  if (commandTimer === null) commandTimer = setTimeout(flushCommand, COMMAND_DELAY_MS);
}

/** Seek on the active device (this page is a remote). */
export function remoteSeek(seconds: number) {
  useDevices.setState({ position: seconds, positionAt: Date.now() });
  sendCommand({ type: 'seek', position: seconds });
}

// --- events from the server -------------------------------------------------------------------

function mirror(state: PlaybackSnapshot) {
  const patch: Partial<Snap> = {
    isPlaying: state.isPlaying,
    shuffle: state.shuffle,
    repeat: state.repeat,
    volume: state.volume,
    radio: state.radio,
    duck: 1,
  };
  if (state.queue) {
    patch.queue = state.queue;
    patch.originalQueue = state.queue.slice();
  }
  const length = (state.queue ?? usePlayer.getState().queue).length;
  if (state.index < length) patch.index = state.index;
  apply(patch);
  useDevices.setState({ position: state.position, positionAt: Date.now() });
}

function runCommand(cmd: RemoteCommand) {
  const store = usePlayer.getState();
  switch (cmd.type) {
    case 'toggleShuffle':
      store.toggleShuffle();
      return;
    case 'seek':
      localSeek(cmd.position);
      reportSoon();
      return;
    case 'sync': {
      const p = cmd.patch;
      const patch: Partial<Snap> = {};
      const queue = p.queue ?? store.queue;
      if (p.queue) {
        patch.queue = p.queue;
        patch.originalQueue = p.queue.slice();
        patch.djSession = false;
      }
      if (p.index !== undefined && p.index >= -1 && p.index < queue.length) patch.index = p.index;
      const index = patch.index ?? store.index;
      if (p.isPlaying !== undefined) patch.isPlaying = p.isPlaying && index >= 0;
      if (p.repeat !== undefined) patch.repeat = p.repeat;
      if (p.volume !== undefined) patch.volume = p.volume;
      if (p.radio !== undefined) patch.radio = p.radio;
      // a normal write: the change goes out to every device, the sender included
      usePlayer.setState(patch);
      return;
    }
  }
}

function becomeActive(state: PlaybackSnapshot | null, play: boolean) {
  const { me, remote: wasRemote } = useDevices.getState();
  if (!me) return;
  const cur = usePlayer.getState();
  const queue = state?.queue;
  let seekTo: number | null = null;
  // The session goes into the store before this page stops being a remote, so the native player (which
  // ignores the store while remote) picks it up whole, at the handed-over position, in one go.
  if (state && queue && queue.length > 0 && state.index >= 0 && state.index < queue.length) {
    const incoming = queue[state.index];
    // A remote's store only mirrored the song, so it loads afresh (the Player and the native player take
    // pendingStart when they do). A page that was playing locally already has it loaded: just seek.
    if (!wasRemote && cur.queue[cur.index]?.id === incoming.id) seekTo = state.position;
    else pendingStart = { trackId: incoming.id, position: state.position };
    apply({
      queue,
      originalQueue: queue.slice(),
      index: state.index,
      shuffle: state.shuffle,
      repeat: state.repeat,
      radio: state.radio,
      isPlaying: play,
      djSession: false,
      duck: 1,
    });
  } else {
    apply({ isPlaying: play && cur.index >= 0 });
  }
  useDevices.setState({ activeId: me.id, activeName: me.name, remote: false });
  if (seekTo !== null) localSeek(seekTo);
  reportSoon(true);
}

function onEvent(e: DeviceEvent) {
  const st = useDevices.getState();
  const me = st.me;
  if (!me) return;
  switch (e.type) {
    case 'devices': {
      const remote = !!e.activeId && e.activeId !== me.id;
      // a mirrored "playing" belongs to the other device: never let it start local audio
      if (st.remote !== remote) apply({ isPlaying: false });
      useDevices.setState({ devices: e.devices, activeId: e.activeId, activeName: e.activeName, remote });
      return;
    }
    case 'state':
      if (st.remote) mirror(e.state);
      return;
    case 'command':
      if (st.activeId === me.id) runCommand(e.cmd);
      return;
    case 'activate':
      becomeActive(e.state, e.play);
      return;
    case 'release':
      // playback moved to another device; the devices event that follows makes this page a remote
      apply({ isPlaying: false });
      return;
    case 'replaced':
      restart?.(true);
      return;
  }
}

// --- lifecycle --------------------------------------------------------------------------------

let restart: ((freshId: boolean) => void) | null = null;

/**
 * Called once by the Player on mount: joins this page to the user's devices once the saved session
 * has been restored. Returns the cleanup.
 */
export function connectDevices(): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return () => {};
  let es: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  let stopped = false;

  const open = (freshId: boolean) => {
    if (stopped) return;
    es?.close();
    if (retry) clearTimeout(retry);
    retry = null;
    const me = loadDevice(freshId);
    useDevices.setState({ me });
    const q = new URLSearchParams({ id: me.id, name: me.name, kind: me.kind });
    const source = new EventSource(`/api/devices/events?${q}`);
    es = source;
    source.onmessage = (msg) => {
      try {
        onEvent(JSON.parse(msg.data) as DeviceEvent);
      } catch {
        // a malformed event is dropped
      }
    };
    source.onerror = () => {
      // EventSource retries a dropped stream by itself, but gives up for good on an error response
      if (source.readyState === EventSource.CLOSED && es === source && !stopped) {
        retry = setTimeout(() => open(false), 10_000);
      }
    };
  };
  restart = open;

  const start = () => {
    if (stopped) return;
    unsubscribe = usePlayer.subscribe((s, prev) => {
      if (applying) return;
      if (useDevices.getState().remote) return forward(s, prev);
      const queueChanged = s.queue !== prev.queue;
      if (
        queueChanged ||
        s.index !== prev.index ||
        s.isPlaying !== prev.isPlaying ||
        s.shuffle !== prev.shuffle ||
        s.repeat !== prev.repeat ||
        s.volume !== prev.volume ||
        s.radio !== prev.radio
      ) {
        reportSoon(queueChanged);
      }
    });
    heartbeat = setInterval(() => {
      const st = useDevices.getState();
      if (st.me && st.activeId === st.me.id && usePlayer.getState().isPlaying) reportSoon();
    }, HEARTBEAT_MS);
    open(false);
  };

  if (usePlayer.persist.hasHydrated()) start();
  else {
    const unsub = usePlayer.persist.onFinishHydration(() => {
      unsub();
      start();
    });
  }

  return () => {
    stopped = true;
    es?.close();
    if (retry) clearTimeout(retry);
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe?.();
    restart = null;
  };
}

/** Move playback to `deviceId` (this page included). */
export async function playOn(deviceId: string): Promise<boolean> {
  const st = useDevices.getState();
  if (!st.me || deviceId === st.activeId) return true;
  // handing off our own session: it travels with the request, so the target starts where we are
  const state = st.remote ? null : snapshot(true);
  return post({ action: 'transfer', to: deviceId, state });
}

export async function renameThisDevice(name: string): Promise<void> {
  const clean = name.trim().slice(0, 60);
  const me = useDevices.getState().me;
  if (!me || !clean) return;
  try {
    localStorage.setItem(NAME_KEY, clean);
  } catch {
    // storage blocked: the name lasts until the page closes
  }
  useDevices.setState({ me: { ...me, name: clean } });
  await post({ action: 'rename', name: clean });
}

/** The active device's position, ticking along while it plays (this page a remote). */
export function useRemoteProgress(): number {
  const remote = useDevices((s) => s.remote);
  const position = useDevices((s) => s.position);
  const positionAt = useDevices((s) => s.positionAt);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const [now, setNow] = useState(positionAt);
  useEffect(() => {
    if (!remote || !isPlaying) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [remote, isPlaying, positionAt]);
  if (!remote) return 0;
  return position + (isPlaying ? Math.max(0, now - positionAt) / 1000 : 0);
}
