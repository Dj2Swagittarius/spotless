'use client';

import { usePlayer } from '@/store/player';
import { nativeBridge } from './nativeSync';
import type { NativeBridge } from './nativeBridge';

/**
 * Speaks DJ lines. Server voices (local speech server or a hosted one) come back as
 * audio from /api/dj/speak; "browser" mode uses speechSynthesis restricted to
 * on-device voices so nothing is sent to a cloud voice service.
 * Music is ducked while the DJ talks.
 */

// Music level while the DJ talks, as a multiplier on the user's volume. It goes through
// the store's non-persisted `duck` field rather than `volume`, so the slider keeps
// showing the real setting and a reload mid-segue doesn't come back at 30%.
const DUCK_GAIN = 0.3;

let current: HTMLAudioElement | null = null;
// bumped by every speak/stop: a line whose audio arrives after a newer request is dropped,
// so repeated clicks while the voice is still being generated can't stack up
let generation = 0;
let speaking: string | null = null;
const listeners = new Set<(text: string | null) => void>();

function setSpeaking(text: string | null) {
  speaking = text;
  listeners.forEach((l) => l(text));
}

/** The line being spoken (or fetched) right now, or null. */
export const speakingText = () => speaking;

/** Subscribe to the spoken line changing; returns an unsubscribe function. */
export function onSpeakingChange(cb: (text: string | null) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// In the Android app the native player ducks the music itself while the voice plays.
function duck() {
  if (nativeBridge()) return;
  usePlayer.getState().setDuck(DUCK_GAIN);
}

function unduck() {
  if (nativeBridge()) return;
  usePlayer.getState().setDuck(1);
}

export function stopSpeaking() {
  generation++;
  current?.pause();
  current = null;
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  nativeBridge()?.send({ type: 'stopSpeaking' });
  unduck();
  if (speaking !== null) setSpeaking(null);
}

function localVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices().filter((v) => v.localService);
  const lang = navigator.language?.slice(0, 2) || 'en';
  return (
    voices.find((v) => v.lang.startsWith(lang) && /natural|neural|premium|enhanced/i.test(v.name)) ??
    voices.find((v) => v.lang.startsWith(lang)) ??
    null
  );
}

function speakInBrowser(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === 'undefined') return resolve();
    const voice = localVoice();
    // no on-device voice: stay silent rather than fall back to a cloud voice
    if (!voice) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.rate = 1.02;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

/** Standard base64 of raw bytes, in chunks so long clips don't overflow the argument list. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

let nativeSpeechId = 0;

/** Have the Android app say it (a clip, or its on-device voice); resolves when it is done. */
function speakNative(bridge: NativeBridge, payload: { audio?: string; mime?: string; text?: string }): Promise<void> {
  const id = ++nativeSpeechId;
  return new Promise((resolve) => {
    const off = bridge.on((e) => {
      if (e.type === 'speaking' && e.id === id && !e.active) {
        off();
        resolve();
      }
    });
    bridge.send({ type: 'speak', id, ...payload });
  });
}

/** Speak a line; resolves when done. Errors are swallowed (text is still on screen). */
export async function speak(text: string): Promise<{ error?: string }> {
  stopSpeaking();
  if (!text.trim()) return {};
  const mine = ++generation;
  const stale = () => mine !== generation;
  setSpeaking(text);
  const done = () => {
    if (!stale()) setSpeaking(null);
  };
  try {
    const res = await fetch('/api/dj/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('application/json')) {
      const d = await res.json();
      if (stale()) return {};
      if (d.off) return {};
      if (d.browser) {
        const bridge = nativeBridge();
        if (bridge) {
          await speakNative(bridge, { text });
          return {};
        }
        duck();
        await speakInBrowser(text);
        if (!stale()) unduck();
        return {};
      }
      return { error: d.error ?? 'voice failed' };
    }
    const blob = await res.blob();
    if (stale()) return {};
    const bridge = nativeBridge();
    if (bridge) {
      const audio = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
      if (stale()) return {};
      await speakNative(bridge, { audio, mime: blob.type || 'audio/mpeg' });
      return {};
    }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    current = audio;
    duck();
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.onpause = () => resolve(); // stopSpeaking() pauses it
      audio.play().catch(() => resolve());
    });
    URL.revokeObjectURL(url);
    if (current === audio) {
      current = null;
      unduck();
    }
    return {};
  } catch (err) {
    if (!stale()) unduck();
    return { error: String(err) };
  } finally {
    done();
  }
}

const VOICE_KEY = 'dj-voice';
const SEGUE_KEY = 'dj-segues';
const read = (k: string, d: boolean) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v === '1';
  } catch {
    return d;
  }
};
const write = (k: string, v: boolean) => {
  try {
    localStorage.setItem(k, v ? '1' : '0');
  } catch {
    // private mode
  }
};
export const voiceEnabled = () => read(VOICE_KEY, true);
export const setVoiceEnabled = (v: boolean) => write(VOICE_KEY, v);
export const seguesEnabled = () => read(SEGUE_KEY, true);
export const setSeguesEnabled = (v: boolean) => write(SEGUE_KEY, v);
