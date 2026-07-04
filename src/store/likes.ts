'use client';

import { create } from 'zustand';

interface LikesState {
  ids: Set<number>;
  loaded: boolean;
  load: () => Promise<void>;
  toggle: (trackId: number) => Promise<void>;
}

export const useLikes = create<LikesState>((set, get) => ({
  ids: new Set(),
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    try {
      const res = await fetch('/api/likes');
      const ids: number[] = await res.json();
      set({ ids: new Set(ids), loaded: true });
    } catch {
      // ignore
    }
  },

  toggle: async (trackId) => {
    const liked = get().ids.has(trackId);
    const ids = new Set(get().ids);
    if (liked) ids.delete(trackId);
    else ids.add(trackId);
    set({ ids });
    if (liked) await fetch(`/api/likes?trackId=${trackId}`, { method: 'DELETE' });
    else await fetch('/api/likes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId }) });
  },
}));
