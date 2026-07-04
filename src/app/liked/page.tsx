'use client';

import { useEffect, useState } from 'react';
import { usePlayer } from '@/store/player';
import { useLikes } from '@/store/likes';
import TrackList from '@/components/TrackList';
import { DetailHeaderSkeleton, RowListSkeleton } from '@/components/Skeleton';
import { PlayIcon, HeartIcon } from '@/components/Icons';
import { fmtTotal } from '@/lib/format';
import type { Track } from '@/lib/types';

export default function LikedPage() {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const playQueue = usePlayer((s) => s.playQueue);
  const likedCount = useLikes((s) => s.ids.size);

  useEffect(() => {
    fetch('/api/likes?full=1')
      .then((r) => r.json())
      .then(setTracks)
      .catch(() => {});
  }, [likedCount]);

  if (!tracks)
    return (
      <div className="space-y-6">
        <DetailHeaderSkeleton />
        <RowListSkeleton count={8} />
      </div>
    );

  const total = tracks.reduce((s, t) => s + t.duration, 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-col items-center gap-6 rounded-lg bg-gradient-to-b from-white/10 to-transparent p-6 sm:flex-row sm:items-end">
        <div className="flex h-48 w-48 shrink-0 items-center justify-center rounded bg-gradient-to-br from-indigo-600 to-white/80 shadow-2xl sm:h-56 sm:w-56">
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
