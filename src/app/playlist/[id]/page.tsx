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
  const [checking, setChecking] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
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

  const playable = pl.tracks.filter((t) => !t.missing);
  const missing = pl.tracks.filter((t) => t.missing);

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

  const removePlaceholder = async (placeholderId: number) => {
    await fetch(`/api/playlists/${id}/tracks?placeholderId=${placeholderId}`, { method: 'DELETE' });
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
      body: JSON.stringify({ items: tracks.map((t) => (t.missing ? `p:${t.placeholderId}` : `t:${t.id}`)) }),
    }).catch(() => load());
  };

  // re-match placeholders against the library (a rescan does this too)
  const checkAgain = async () => {
    setChecking('Checking…');
    const r = await fetch(`/api/playlists/${id}/resolve`, { method: 'POST' })
      .then((r) => r.json())
      .catch(() => null);
    setChecking(r ? `${r.resolved} found` : 'Failed');
    load();
    setTimeout(() => setChecking(null), 2000);
  };

  // one Lidarr add per unique album — grabbing the album gets the song
  const sendMissing = async () => {
    const albums = new Map<string, { artist: string; album: string }>();
    for (const m of missing) albums.set(`${m.artist}|${m.album}`.toLowerCase(), { artist: m.artist, album: m.album });
    const list = [...albums.values()];
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < list.length; i++) {
      setSending(`Sending ${i + 1}/${list.length}…`);
      const res = await fetch('/api/lidarr/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(list[i]),
      }).catch(() => null);
      if (res?.ok) ok++;
      else fail++;
    }
    setSending(`Done: ${ok} albums sent${fail ? `, ${fail} failed (not on MusicBrainz?)` : ''}`);
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
            {missing.length > 0 && <span className="text-warning"> · {missing.length} missing</span>}
          </div>
        </div>
      </header>

      <div className="flex items-center gap-4">
        <button
          onClick={() => playQueue(playable, 0)}
          disabled={playable.length === 0}
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

      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-elevated px-4 py-3 text-sm">
          <span className="text-subdued">
            {missing.length} {missing.length === 1 ? 'song is' : 'songs are'} not in your library yet. Download them and rescan; they fill in automatically.
          </span>
          <span className="flex-1" />
          <div className="flex flex-wrap items-center gap-2">
            {sending ? (
              <span className="text-xs text-accent">{sending}</span>
            ) : (
              <button onClick={sendMissing} className="btn-pill">
                ⤓ Send all to Lidarr
              </button>
            )}
            <button onClick={checkAgain} disabled={checking !== null} className="btn-pill">
              {checking ?? 'Check again'}
            </button>
          </div>
        </div>
      )}

      {pl.tracks.length === 0 ? (
        <div className="text-subdued">Empty playlist. Use the ··· menu on any song, or in the player, to add it here.</div>
      ) : (
        <TrackList tracks={pl.tracks} onRemove={removeTrack} onRemovePlaceholder={removePlaceholder} onReorder={reorder} />
      )}
    </div>
  );
}
