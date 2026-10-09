'use client';

import { useEffect, useRef, useState } from 'react';
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
  /** Row numbers: position in the list (default) or the file's track number (album pages, per disc). */
  numberFrom?: 'index' | 'trackNo';
  /**
   * What playing a row queues up, when it is more than `tracks`: an album split into disc
   * sections passes the whole album here so disc 2 still follows disc 1.
   */
  queue?: Track[];
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

/** Keyboard route for reordering: drag-and-drop is mouse-only, these call the same callback. */
function MoveButtons({ i, count, title, onMove }: { i: number; count: number; title: string; onMove: (dir: -1 | 1) => void }) {
  const cls =
    'rounded-full px-1.5 py-0.5 text-xs leading-none text-subdued opacity-60 hover:text-white disabled:opacity-20 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100';
  return (
    <span className="flex items-center">
      <button
        onClick={() => onMove(-1)}
        disabled={i === 0}
        className={cls}
        data-move="up"
        title="Move up"
        aria-label={`Move ${title} up`}
      >
        ▲
      </button>
      <button
        onClick={() => onMove(1)}
        disabled={i === count - 1}
        className={cls}
        data-move="down"
        title="Move down"
        aria-label={`Move ${title} down`}
      >
        ▼
      </button>
    </span>
  );
}

/**
 * Stable per-row keys. Tracks and placeholders have separate id spaces, so the prefix keeps a song
 * and a placeholder with the same numeric id apart. The schema forbids the same track twice in one
 * playlist (PRIMARY KEY (playlist_id, track_id)); the `#n` suffix is only a guard so a duplicate from
 * any future source (or an ad-hoc list) still gets a unique key instead of a React warning.
 */
function rowKeys(tracks: Track[]): string[] {
  const seen = new Map<string, number>();
  return tracks.map((t) => {
    const base = t.missing ? `p-${t.placeholderId}` : `t-${t.id}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  });
}

export default function TrackList({
  tracks,
  showAlbum = true,
  showArt = true,
  linkArtist = true,
  numberFrom = 'index',
  queue,
  onRemove,
  onRemovePlaceholder,
  onReorder,
}: Props) {
  // selectors: the list only re-renders when the current track or play state changes, not on every tick of the store
  const playQueue = usePlayer((s) => s.playQueue);
  const currentId = usePlayer((s) => (s.index >= 0 ? (s.queue[s.index]?.id ?? null) : null));
  const isPlaying = usePlayer((s) => s.isPlaying);
  const likedIds = useLikes((s) => s.ids);
  const toggleLike = useLikes((s) => s.toggle);
  // ref, not a local: a re-render mid-drag (track advances, store changes) must not lose the source index
  const dragFrom = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // after a keyboard move the row is re-inserted in the DOM, which drops focus; put it back on the same button
  const pendingFocus = useRef<{ key: string; dir: 'up' | 'down' } | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const keys = rowKeys(tracks);

  useEffect(() => {
    const p = pendingFocus.current;
    if (!p) return;
    pendingFocus.current = null;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-row-key="${p.key}"]`);
    const el = row?.querySelector<HTMLButtonElement>(`button[data-move="${p.dir}"]`);
    // the pressed button is disabled once the row reaches an end of the list, and focus() on a
    // disabled button is a no-op; fall back to the other arrow so focus stays in the list
    const target = el && !el.disabled ? el : row?.querySelector<HTMLButtonElement>('button[data-move]:not(:disabled)');
    target?.focus();
  });

  // placeholders can't play: the queue is built from real tracks only
  const playable = (queue ?? tracks).filter((t) => !t.missing);
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
  const rowNumber = (t: Track, i: number) => (numberFrom === 'trackNo' && t.trackNo > 0 ? t.trackNo : i + 1);

  const move = (i: number, dir: -1 | 1) => {
    if (!onReorder) return;
    const to = i + dir;
    if (to < 0 || to >= tracks.length) return;
    pendingFocus.current = { key: keys[i], dir: dir < 0 ? 'up' : 'down' };
    setAnnouncement(`Moved ${tracks[i].title} to position ${to + 1} of ${tracks.length}`);
    onReorder(i, to);
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
    <div ref={listRef}>
      {onReorder && (
        <div aria-live="polite" className="sr-only">
          {announcement}
        </div>
      )}
      {tracks.map((t, i) => {
        if (t.missing) {
          return (
            <div key={keys[i]} data-row-key={keys[i]} className={`${rowClass} opacity-70`} {...dragProps(i)} title="Not in your library yet">
              <div className="flex h-8 w-8 items-center justify-center text-sm text-subdued">{rowNumber(t, i)}</div>
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
                {onReorder && <MoveButtons i={i} count={tracks.length} title={t.title} onMove={(dir) => move(i, dir)} />}
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
        const liked = likedIds.has(t.id);
        return (
          <div key={keys[i]} data-row-key={keys[i]} className={rowClass} onClick={(e) => onRowClick(e, i)} {...dragProps(i)}>
            <button
              onClick={() => play(i)}
              className="relative flex h-8 w-8 items-center justify-center text-sm text-subdued"
              title="Play"
              aria-label={`Play ${t.title}`}
            >
              <span className={`md:group-hover:hidden ${isCurrent ? 'text-accent' : ''}`}>
                {isCurrent && isPlaying ? '♪' : rowNumber(t, i)}
              </span>
              <span className="hidden text-white md:group-hover:flex">
                <PlayIcon size={16} />
              </span>
            </button>
            <div className="flex min-w-0 items-center gap-3">
              {showArt && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/artwork/${t.albumId}`} alt="" className="h-10 w-10 rounded object-cover" loading="lazy" decoding="async" />
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
                onClick={() => toggleLike(t.id)}
                className={`rounded-full p-2 ${
                  liked ? 'text-accent' : 'text-subdued opacity-60 hover:text-white md:opacity-0 md:group-hover:opacity-100'
                }`}
                title="Like"
                aria-label={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
              >
                <HeartIcon size={16} filled={liked} />
              </button>
              <span className="w-10 text-right text-sm text-subdued">{fmtDuration(t.duration)}</span>
              {onReorder && <MoveButtons i={i} count={tracks.length} title={t.title} onMove={(dir) => move(i, dir)} />}
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
