'use client';

import { create } from 'zustand';
import { usePlayer } from '@/store/player';
import { loadEq } from '@/lib/eq';
import { loadQuality } from '@/lib/adaptive';
import type { Track } from '@/lib/types';
import { connect, findPort, type NativeBridge } from './nativeBridge';

/**
 * In the Android app the native player is the engine. The player store stays the source of queue logic
 * (shuffle order, radio refill, DJ sets); this module mirrors its changes to native as commands and folds
 * native's state (lock-screen skips, track ends, position) back into the store — without echoing those
 * writes back to native.
 */

interface NativeState {
  active: boolean;
  positionMs: number;
  durationMs: number;
  buffering: boolean;
  sleepUntil: number | null;
}

export const useNative = create<NativeState>(() => ({
  active: false,
  positionMs: 0,
  durationMs: 0,
  buffering: false,
  sleepUntil: null,
}));

let current: NativeBridge | null = null;

/** The live bridge while native playback is active, else null. */
export const nativeBridge = () => current;

type PlayerSnapshot = ReturnType<typeof usePlayer.getState>;

export function startNativeSync(bridge: NativeBridge): () => void {
  current = bridge;
  let applying = false; // store writes made on native's behalf must not be sent back
  let ready = false; // native's queue has been read and reconciled
  let version = 0; // last queueVersion native reported

  const apply = (patch: Partial<PlayerSnapshot>) => {
    applying = true;
    try {
      usePlayer.setState(patch);
    } finally {
      applying = false;
    }
  };

  const pushQueue = (queue: Track[], index: number, play: boolean) =>
    bridge.send({ type: 'setQueue', tracks: queue, index, positionMs: 0, play, baseVersion: version });

  const sendSettings = () => {
    const s = usePlayer.getState();
    bridge.send({ type: 'setRepeat', mode: s.repeat });
    bridge.send({ type: 'setVolume', value: s.volume });
    if (typeof window === 'undefined') return;
    const eq = loadEq();
    bridge.send({ type: 'setEq', enabled: eq.enabled, gains: eq.gains });
    bridge.send({ type: 'setQuality', value: loadQuality() });
  };

  const off = bridge.on((e) => {
    switch (e.type) {
      case 'queue': {
        version = e.queueVersion;
        useNative.setState({ positionMs: e.positionMs });
        if (!ready) {
          ready = true;
          if (e.tracks.length === 0) {
            // native has nothing: hand it the session the page restored, paused
            const s = usePlayer.getState();
            if (s.queue.length > 0) pushQueue(s.queue, s.index, false);
            sendSettings();
            return;
          }
          sendSettings();
        }
        apply({ queue: e.tracks, originalQueue: e.tracks.slice(), index: e.index, isPlaying: e.isPlaying });
        return;
      }
      case 'state': {
        version = e.queueVersion;
        useNative.setState({
          positionMs: e.positionMs,
          durationMs: e.durationMs,
          buffering: e.buffering,
          sleepUntil: e.sleepUntil ?? null,
        });
        const s = usePlayer.getState();
        if (ready && (s.index !== e.index || s.isPlaying !== e.isPlaying))
          apply({ index: e.index, isPlaying: e.isPlaying });
        return;
      }
      case 'trackError':
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('spotless-track-error', { detail: e }));
        return;
      default:
        return;
    }
  });

  const unsubscribe = usePlayer.subscribe((s, prev) => {
    if (applying || !ready) return;
    let replaced = false;
    if (s.queue !== prev.queue) {
      const was = prev.queue[prev.index];
      const now = s.queue[s.index];
      if (was && now && was.id === now.id && s.isPlaying === prev.isPlaying) {
        // same song keeps playing: only what is around it changed
        bridge.send({ type: 'syncQueue', tracks: s.queue, index: s.index, baseVersion: version });
      } else {
        pushQueue(s.queue, s.index, s.isPlaying);
        replaced = true;
      }
    } else if (s.index !== prev.index) {
      bridge.send({ type: 'jumpTo', index: s.index });
    }
    if (!replaced && s.isPlaying !== prev.isPlaying) bridge.send({ type: s.isPlaying ? 'play' : 'pause' });
    if (s.repeat !== prev.repeat) bridge.send({ type: 'setRepeat', mode: s.repeat });
    if (s.volume !== prev.volume) bridge.send({ type: 'setVolume', value: s.volume });
    if (s.duck !== prev.duck) bridge.send({ type: 'setDuck', value: s.duck });
  });

  const onEq = () => {
    const eq = loadEq();
    bridge.send({ type: 'setEq', enabled: eq.enabled, gains: eq.gains });
  };
  const onQuality = () => bridge.send({ type: 'setQuality', value: loadQuality() });
  if (typeof window !== 'undefined') {
    window.addEventListener('eq-changed', onEq);
    window.addEventListener('quality-changed', onQuality);
  }

  bridge.send({ type: 'getState' });
  useNative.setState({ active: true });

  return () => {
    off();
    unsubscribe();
    if (typeof window !== 'undefined') {
      window.removeEventListener('eq-changed', onEq);
      window.removeEventListener('quality-changed', onQuality);
    }
    if (current === bridge) current = null;
    useNative.setState({ active: false, positionMs: 0, durationMs: 0, buffering: false, sleepUntil: null });
  };
}

/**
 * Called once by the Player on mount. Inside the Android app it performs the handshake, waits for the
 * saved session to be restored from localStorage, then starts mirroring. Elsewhere it does nothing.
 */
export function connectNative(): () => void {
  const port = findPort();
  if (!port) return () => {};
  let cancelled = false;
  let stop: (() => void) | null = null;
  connect(port).then(async (bridge) => {
    if (!bridge || cancelled) return;
    if (!usePlayer.persist.hasHydrated()) {
      await new Promise<void>((resolve) => {
        const unsub = usePlayer.persist.onFinishHydration(() => {
          unsub();
          resolve();
        });
      });
    }
    if (!cancelled) stop = startNativeSync(bridge);
  });
  return () => {
    cancelled = true;
    stop?.();
  };
}
