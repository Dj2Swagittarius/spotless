'use client';

import Link from 'next/link';
import { usePlayer } from '@/store/player';
import { useLikes } from '@/store/likes';
import { fmtDuration } from '@/lib/format';
import { HeartIcon, PlayIcon, XIcon } from './Icons';
import AddToPlaylist from './AddToPlaylist';
import type { Track } from '@/lib/types';

interface Props {
  tracks: Track[];
  showAlbum?: boolean;
  showArt?: boolean;
  onRemove?: (trackId: number) => void;
  onReorder?: (from: number, to: number) => void;
}

export default function TrackList({ tracks, showAlbum = true, showArt = true, onRemove, onReorder }: Props) {
  const { playQueue, queue, index, isPlaying } = usePlayer();
  const likes = useLikes();
  const currentId = index >= 0 ? queue[index]?.id : null;
  let dragFrom: number | null = null;

  return (
    <div>
      {tracks.map((t, i) => {
        const isCurrent = t.id === currentId;
        return (
          <div
            key={`${t.id}-${i}`}
            className={`group grid grid-cols-[2rem_1fr_auto] items-center gap-3 rounded px-2 py-1.5 hover:bg-white/10 sm:grid-cols-[2rem_4fr_3fr_auto] ${onReorder ? 'cursor-grab active:cursor-grabbing' : ''}`}
            onDoubleClick={() => playQueue(tracks, i)}
            draggable={!!onReorder}
            onDragStart={onReorder ? () => (dragFrom = i) : undefined}
            onDragOver={onReorder ? (e) => e.preventDefault() : undefined}
            onDrop={
              onReorder
                ? (e) => {
                    e.preventDefault();
                    if (dragFrom !== null && dragFrom !== i) onReorder(dragFrom, i);
                    dragFrom = null;
                  }
                : undefined
            }
          >
            <button
              onClick={() => playQueue(tracks, i)}
              className="relative flex h-8 w-8 items-center justify-center text-sm text-subdued"
              title="Play"
              aria-label={`Play ${t.title}`}
            >
              <span className={`md:group-hover:hidden ${isCurrent ? 'text-accent' : ''}`}>
                {isCurrent && isPlaying ? '♪' : i + 1}
              </span>
              <span className="hidden text-white md:group-hover:flex">
                <PlayIcon size={16} />
              </span>
            </button>
            <div className="flex min-w-0 items-center gap-3">
              {showArt && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/artwork/${t.albumId}`} alt="" className="h-10 w-10 rounded object-cover" loading="lazy" />
              )}
              <div className="min-w-0">
                <div className={`truncate font-medium ${isCurrent ? 'text-accent' : ''}`}>{t.title}</div>
                <Link
                  href={`/artist/${t.artistId}`}
                  className="block truncate text-sm text-subdued hover:text-white hover:underline"
                >
                  {t.artist}
                </Link>
              </div>
            </div>
            {showAlbum ? (
              <Link
                href={`/album/${t.albumId}`}
                className="hidden truncate text-sm text-subdued hover:text-white hover:underline sm:block"
              >
                {t.album}
              </Link>
            ) : (
              <div className="hidden sm:block" />
            )}
            <div className="flex items-center gap-1">
              <button
                onClick={() => likes.toggle(t.id)}
                className={`rounded-full p-2 ${
                  likes.ids.has(t.id) ? 'text-accent' : 'text-subdued opacity-60 hover:text-white md:opacity-0 md:group-hover:opacity-100'
                }`}
                title="Like"
                aria-label={likes.ids.has(t.id) ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
              >
                <HeartIcon size={16} filled={likes.ids.has(t.id)} />
              </button>
              <span className="w-10 text-right text-sm text-subdued">{fmtDuration(t.duration)}</span>
              <AddToPlaylist track={t} />
              {onRemove && (
                <button
                  onClick={() => onRemove(t.id)}
                  className="rounded-full p-2 text-subdued opacity-60 hover:text-white md:opacity-0 md:group-hover:opacity-100"
                  title="Remove"
                  aria-label="Remove from playlist"
                >
                  <XIcon size={16} />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
