'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePlayer } from '@/store/player';
import TrackList from '@/components/TrackList';
import PromptModal from '@/components/PromptModal';
import PlaylistCover from '@/components/PlaylistCover';
import { DetailHeaderSkeleton, RowListSkeleton } from '@/components/Skeleton';
import { PlayIcon, TrashIcon } from '@/components/Icons';
import { fmtTotal } from '@/lib/format';
import type { Playlist, Track } from '@/lib/types';

type PlaylistDetail = Playlist & { tracks: Track[] };

export default function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [pl, setPl] = useState<PlaylistDetail | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const playQueue = usePlayer((s) => s.playQueue);
  const router = useRouter();

  const load = useCallback(() => {
    fetch(`/api/playlists/${id}`)
      .then((r) => r.json())
      .then(setPl)
      .catch(() => {});
  }, [id]);

  useEffect(load, [load]);

  if (!pl)
    return (
      <div className="space-y-6">
        <DetailHeaderSkeleton />
        <RowListSkeleton count={8} />
      </div>
    );

  const rename = async (name: string) => {
    await fetch(`/api/playlists/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    setRenaming(false);
    load();
  };

  const remove = async () => {
    await fetch(`/api/playlists/${id}`, { method: 'DELETE' });
    router.push('/library');
  };

  const removeTrack = async (trackId: number) => {
    await fetch(`/api/playlists/${id}/tracks?trackId=${trackId}`, { method: 'DELETE' });
    load();
  };

  const reorder = async (from: number, to: number) => {
    const tracks = pl.tracks.slice();
    const [moved] = tracks.splice(from, 1);
    tracks.splice(to, 0, moved);
    setPl({ ...pl, tracks }); // optimistic
    await fetch(`/api/playlists/${id}/tracks`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: tracks.map((t) => t.id) }),
    }).catch(() => load());
  };

  return (
    <div className="space-y-6">
      {renaming && (
        <PromptModal title="Rename playlist" initial={pl.name} submitLabel="Rename" onSubmit={rename} onClose={() => setRenaming(false)} />
      )}
      {confirmingDelete && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" onClick={() => setConfirmingDelete(false)}>
          <div className="w-full max-w-sm rounded-lg bg-elevated p-5 shadow-dialog" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-lg font-bold">Delete “{pl.name}”?</h2>
            <p className="mb-4 text-sm text-subdued">This can&apos;t be undone. Your music files aren&apos;t touched.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmingDelete(false)} className="rounded-full px-4 py-1.5 text-sm font-medium text-subdued hover:text-white">
                Cancel
              </button>
              <button
                onClick={remove}
                className="rounded-full bg-negative px-5 py-1.5 text-sm font-bold uppercase tracking-[0.08em] text-black"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="flex flex-col items-center gap-6 rounded-lg bg-gradient-to-b from-white/10 to-transparent p-6 sm:flex-row sm:items-end">
        <PlaylistCover artIds={pl.artIds} size="lg" />
        <div className="text-center sm:text-left">
          <div className="text-sm font-medium">Playlist</div>
          <h1
            onClick={() => setRenaming(true)}
            className="my-2 cursor-pointer text-4xl font-extrabold hover:underline sm:text-5xl"
            title="Rename"
          >
            {pl.name}
          </h1>
          <div className="text-sm text-subdued">
            {pl.trackCount} songs, {fmtTotal(pl.duration)}
          </div>
        </div>
      </header>

      <div className="flex items-center gap-4">
        <button
          onClick={() => playQueue(pl.tracks, 0)}
          disabled={pl.tracks.length === 0}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-black shadow-lg transition-transform hover:scale-105 hover:bg-accentBright disabled:opacity-40"
          title="Play"
          aria-label="Play playlist"
        >
          <PlayIcon size={24} />
        </button>
        <button onClick={() => setConfirmingDelete(true)} className="rounded-full p-2 text-subdued hover:text-white" title="Delete playlist" aria-label="Delete playlist">
          <TrashIcon size={22} />
        </button>
        <span className="text-xs text-subdued">drag songs to reorder</span>
      </div>

      {pl.tracks.length === 0 ? (
        <div className="text-subdued">Empty playlist. Find songs via Search and use the ··· menu to add them.</div>
      ) : (
        <TrackList tracks={pl.tracks} onRemove={removeTrack} onReorder={reorder} />
      )}
    </div>
  );
}
