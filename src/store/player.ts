'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Track } from '@/lib/types';

type Repeat = 'off' | 'all' | 'one';

interface PlayerState {
  queue: Track[];
  /** the unshuffled order, kept while shuffle is on so turning it off restores the list */
  originalQueue: Track[];
  index: number;
  isPlaying: boolean;
  shuffle: boolean;
  repeat: Repeat;
  volume: number;
  radio: boolean;
  /** queue was started by the AI DJ: enables spoken segues between songs */
  djSession: boolean;
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
  /** play exactly this list in order (DJ sets), ignoring radio/shuffle */
  playDj: (tracks: Track[]) => void;
}

/** Slice of the state that survives a reload. */
type PersistedPlayer = Pick<PlayerState, 'queue' | 'index' | 'repeat' | 'shuffle' | 'volume' | 'radio'>;

// Cap on the persisted queue: localStorage is small and a Track row is a few hundred
// bytes, so a radio session that ran for days must not take the whole origin's quota.
const PERSIST_MAX_TRACKS = 500;
const PERSIST_KEY = 'spotless-player';
const REPEATS: Repeat[] = ['off', 'all', 'one'];

function shuffleUpcoming(queue: Track[], index: number): Track[] {
  const head = queue.slice(0, index + 1);
  const rest = queue.slice(index + 1);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return head.concat(rest);
}

/** Position of `track` in `queue`: the same object if present, otherwise the first entry with its id. */
function locate(queue: Track[], track: Track | undefined): number {
  if (!track) return -1;
  const byRef = queue.indexOf(track);
  return byRef >= 0 ? byRef : queue.findIndex((t) => t.id === track.id);
}

export const usePlayer = create<PlayerState>()(
  persist(
    (set, get) => ({
      queue: [],
      originalQueue: [],
      index: -1,
      isPlaying: false,
      shuffle: false,
      repeat: 'off',
      volume: 1,
      radio: false,
      djSession: false,

      playQueue: (tracks, start = 0) => {
        if (tracks.length === 0) return;
        set({ djSession: false });
        if (get().radio) {
          // radio mode: seed from the chosen track only; similar tracks fill in behind it
          set({ queue: [tracks[start]], originalQueue: [tracks[start]], index: 0, isPlaying: true });
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
        set({ queue, originalQueue: tracks.slice(), index, isPlaying: true });
      },

      toggle: () => set((s) => ({ isPlaying: s.index >= 0 ? !s.isPlaying : false })),
      setPlaying: (isPlaying) => set({ isPlaying }),

      next: () => {
        const { queue, index, repeat, shuffle } = get();
        if (queue.length === 0) return;
        if (index + 1 < queue.length) set({ index: index + 1, isPlaying: true });
        else if (repeat === 'all') {
          if (shuffle && queue.length > 1) {
            // a new lap gets a new order — but never open it with the track that just finished
            const reshuffled = shuffleUpcoming(queue, -1);
            if (reshuffled[0] === queue[index]) {
              const j = 1 + Math.floor(Math.random() * (reshuffled.length - 1));
              [reshuffled[0], reshuffled[j]] = [reshuffled[j], reshuffled[0]];
            }
            set({ queue: reshuffled, index: 0, isPlaying: true });
          } else set({ index: 0, isPlaying: true });
        } else set({ isPlaying: false });
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
        set((s) =>
          s.index < 0
            ? { queue: [track], originalQueue: [track], index: 0, isPlaying: true }
            : { queue: [...s.queue, track], originalQueue: [...s.originalQueue, track] }
        ),

      appendTracks: (tracks) =>
        set((s) =>
          s.index < 0
            ? { queue: tracks, originalQueue: tracks.slice(), index: 0, isPlaying: true }
            : { queue: [...s.queue, ...tracks], originalQueue: [...s.originalQueue, ...tracks] }
        ),

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
          if (shuffle) {
            // remember the order we are leaving so it can come back when shuffle is turned off
            if (s.index < 0) return { shuffle, originalQueue: s.queue.slice() };
            return { shuffle, originalQueue: s.queue.slice(), queue: shuffleUpcoming(s.queue, s.index) };
          }
          // the original order is only known for queues built while shuffle was on this session;
          // a restored session keeps whatever order it was saved in
          if (s.originalQueue.length !== s.queue.length) return { shuffle };
          const current = s.index >= 0 ? s.queue[s.index] : undefined;
          const index = current ? locate(s.originalQueue, current) : s.index;
          if (current && index < 0) return { shuffle };
          return { shuffle, queue: s.originalQueue, index };
        }),

      cycleRepeat: () =>
        set((s) => ({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' })),

      setVolume: (volume) => set({ volume }),

      playDj: (tracks) => {
        if (tracks.length === 0) return;
        set({ queue: tracks.slice(), originalQueue: tracks.slice(), index: 0, isPlaying: true, djSession: true });
      },

      toggleRadio: () => set((s) => ({ radio: !s.radio })),
    }),
    {
      name: PERSIST_KEY,
      version: 1,
      // Hydration is kicked off by the Player once it is mounted on the client, so the
      // first client render matches the server HTML (an empty player) instead of the
      // saved queue — reading localStorage during render was a hydration mismatch.
      skipHydration: true,
      partialize: (s): PersistedPlayer => {
        // keep the current track and what follows it when the queue has to be trimmed
        const start = Math.max(0, Math.min(s.index, s.queue.length - PERSIST_MAX_TRACKS));
        const queue = s.queue.slice(start, start + PERSIST_MAX_TRACKS);
        return {
          queue,
          index: s.index >= 0 ? Math.min(s.index - start, queue.length - 1) : -1,
          repeat: s.repeat,
          shuffle: s.shuffle,
          volume: s.volume,
          radio: s.radio,
        };
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PersistedPlayer>;
        const queue = Array.isArray(p.queue) ? p.queue.filter((t) => t && typeof t === 'object' && typeof t.id === 'number') : [];
        const index = Number.isInteger(p.index) && (p.index as number) >= 0 && (p.index as number) < queue.length ? (p.index as number) : -1;
        const volume = typeof p.volume === 'number' && Number.isFinite(p.volume) ? Math.max(0, Math.min(1, p.volume)) : current.volume;
        return {
          ...current,
          queue,
          originalQueue: [],
          index,
          repeat: REPEATS.includes(p.repeat as Repeat) ? (p.repeat as Repeat) : current.repeat,
          shuffle: Boolean(p.shuffle),
          volume,
          radio: Boolean(p.radio),
          // a restored session is shown paused at the saved spot; playback is a user gesture away
          isPlaying: false,
          djSession: false,
        };
      },
    }
  )
);
