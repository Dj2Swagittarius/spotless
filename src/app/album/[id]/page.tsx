'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePlayer } from '@/store/player';
import TrackList from '@/components/TrackList';
import AddToPlaylist from '@/components/AddToPlaylist';
import { LoadErrorState, NotFoundState } from '@/components/Cards';
import { DetailHeaderSkeleton, RowListSkeleton } from '@/components/Skeleton';
import { PlayIcon } from '@/components/Icons';
import { fmtTotal } from '@/lib/format';
import { getJson, isAbortError, failureStatus, type LoadStatus } from '@/lib/http';
import type { Album, Track } from '@/lib/types';

type AlbumDetail = Album & { tracks: Track[] };

/** Splits an album into its discs, in disc order; a single-disc album yields one group. */
function groupByDisc(tracks: Track[]): { disc: number; tracks: Track[] }[] {
  const groups = new Map<number, Track[]>();
  for (const t of tracks) {
    const disc = t.discNo > 0 ? t.discNo : 1;
    const list = groups.get(disc);
    if (list) list.push(t);
    else groups.set(disc, [t]);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([disc, list]) => ({ disc, tracks: list }));
}

export default function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const playQueue = usePlayer((s) => s.playQueue);

  useEffect(() => {
    const ac = new AbortController();
    setStatus('loading');
    getJson<AlbumDetail>(`/api/albums/${id}`, { signal: ac.signal })
      .then((d) => {
        setAlbum(d);
        setStatus('ready');
      })
      .catch((err) => {
        if (!isAbortError(err)) setStatus(failureStatus(err));
      });
    return () => ac.abort();
  }, [id, attempt]);

  if (status === 'notfound') return <NotFoundState what="album" />;
  if (status === 'error') return <LoadErrorState what="this album" onRetry={() => setAttempt((n) => n + 1)} />;
  if (status === 'loading' || !album)
    return (
      <div className="space-y-6">
        <DetailHeaderSkeleton />
        <RowListSkeleton count={8} />
      </div>
    );

  const discs = groupByDisc(album.tracks);

  return (
    <div className="space-y-6">
      <header className="flex flex-col items-center gap-6 rounded-lg bg-linear-to-b from-white/10 to-transparent p-6 sm:flex-row sm:items-end">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/artwork/${album.id}`} alt={album.name} className="h-48 w-48 rounded-sm shadow-2xl sm:h-56 sm:w-56" />
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

      <div className="flex items-center gap-4">
        <button
          onClick={() => playQueue(album.tracks, 0)}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-black shadow-lg transition-transform hover:scale-105 hover:bg-accentBright"
          title="Play album"
          aria-label="Play album"
        >
          <PlayIcon size={24} />
        </button>
        <AddToPlaylist tracks={album.tracks} label="Add to playlist" />
      </div>

      {discs.length > 1 ? (
        // multi-disc: one section per disc, numbered by the file's track number, but playing any row queues the whole album
        <div className="space-y-6">
          {discs.map((d) => (
            <section key={d.disc}>
              <h2 className="mb-2 px-2 text-sm font-bold uppercase tracking-widest text-subdued">Disc {d.disc}</h2>
              <TrackList tracks={d.tracks} queue={album.tracks} numberFrom="trackNo" showAlbum={false} showArt={false} />
            </section>
          ))}
        </div>
      ) : (
        <TrackList tracks={album.tracks} showAlbum={false} showArt={false} />
      )}
    </div>
  );
}
