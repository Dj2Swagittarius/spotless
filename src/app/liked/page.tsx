'use client';

import { useEffect, useState } from 'react';
import { usePlayer } from '@/store/player';
import { useLikes } from '@/store/likes';
import TrackList from '@/components/TrackList';
import { LoadErrorState } from '@/components/Cards';
import { DetailHeaderSkeleton, RowListSkeleton } from '@/components/Skeleton';
import { PlayIcon, HeartIcon } from '@/components/Icons';
import { fmtTotal } from '@/lib/format';
import { getJson, isAbortError, type LoadStatus } from '@/lib/http';
import type { Track } from '@/lib/types';

export default function LikedPage() {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const playQueue = usePlayer((s) => s.playQueue);
  const likedCount = useLikes((s) => s.ids.size);

  // refetches on every like/unlike; while a list is already showing, keep it up during the refetch
  // and leave it in place if that refetch fails instead of swapping the page for an error
  useEffect(() => {
    const ac = new AbortController();
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    getJson<Track[]>('/api/likes?full=1', { signal: ac.signal })
      .then((d) => {
        setTracks(d);
        setStatus('ready');
      })
      .catch((err) => {
        if (!isAbortError(err)) setStatus((s) => (s === 'ready' ? s : 'error'));
      });
    return () => ac.abort();
  }, [likedCount, attempt]);

  if (status === 'error') return <LoadErrorState what="your liked songs" onRetry={() => setAttempt((n) => n + 1)} />;
  if (status === 'loading' || !tracks)
    return (
      <div className="space-y-6">
        <DetailHeaderSkeleton />
        <RowListSkeleton count={8} />
      </div>
    );

  const total = tracks.reduce((s, t) => s + t.duration, 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-col items-center gap-6 rounded-lg bg-linear-to-b from-white/10 to-transparent p-6 sm:flex-row sm:items-end">
        <div className="flex h-48 w-48 shrink-0 items-center justify-center rounded-sm bg-linear-to-br from-indigo-600 to-white/80 shadow-2xl sm:h-56 sm:w-56">
          <HeartIcon size={80} filled className="text-white" />
        </div>
        <div className="text-center sm:text-left">
          <div className="text-sm font-medium">Playlist</div>
          <h1 className="my-2 text-4xl font-extrabold sm:text-5xl">Liked Songs</h1>
          <div className="text-sm text-subdued">
            {tracks.length} songs, {fmtTotal(total)}
          </div>
        </div>
      </header>

      {tracks.length > 0 && (
        <button
          onClick={() => playQueue(tracks, 0)}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-black shadow-lg transition-transform hover:scale-105 hover:bg-accentBright"
          title="Play"
          aria-label="Play liked songs"
        >
          <PlayIcon size={24} />
        </button>
      )}

      {tracks.length === 0 ? (
        <div className="text-subdued">No liked songs yet. Tap the heart on any track.</div>
      ) : (
        <TrackList tracks={tracks} />
      )}
    </div>
  );
}
