'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DotsIcon, QueueIcon, PlusIcon, HeartIcon } from './Icons';
import PromptModal from './PromptModal';
import { usePlayer } from '@/store/player';
import { useLikes } from '@/store/likes';
import type { Playlist, Track } from '@/lib/types';

interface Props {
  /** One song (queue + like + playlist entries). */
  track?: Track;
  /** Many songs at once, e.g. a whole album — queue + playlist entries only. */
  tracks?: Track[];
  /** Render a labelled pill instead of the icon-only ··· button. */
  label?: string;
  /** Trigger button classes; default is the hover-reveal ··· used in track rows. */
  className?: string;
  size?: number;
}

const MENU_W = 224;
const MENU_MAX_H = 320;
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/**
 * "···" menu: add to queue, like, add to (new) playlist. The menu renders in a
 * portal at a fixed position so it works inside the player bar, the mobile
 * full-screen player and scrollable panels without clipping.
 */
export default function AddToPlaylist({ track, tracks, label, className, size = 16 }: Props) {
  const list = (tracks ?? (track ? [track] : [])).filter((t) => !t.missing && t.id > 0);
  const single = tracks ? undefined : list[0];
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addToQueue = usePlayer((s) => s.addToQueue);
  const appendTracks = usePlayer((s) => s.appendTracks);
  const likes = useLikes();

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const up = r.bottom + MENU_MAX_H > window.innerHeight && r.top > MENU_MAX_H;
    const left = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8));
    setPos(up ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    fetch('/api/playlists')
      .then((r) => r.json())
      .then((d) => setPlaylists(Array.isArray(d) ? d : []))
      .catch(() => setPlaylists([]));
    const inside = (t: EventTarget | null) =>
      !!t && (btnRef.current?.contains(t as Node) || menuRef.current?.contains(t as Node));
    const onDown = (e: Event) => {
      if (!inside(e.target)) setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, place]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const finish = (name: string) => {
    setAdded(name);
    timer.current = setTimeout(() => {
      setAdded(null);
      setOpen(false);
    }, 900);
  };

  const post = (playlistId: number) =>
    fetch(`/api/playlists/${playlistId}/tracks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackIds: list.map((t) => t.id) }),
    });

  const add = async (pl: Playlist) => {
    await post(pl.id).catch(() => {});
    finish(pl.name);
  };

  const createAndAdd = async (name: string) => {
    const res = await fetch('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const { id } = await res.json();
    if (id) await post(id).catch(() => {});
    setCreating(false);
    window.dispatchEvent(new Event('playlists-changed')); // sidebar refreshes its list
  };

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setAdded(null);
    setOpen((v) => !v);
  };

  if (list.length === 0) return null;
  const liked = single ? likes.ids.has(single.id) : false;
  const item = 'flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-highlight';

  return (
    <>
      {label ? (
        <button
          ref={btnRef}
          onClick={toggle}
          className={className ?? 'btn-pill flex items-center gap-2'}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <PlusIcon size={size} /> {label}
        </button>
      ) : (
        <button
          ref={btnRef}
          onClick={toggle}
          className={className ?? 'rounded-full p-2 text-subdued opacity-60 hover:text-white md:opacity-0 md:group-hover:opacity-100'}
          title="More options"
          aria-label="More options"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <DotsIcon size={size} />
        </button>
      )}

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: 'fixed', ...pos, width: MENU_W, maxHeight: MENU_MAX_H }}
            className="z-95 overflow-y-auto rounded-md border border-highlight bg-elevated p-1 shadow-dialog"
            onClick={stop}
            onDoubleClick={stop}
            onMouseDown={stop}
          >
            {added ? (
              <div className="px-3 py-2 text-sm font-medium text-accent">Added to {added}</div>
            ) : (
              <>
                <button
                  role="menuitem"
                  onClick={() => {
                    if (single) addToQueue(single);
                    else appendTracks(list);
                    setOpen(false);
                  }}
                  className={item}
                >
                  <QueueIcon size={14} /> {single ? 'Add to queue' : `Add ${list.length} songs to queue`}
                </button>
                {single && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      likes.toggle(single.id);
                      setOpen(false);
                    }}
                    className={item}
                  >
                    <HeartIcon size={14} filled={liked} /> {liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
                  </button>
                )}
                <div className="my-1 border-t border-highlight" />
                <div className="px-3 py-1 text-xs font-bold uppercase text-subdued">Add to playlist</div>
                <button
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    setCreating(true);
                  }}
                  className={item}
                >
                  <PlusIcon size={14} /> New playlist
                </button>
                {playlists === null &&
                  [0, 1].map((n) => (
                    <div key={n} className="px-3 py-2" aria-hidden>
                      <div className="h-3.5 w-2/3 animate-pulse rounded-sm bg-highlight" />
                    </div>
                  ))}
                {playlists?.map((pl) => (
                  <button key={pl.id} role="menuitem" onClick={() => add(pl)} className={item}>
                    <span className="truncate">{pl.name}</span>
                  </button>
                ))}
              </>
            )}
          </div>,
          document.body
        )}

      {creating &&
        createPortal(
          <div onClick={stop} onDoubleClick={stop} onMouseDown={stop}>
            <PromptModal
              title="New playlist"
              placeholder="Playlist name"
              submitLabel="Create"
              onSubmit={createAndAdd}
              onClose={() => setCreating(false)}
            />
          </div>,
          document.body
        )}
    </>
  );
}
