'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { usePlayer } from '@/store/player';
import { useLikes } from '@/store/likes';
import { fmtDuration } from '@/lib/format';
import { HeartIcon, MusicIcon, PlayIcon, XIcon } from './Icons';
import AddToPlaylist from './AddToPlaylist';
import type { Track } from '@/lib/types';

interface Props {
  tracks: Track[];
  showAlbum?: boolean;
  showArt?: boolean;
  /** Off on an artist's own page, where linking back to it would just reload the page. */
  linkArtist?: boolean;
  onRemove?: (trackId: number) => void;
  /** Placeholder rows (songs not in the library) get an X that calls this with the placeholder id. */
  onRemovePlaceholder?: (placeholderId: number) => void;
  onReorder?: (from: number, to: number) => void;
}

/** "Get" button on a placeholder row: sends the album (or whole artist) to Lidarr. */
function GetButton({ artist, album }: { artist: string; album: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'requested' | 'failed'>('idle');
  const go = async () => {
    setState('busy');
    const res = await fetch('/api/lidarr/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist, album }),
    }).catch(() => null);
    setState(res?.status === 202 ? 'requested' : res?.ok ? 'sent' : 'failed');
  };
  const text = { idle: 'Get', busy: '…', sent: '✓ Sent', requested: '✓ Requested', failed: 'Failed' }[state];
  return (
    <button
      onClick={go}
      disabled={state !== 'idle'}
      className="rounded-full border border-subdued px-2 py-0.5 text-xs text-subdued hover:border-white hover:text-white disabled:opacity-70"
      title={album ? `Download "${album}" via Lidarr` : `Download ${artist} via Lidarr`}
    >
      {text}
    </button>
  );
}

export default function TrackList({
  tracks,
  showAlbum = true,
  showArt = true,
  linkArtist = true,
  onRemove,
  onRemovePlaceholder,
  onReorder,
}: Props) {
  const { playQueue, queue, index, isPlaying } = usePlayer();
  const likes = useLikes();
  const currentId = index >= 0 ? queue[index]?.id : null;
  // ref, not a local: a re-render mid-drag (track advances, store changes) must not lose the source index
  const dragFrom = useRef<number | null>(null);

  // placeholders can't play: the queue is built from real tracks only
  const playable = tracks.filter((t) => !t.missing);
  const play = (i: number) => {
    const t = tracks[i];
    if (t.missing) return;
    playQueue(playable, playable.indexOf(t));
  };
  // a single click anywhere on the row plays it; links and buttons inside the row keep their own action
  const onRowClick = (e: React.MouseEvent, i: number) => {
    if ((e.target as HTMLElement).closest('a, button')) return;
    play(i);
  };

  const rowClass = `group grid grid-cols-[2rem_1fr_auto] items-center gap-3 rounded px-2 py-1.5 hover:bg-white/10 sm:grid-cols-[2rem_4fr_3fr_auto] ${
    onReorder ? 'cursor-grab active:cursor-grabbing' : ''
  }`;
  const dragProps = (i: number) =>
    onReorder
      ? {
          draggable: true,
          onDragStart: () => {
            dragFrom.current = i;
          },
          onDragOver: (e: React.DragEvent) => e.preventDefault(),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const from = dragFrom.current;
            if (from !== null && from !== i) onReorder(from, i);
            dragFrom.current = null;
          },
        }
      : {};

  return (
    <div>
      {tracks.map((t, i) => {
        if (t.missing) {
          return (
            <div key={`p-${t.placeholderId}`} className={`${rowClass} opacity-70`} {...dragProps(i)} title="Not in your library yet">
              <div className="flex h-8 w-8 items-center justify-center text-sm text-subdued">{i + 1}</div>
              <div className="flex min-w-0 items-center gap-3">
                {showArt && (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-highlight">
                    <MusicIcon size={16} className="text-subdued" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate font-medium text-subdued">{t.title}</div>
                  <div className="truncate text-sm text-subdued">{t.artist}</div>
                </div>
              </div>
              {showAlbum ? <div className="hidden truncate text-sm text-subdued sm:block">{t.album}</div> : <div className="hidden sm:block" />}
              <div className="flex items-center gap-2">
                <span className="hidden rounded border border-subdued/50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-subdued lg:inline">
                  Not in library
                </span>
                <GetButton artist={t.artist} album={t.album} />
                <span className="w-10 text-right text-sm text-subdued">{fmtDuration(t.duration)}</span>
                {onRemovePlaceholder && (
                  <button
                    onClick={() => onRemovePlaceholder(t.placeholderId!)}
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
        }

        const isCurrent = t.id === currentId;
        return (
          <div key={`${t.id}-${i}`} className={rowClass} onClick={(e) => onRowClick(e, i)} {...dragProps(i)}>
            <button
              onClick={() => play(i)}
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
                {linkArtist ? (
                  <Link
                    href={`/artist/${t.artistId}`}
                    className="block truncate text-sm text-subdued hover:text-white hover:underline"
                  >
                    {t.artist}
                  </Link>
                ) : (
                  <div className="truncate text-sm text-subdued">{t.artist}</div>
                )}
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
