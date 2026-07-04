'use client';

import { create } from 'zustand';
import type { Track } from '@/lib/types';

type Repeat = 'off' | 'all' | 'one';

interface PlayerState {
  queue: Track[];
  index: number;
  isPlaying: boolean;
  shuffle: boolean;
  repeat: Repeat;
  volume: number;
  radio: boolean;
  playQueue: (tracks: Track[], start?: number) => void;
  toggle: () => void;
  setPlaying: (playing: boolean) => void;
  next: () => void;
  prev: () => void;
  jumpTo: (index: number) => void;
  addToQueue: (track: Track) => void;
  appendTracks: (tracks: Track[]) => void;
  moveInQueue: (from: number, to: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setVolume: (v: number) => void;
  toggleRadio: () => void;
}

function shuffleUpcoming(queue: Track[], index: number): Track[] {
  const head = queue.slice(0, index + 1);
  const rest = queue.slice(index + 1);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return head.concat(rest);
}

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: [],
  index: -1,
  isPlaying: false,
  shuffle: false,
  repeat: 'off',
  volume: 1,
  radio: typeof window !== 'undefined' && localStorage.getItem('radio') === '1',

  playQueue: (tracks, start = 0) => {
    if (tracks.length === 0) return;
    if (get().radio) {
      // radio mode: seed from the chosen track only; similar tracks fill in behind it
      set({ queue: [tracks[start]], index: 0, isPlaying: true });
      return;
    }
    let queue = tracks.slice();
    let index = start;
    if (get().shuffle) {
      // move start track to front, shuffle rest
      const first = queue.splice(start, 1)[0];
      queue = shuffleUpcoming([first, ...queue], 0);
      index = 0;
    }
    set({ queue, index, isPlaying: true });
  },

  toggle: () => set((s) => ({ isPlaying: s.index >= 0 ? !s.isPlaying : false })),
  setPlaying: (isPlaying) => set({ isPlaying }),

  next: () => {
    const { queue, index, repeat } = get();
    if (queue.length === 0) return;
    if (index + 1 < queue.length) set({ index: index + 1, isPlaying: true });
    else if (repeat === 'all') set({ index: 0, isPlaying: true });
    else set({ isPlaying: false });
  },

  prev: () => {
    const { queue, index } = get();
    if (queue.length === 0) return;
    set({ index: Math.max(0, index - 1), isPlaying: true });
  },

  jumpTo: (index) => {
    const { queue } = get();
    if (index >= 0 && index < queue.length) set({ index, isPlaying: true });
  },

  addToQueue: (track) =>
    set((s) => (s.index < 0 ? { queue: [track], index: 0, isPlaying: true } : { queue: [...s.queue, track] })),

  appendTracks: (tracks) =>
    set((s) => (s.index < 0 ? { queue: tracks, index: 0, isPlaying: true } : { queue: [...s.queue, ...tracks] })),

  moveInQueue: (from, to) =>
    set((s) => {
      if (from === to || from < 0 || to < 0 || from >= s.queue.length || to >= s.queue.length) return {};
      const queue = s.queue.slice();
      const [moved] = queue.splice(from, 1);
      queue.splice(to, 0, moved);
      let index = s.index;
      if (from === s.index) index = to;
      else if (from < s.index && to >= s.index) index--;
      else if (from > s.index && to <= s.index) index++;
      return { queue, index };
    }),

  toggleShuffle: () =>
    set((s) => {
      const shuffle = !s.shuffle;
      if (shuffle && s.index >= 0) return { shuffle, queue: shuffleUpcoming(s.queue, s.index) };
      return { shuffle };
    }),

  cycleRepeat: () =>
    set((s) => ({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' })),

  setVolume: (volume) => set({ volume }),

  toggleRadio: () =>
    set((s) => {
      const radio = !s.radio;
      try {
        localStorage.setItem('radio', radio ? '1' : '0');
      } catch {
        // private mode etc.
      }
      return { radio };
    }),
}));
