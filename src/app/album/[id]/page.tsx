'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePlayer } from '@/store/player';
import TrackList from '@/components/TrackList';
import { DetailHeaderSkeleton, RowListSkeleton } from '@/components/Skeleton';
import { PlayIcon } from '@/components/Icons';
import { fmtTotal } from '@/lib/format';
import type { Album, Track } from '@/lib/types';

export default function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [album, setAlbum] = useState<(Album & { tracks: Track[] }) | null>(null);
  const playQueue = usePlayer((s) => s.playQueue);

  useEffect(() => {
    fetch(`/api/albums/${id}`)
      .then((r) => r.json())
      .then(setAlbum)
      .catch(() => {});
  }, [id]);

  if (!album)
    return (
      <div className="space-y-6">
        <DetailHeaderSkeleton />
        <RowListSkeleton count={8} />
      </div>
    );

  return (
    <div className="space-y-6">
      <header className="flex flex-col items-center gap-6 rounded-lg bg-gradient-to-b from-white/10 to-transparent p-6 sm:flex-row sm:items-end">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/artwork/${album.id}`} alt={album.name} className="h-48 w-48 rounded shadow-2xl sm:h-56 sm:w-56" />
        <div className="text-center sm:text-left">
          <div className="text-sm font-medium">Album</div>
          <h1 className="my-2 text-4xl font-extrabold sm:text-5xl">{album.name}</h1>
          <div className="text-sm text-subdued">
            <Link href={`/artist/${album.artistId}`} className="font-semibold text-white hover:underline">
              {album.artist}
            </Link>
            {album.year ? ` · ${album.year}` : ''} · {album.trackCount} songs, {fmtTotal(album.duration)}
          </div>
        </div>
      </header>

      <button
        onClick={() => playQueue(album.tracks, 0)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-black shadow-lg transition-transform hover:scale-105 hover:bg-accentBright"
        title="Play album"
      >
        <PlayIcon size={24} />
      </button>

      <TrackList tracks={album.tracks} showAlbum={false} showArt={false} />
    </div>
  );
}
