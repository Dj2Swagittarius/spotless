'use client';

import { use, useEffect, useState } from 'react';
import { usePlayer } from '@/store/player';
import TrackList from '@/components/TrackList';
import { CardGrid, AlbumCard, LoadErrorState, NotFoundState } from '@/components/Cards';
import { DetailHeaderSkeleton, RowListSkeleton } from '@/components/Skeleton';
import { PlayIcon } from '@/components/Icons';
import { getJson, isAbortError, failureStatus, type LoadStatus } from '@/lib/http';
import type { Artist, Album, Track } from '@/lib/types';

type ArtistDetail = Artist & { albums: Album[]; topTracks: Track[] };

export default function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const [collected, setCollected] = useState(false);
  const playQueue = usePlayer((s) => s.playQueue);

  useEffect(() => {
    const ac = new AbortController();
    setStatus('loading');
    getJson<ArtistDetail>(`/api/artists/${id}`, { signal: ac.signal })
      .then((d) => {
        setArtist(d);
        setStatus('ready');
      })
      .catch((err) => {
        if (!isAbortError(err)) setStatus(failureStatus(err));
      });
    // collection flag is cosmetic: a failure here just leaves the button in its default state
    getJson<number[]>('/api/my-artists', { signal: ac.signal })
      .then((ids) => setCollected(ids.includes(Number(id))))
      .catch(() => {});
    return () => ac.abort();
  }, [id, attempt]);

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

  if (status === 'notfound') return <NotFoundState what="artist" />;
  if (status === 'error') return <LoadErrorState what="this artist" onRetry={() => setAttempt((n) => n + 1)} />;
  if (status === 'loading' || !artist)
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
        aria-label="Play top tracks"
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
        <TrackList tracks={artist.topTracks} linkArtist={false} />
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
