'use client';

import { usePlayer } from '@/store/player';

/**
 * Speaks DJ lines. Server voices (local speech server or a hosted one) come back as
 * audio from /api/dj/speak; "browser" mode uses speechSynthesis restricted to
 * on-device voices so nothing is sent to a cloud voice service.
 * Music is ducked while the DJ talks.
 */

let current: HTMLAudioElement | null = null;
let duckedFrom: number | null = null;
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

function duck() {
  const { volume, setVolume } = usePlayer.getState();
  if (duckedFrom === null) {
    duckedFrom = volume;
    setVolume(volume * 0.3);
  }
}

function unduck() {
  if (duckedFrom !== null) {
    usePlayer.getState().setVolume(duckedFrom);
    duckedFrom = null;
  }
}

export function stopSpeaking() {
  generation++;
  current?.pause();
  current = null;
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  unduck();
  if (speaking !== null) setSpeaking(null);
}

function localVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices().filter((v) => v.localService);
  const lang = navigator.language?.slice(0, 2) || 'en';
  return voices.find((v) => v.lang.startsWith(lang) && /natural|neural|premium|enhanced/i.test(v.name)) ?? voices.find((v) => v.lang.startsWith(lang)) ?? null;
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
        duck();
        await speakInBrowser(text);
        if (!stale()) unduck();
        return {};
      }
      return { error: d.error ?? 'voice failed' };
    }
    const blob = await res.blob();
    if (stale()) return {};
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
