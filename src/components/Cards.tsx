'use client';

import Link from 'next/link';
import { usePlayer } from '@/store/player';
import { PlayIcon } from './Icons';
import type { Album, Artist, Track } from '@/lib/types';

export function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-5 xl:grid-cols-7">{children}</div>;
}

export function AlbumCard({ album }: { album: Album }) {
  const playQueue = usePlayer((s) => s.playQueue);
  const play = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const d = await fetch(`/api/albums/${album.id}`).then((r) => r.json()).catch(() => null);
    if (d?.tracks?.length) playQueue(d.tracks, 0);
  };
  return (
    <Link href={`/album/${album.id}`} className="group rounded-lg bg-elevated p-2 transition-colors hover:bg-highlight">
      <div className="relative mb-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/artwork/${album.id}`} alt={album.name} className="aspect-square w-full rounded object-cover shadow-lg" loading="lazy" />
        <button
          onClick={play}
          aria-label={`Play ${album.name}`}
          className="absolute bottom-2 right-2 hidden h-11 w-11 translate-y-2 items-center justify-center rounded-full bg-accent text-black opacity-0 shadow-xl transition-all group-hover:translate-y-0 group-hover:opacity-100 md:flex"
        >
          <PlayIcon size={20} />
        </button>
      </div>
      <div className="truncate text-sm font-semibold">{album.name}</div>
      <div className="truncate text-xs text-subdued">
        {album.year ? `${album.year} · ` : ''}
        {album.artist}
      </div>
    </Link>
  );
}

export function ArtistCard({ artist }: { artist: Artist }) {
  return (
    <Link href={`/artist/${artist.id}`} className="group rounded-lg bg-elevated p-2 text-center transition-colors hover:bg-highlight">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/artwork/artist/${artist.id}?l=${encodeURIComponent(artist.name.charAt(0))}`}
        alt={artist.name}
        className="mx-auto mb-2 aspect-square w-full rounded-full object-cover shadow-lg"
        loading="lazy"
      />
      <div className="truncate text-sm font-semibold">{artist.name}</div>
      <div className="text-xs text-subdued">Artist</div>
    </Link>
  );
}

export function MixCard({ title, tracks }: { title: string; tracks: Track[] }) {
  const playQueue = usePlayer((s) => s.playQueue);
  return (
    <button
      onClick={() => playQueue(tracks, 0)}
      className="group relative rounded-lg bg-elevated p-2 text-left transition-colors hover:bg-highlight"
    >
      <div className="relative mb-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/artwork/${tracks[0]?.albumId}`} alt={title} className="aspect-square w-full rounded object-cover shadow-lg" loading="lazy" />
        <span className="absolute bottom-2 right-2 flex h-11 w-11 translate-y-2 items-center justify-center rounded-full bg-accent text-black opacity-0 shadow-xl transition-all group-hover:translate-y-0 group-hover:opacity-100">
          <PlayIcon size={20} />
        </span>
      </div>
      <div className="truncate text-sm font-semibold">{title}</div>
      <div className="truncate text-xs text-subdued">
        {tracks
          .slice(0, 3)
          .map((t) => t.artist)
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(', ')}
      </div>
    </button>
  );
}
