'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { HomeIcon, SearchIcon, LibraryIcon, PlusIcon, HeartIcon, MusicIcon, GearIcon, QueueIcon, TrendIcon, RadioIcon } from './Icons';
import PromptModal from './PromptModal';
import PlaylistCover from './PlaylistCover';
import type { Playlist, Album, Artist } from '@/lib/types';

type LibTab = 'playlists' | 'albums' | 'artists';

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [tab, setTab] = useState<LibTab>('playlists');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch('/api/playlists').then((r) => r.json()).then(setPlaylists).catch(() => {});
  }, [pathname]);

  useEffect(() => {
    if (tab === 'albums' && albums.length === 0)
      fetch('/api/albums').then((r) => r.json()).then(setAlbums).catch(() => {});
    if (tab === 'artists' && artists.length === 0)
      fetch('/api/artists').then((r) => r.json()).then(setArtists).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const createPlaylist = async (name: string) => {
    const res = await fetch('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const { id } = await res.json();
    setCreating(false);
    router.push(`/playlist/${id}`);
  };

  const navClass = (active: boolean) =>
    `flex items-center gap-4 px-3 py-2 rounded font-bold transition-colors ${
      active ? 'text-white' : 'text-subdued hover:text-white'
    }`;

  const chip = (t: LibTab, label: string) => (
    <button
      key={t}
      onClick={() => setTab(t)}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        tab === t ? 'bg-white text-black' : 'bg-highlight text-white hover:bg-press'
      }`}
    >
      {label}
    </button>
  );

  const rowClass = (active: boolean) =>
    `flex w-full items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-highlight ${active ? 'bg-elevated' : ''}`;

  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-2 md:flex">
      {creating && (
        <PromptModal title="Create playlist" placeholder="Playlist name" submitLabel="Create" onSubmit={createPlaylist} onClose={() => setCreating(false)} />
      )}
      <nav className="rounded-lg bg-base px-2 py-3">
        <Link href="/" className={navClass(pathname === '/')}>
          <HomeIcon size={24} /> Home
        </Link>
        <Link href="/search" className={navClass(pathname === '/search')}>
          <SearchIcon size={24} /> Search
        </Link>
        <Link href="/discover" className={navClass(pathname === '/discover')}>
          <MusicIcon size={24} /> Discover
        </Link>
        <Link href="/trending" className={navClass(pathname === '/trending')}>
          <TrendIcon size={24} /> Trending
        </Link>
        <Link href="/radios" className={navClass(pathname === '/radios')}>
          <RadioIcon size={24} /> Radio
        </Link>
        <Link href="/stats" className={navClass(pathname === '/stats')}>
          <QueueIcon size={24} /> Stats
        </Link>
        <Link href="/settings" className={navClass(pathname === '/settings')}>
          <GearIcon size={24} /> Settings
        </Link>
      </nav>
      <div className="flex min-h-0 flex-1 flex-col rounded-lg bg-base">
        <div className="flex items-center justify-between px-4 pb-1 pt-3">
          <Link href="/library" className={`flex items-center gap-3 font-bold ${pathname === '/library' ? 'text-white' : 'text-subdued hover:text-white'}`}>
            <LibraryIcon size={24} /> Your Library
          </Link>
          <button onClick={() => setCreating(true)} className="rounded-full p-1 text-subdued hover:bg-highlight hover:text-white" title="Create playlist" aria-label="Create playlist">
            <PlusIcon size={20} />
          </button>
        </div>
        <div className="flex gap-1.5 px-3 pb-2 pt-1">
          {chip('playlists', 'Playlists')}
          {chip('albums', 'Albums')}
          {chip('artists', 'Artists')}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {tab === 'playlists' && (
            <>
              <Link href="/liked" className={rowClass(pathname === '/liked')}>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded bg-gradient-to-br from-indigo-600 to-white/80">
                  <HeartIcon size={18} filled className="text-white" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">Liked Songs</div>
                  <div className="text-xs text-subdued">Playlist</div>
                </div>
              </Link>
              {playlists.map((pl) => (
                <Link key={pl.id} href={`/playlist/${pl.id}`} className={rowClass(pathname === `/playlist/${pl.id}`)}>
                  <PlaylistCover artIds={pl.artIds} size="sm" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{pl.name}</div>
                    <div className="truncate text-xs text-subdued">Playlist · {pl.trackCount} songs</div>
                  </div>
                </Link>
              ))}
            </>
          )}
          {tab === 'albums' &&
            albums.map((a) => (
              <Link key={a.id} href={`/album/${a.id}`} className={rowClass(pathname === `/album/${a.id}`)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/artwork/${a.id}`} alt="" className="h-11 w-11 shrink-0 rounded object-cover" loading="lazy" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{a.name}</div>
                  <div className="truncate text-xs text-subdued">{a.artist}</div>
                </div>
              </Link>
            ))}
          {tab === 'artists' &&
            artists.map((a) => (
              <Link key={a.id} href={`/artist/${a.id}`} className={rowClass(pathname === `/artist/${a.id}`)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/artwork/artist/${a.id}?l=${encodeURIComponent(a.name.charAt(0))}`}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-full object-cover"
                  loading="lazy"
                />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{a.name}</div>
                  <div className="truncate text-xs text-subdued">Artist</div>
                </div>
              </Link>
            ))}
        </div>
      </div>
    </aside>
  );
}
