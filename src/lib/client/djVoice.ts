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
  current?.pause();
  current = null;
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  unduck();
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
  try {
    const res = await fetch('/api/dj/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('application/json')) {
      const d = await res.json();
      if (d.off) return {};
      if (d.browser) {
        duck();
        await speakInBrowser(text);
        unduck();
        return {};
      }
      return { error: d.error ?? 'voice failed' };
    }
    const url = URL.createObjectURL(await res.blob());
    const audio = new Audio(url);
    current = audio;
    duck();
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.play().catch(() => resolve());
    });
    URL.revokeObjectURL(url);
    if (current === audio) {
      current = null;
      unduck();
    }
    return {};
  } catch (err) {
    unduck();
    return { error: String(err) };
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
