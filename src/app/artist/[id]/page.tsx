'use client';

import { use, useEffect, useState } from 'react';
import { usePlayer } from '@/store/player';
import TrackList from '@/components/TrackList';
import { CardGrid, AlbumCard } from '@/components/Cards';
import { DetailHeaderSkeleton, RowListSkeleton } from '@/components/Skeleton';
import { PlayIcon, PlusIcon } from '@/components/Icons';
import type { Artist, Album, Track } from '@/lib/types';

type ArtistDetail = Artist & { albums: Album[]; topTracks: Track[] };

export default function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [collected, setCollected] = useState(false);
  const playQueue = usePlayer((s) => s.playQueue);

  useEffect(() => {
    fetch(`/api/artists/${id}`)
      .then((r) => r.json())
      .then(setArtist)
      .catch(() => {});
    fetch('/api/my-artists')
      .then((r) => r.json())
      .then((ids: number[]) => setCollected(ids.includes(Number(id))))
      .catch(() => {});
  }, [id]);

  const toggleCollect = async () => {
    setCollected((c) => !c);
    if (collected) await fetch(`/api/my-artists?artistId=${id}`, { method: 'DELETE' });
    else
      await fetch('/api/my-artists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artistId: Number(id) }),
      });
  };

  if (!artist)
    return (
      <div className="space-y-8">
        <DetailHeaderSkeleton round />
        <RowListSkeleton count={5} />
      </div>
    );

  return (
    <div className="space-y-8">
      <header className="flex items-end gap-6 rounded-lg bg-gradient-to-b from-white/10 to-transparent p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/artwork/artist/${artist.id}?l=${encodeURIComponent(artist.name.charAt(0))}`}
          alt={artist.name}
          className="h-40 w-40 shrink-0 rounded-full object-cover shadow-2xl"
        />
        <div>
          <div className="text-sm font-medium">Artist</div>
          <h1 className="my-2 text-4xl font-extrabold sm:text-6xl">{artist.name}</h1>
          <div className="text-sm text-subdued">
            {artist.albumCount} albums · {artist.trackCount} songs
          </div>
        </div>
      </header>

      <button
        onClick={() => playQueue(artist.topTracks, 0)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-black shadow-lg transition-transform hover:scale-105 hover:bg-accentBright"
        title="Play top tracks"
      >
        <PlayIcon size={24} />
      </button>
      <button
        onClick={toggleCollect}
        className={`btn-pill ${collected ? 'border-accent text-accent' : ''}`}
        aria-pressed={collected}
      >
        {collected ? '✓ In my music' : '+ My music'}
      </button>

      <section>
        <h2 className="mb-3 text-2xl font-bold">Popular</h2>
        <TrackList tracks={artist.topTracks} />
      </section>

      <section>
        <h2 className="mb-3 text-2xl font-bold">Albums</h2>
        <CardGrid>
          {artist.albums.map((a) => (
            <AlbumCard key={a.id} album={a} />
          ))}
        </CardGrid>
      </section>
    </div>
  );
}
