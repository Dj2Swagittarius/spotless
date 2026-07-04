'use client';

import { useEffect, useRef, useState } from 'react';
import { DotsIcon, QueueIcon, PlusIcon } from './Icons';
import { usePlayer } from '@/store/player';
import type { Playlist, Track } from '@/lib/types';

export default function AddToPlaylist({ track }: { track: Track }) {
  const [open, setOpen] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const addToQueue = usePlayer((s) => s.addToQueue);

  useEffect(() => {
    if (!open) return;
    fetch('/api/playlists')
      .then((r) => r.json())
      .then(setPlaylists)
      .catch(() => {});
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const add = async (playlistId: number) => {
    await fetch(`/api/playlists/${playlistId}/tracks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId: track.id }),
    });
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-full p-2 text-subdued opacity-60 hover:text-white md:opacity-0 md:group-hover:opacity-100"
        title="More options"
        aria-label="More options"
      >
        <DotsIcon size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-50 w-52 rounded-md border border-highlight bg-elevated p-1 shadow-dialog">
          <button
            onClick={() => {
              addToQueue(track);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-highlight"
          >
            <QueueIcon size={14} /> Add to queue
          </button>
          <div className="my-1 border-t border-highlight" />
          <div className="px-3 py-1 text-xs font-bold uppercase text-subdued">Add to playlist</div>
          {playlists.length === 0 && <div className="px-3 py-2 text-sm text-subdued">No playlists yet</div>}
          {playlists.map((pl) => (
            <button
              key={pl.id}
              onClick={() => add(pl.id)}
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-highlight"
            >
              <PlusIcon size={14} /> <span className="truncate">{pl.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
