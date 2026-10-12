'use client';

import type { Track } from '@/lib/types';

/**
 * The Android app's bridge. The app injects `window.SpotlessNative` (androidx.webkit web message listener,
 * locked to the server's origin) and plays audio natively; this module does the handshake and carries the
 * typed messages. In a browser or the desktop app there is no port and nothing here runs.
 */

export const BRIDGE_VERSION = 1;

export interface NativePort {
  postMessage(message: string): void;
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
}

export type NativeCommand =
  | { type: 'hello' }
  | { type: 'getState' }
  | { type: 'setQueue'; tracks: Track[]; index: number; positionMs: number; play: boolean; baseVersion: number }
  | { type: 'syncQueue'; tracks: Track[]; index: number; baseVersion: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; positionMs: number }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'jumpTo'; index: number }
  | { type: 'setRepeat'; mode: 'off' | 'all' | 'one' }
  | { type: 'setVolume'; value: number }
  | { type: 'setDuck'; value: number }
  | { type: 'setEq'; enabled: boolean; gains: number[] }
  | { type: 'setQuality'; value: string }
  | { type: 'setSleepTimer'; minutes: number }
  | { type: 'speak'; id: number; audio?: string; mime?: string; text?: string }
  | { type: 'stopSpeaking' }
  | { type: 'changeServer' };

export type NativeEvent =
  | { type: 'hello'; bridgeVersion: number; appVersion: string; caps: string[] }
  | {
      type: 'state';
      isPlaying: boolean;
      index: number;
      positionMs: number;
      durationMs: number;
      buffering: boolean;
      queueVersion: number;
      sleepUntil?: number;
    }
  | { type: 'queue'; tracks: Track[]; index: number; queueVersion: number; positionMs: number; isPlaying: boolean }
  | { type: 'trackError'; trackId: number; reason: string }
  | { type: 'speaking'; id: number; active: boolean }
  | { type: 'authLost' };

export interface NativeBridge {
  appVersion: string;
  caps: string[];
  send(cmd: NativeCommand): void;
  /** Subscribe to events; returns an unsubscribe function. */
  on(listener: (e: NativeEvent) => void): () => void;
}

/** The injected port, when this page runs inside the Android app. */
export function findPort(): NativePort | null {
  if (typeof window === 'undefined') return null;
  const port = (window as unknown as { SpotlessNative?: NativePort }).SpotlessNative;
  return port && typeof port.postMessage === 'function' ? port : null;
}

/** Handshake: resolves the bridge when the app speaks a version we know, otherwise null. */
export function connect(port: NativePort, timeoutMs = 2000): Promise<NativeBridge | null> {
  return new Promise((resolve) => {
    const listeners = new Set<(e: NativeEvent) => void>();
    let bridge: NativeBridge | null = null;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);

    port.addEventListener('message', (msg) => {
      let event: NativeEvent;
      try {
        event = JSON.parse(String(msg.data));
      } catch {
        return;
      }
      if (!event || typeof event !== 'object' || typeof event.type !== 'string') return;
      if (!settled && event.type === 'hello') {
        settled = true;
        clearTimeout(timer);
        if (event.bridgeVersion !== BRIDGE_VERSION) return resolve(null);
        bridge = {
          appVersion: event.appVersion,
          caps: Array.isArray(event.caps) ? event.caps : [],
          send: (cmd) => port.postMessage(JSON.stringify(cmd)),
          on: (listener) => {
            listeners.add(listener);
            return () => {
              listeners.delete(listener);
            };
          },
        };
        return resolve(bridge);
      }
      if (bridge) listeners.forEach((l) => l(event));
    });

    port.postMessage(JSON.stringify({ type: 'hello' }));
  });
}
