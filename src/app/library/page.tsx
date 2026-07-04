'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CardGrid, AlbumCard } from '@/components/Cards';
import { HeartIcon, PlusIcon, MusicIcon } from '@/components/Icons';
import SpotifyImport from '@/components/SpotifyImport';
import PromptModal from '@/components/PromptModal';
import PlaylistCover from '@/components/PlaylistCover';
import type { Album, Artist, Playlist } from '@/lib/types';

type Tab = 'playlists' | 'albums' | 'artists';

export default function LibraryPage() {
  const [tab, setTab] = useState<Tab>('playlists');
  const [albums, setAlbums] = useState<Album[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [scanning, setScanning] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mine, setMine] = useState(false);
  const [myArtistIds, setMyArtistIds] = useState<Set<number>>(new Set());
  const [isAdmin, setIsAdmin] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/albums').then((r) => r.json()).then(setAlbums).catch(() => {});
    fetch('/api/artists').then((r) => r.json()).then(setArtists).catch(() => {});
    fetch('/api/playlists').then((r) => r.json()).then(setPlaylists).catch(() => {});
    fetch('/api/my-artists').then((r) => r.json()).then((ids: number[]) => setMyArtistIds(new Set(ids))).catch(() => {});
    fetch('/api/users').then((r) => r.json()).then((d) => setIsAdmin(!!d.current?.isAdmin)).catch(() => {});
  }, []);

  const rescan = async () => {
    setScanning(true);
    await fetch('/api/scan', { method: 'POST' });
    const poll = setInterval(async () => {
      const s = await fetch('/api/scan').then((r) => r.json());
      if (!s.scanning) {
        clearInterval(poll);
        setScanning(false);
        location.reload();
      }
    }, 1500);
  };

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

  const tabClass = (t: Tab) =>
    `rounded-full px-4 py-1.5 text-sm font-medium ${tab === t ? 'bg-white text-black' : 'bg-highlight text-white hover:bg-press'}`;

  return (
    <div className="space-y-6">
      {creating && (
        <PromptModal title="Create playlist" placeholder="Playlist name" submitLabel="Create" onSubmit={createPlaylist} onClose={() => setCreating(false)} />
      )}
      {importOpen && (
        <SpotifyImport
          onClose={() => setImportOpen(false)}
          onImported={() => fetch('/api/playlists').then((r) => r.json()).then(setPlaylists).catch(() => {})}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-4 text-3xl font-bold">Your Library</h1>
        <button className={tabClass('playlists')} onClick={() => setTab('playlists')}>Playlists</button>
        <button className={tabClass('albums')} onClick={() => setTab('albums')}>Albums</button>
        <button className={tabClass('artists')} onClick={() => setTab('artists')}>Artists</button>
        <button
          onClick={() => setMine((v) => !v)}
          className={`rounded-full px-4 py-1.5 text-sm font-medium ${mine ? 'bg-accent text-black' : 'bg-highlight text-white hover:bg-press'}`}
          title="Only artists you added to My music"
        >
          My music
        </button>
        <div className="flex-1" />
        {isAdmin && (
          <button
            onClick={rescan}
            disabled={scanning}
            className="btn-pill"
          >
            {scanning ? 'Scanning…' : 'Rescan library'}
          </button>
        )}
      </div>

      {tab === 'playlists' && (
        <div className="space-y-2">
          <Link href="/liked" className="flex items-center gap-4 rounded-lg bg-elevated p-3 hover:bg-highlight">
            <div className="flex h-16 w-16 items-center justify-center rounded bg-gradient-to-br from-indigo-600 to-white/80">
              <HeartIcon size={24} filled className="text-white" />
            </div>
            <div>
              <div className="font-bold">Liked Songs</div>
              <div className="text-sm text-subdued">Playlist</div>
            </div>
          </Link>
          {playlists.map((pl) => (
            <Link key={pl.id} href={`/playlist/${pl.id}`} className="flex items-center gap-4 rounded-lg bg-elevated p-3 hover:bg-highlight">
              <PlaylistCover artIds={pl.artIds} size="md" />
              <div>
                <div className="font-bold">{pl.name}</div>
                <div className="text-sm text-subdued">Playlist · {pl.trackCount} songs</div>
              </div>
            </Link>
          ))}
          <button onClick={() => setCreating(true)} className="flex w-full items-center gap-4 rounded-lg bg-elevated p-3 text-left hover:bg-highlight">
            <div className="flex h-16 w-16 items-center justify-center rounded bg-highlight">
              <PlusIcon size={24} className="text-subdued" />
            </div>
            <div className="font-bold">Create playlist</div>
          </button>
          <button onClick={() => setImportOpen(true)} className="flex w-full items-center gap-4 rounded-lg bg-elevated p-3 text-left hover:bg-highlight">
            <div className="flex h-16 w-16 items-center justify-center rounded bg-highlight">
              <MusicIcon size={24} className="text-accent" />
            </div>
            <div>
              <div className="font-bold">Import from Spotify</div>
              <div className="text-sm text-subdued">Rebuild your Spotify playlists from local files</div>
            </div>
          </button>
        </div>
      )}

      {tab === 'albums' && (
        <CardGrid>
          {(mine ? albums.filter((a) => myArtistIds.has(a.artistId)) : albums).map((a) => (
            <AlbumCard key={a.id} album={a} />
          ))}
        </CardGrid>
      )}

      {tab === 'artists' && (
        <div className="grid grid-cols-1 gap-1 md:grid-cols-2 xl:grid-cols-3">
          {(mine ? artists.filter((a) => myArtistIds.has(a.id)) : artists).map((a) => (
            <Link
              key={a.id}
              href={`/artist/${a.id}`}
              className="flex items-center gap-3 rounded px-2 py-1.5 hover:bg-white/10"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/artwork/artist/${a.id}?l=${encodeURIComponent(a.name.charAt(0))}`}
                alt=""
                className="h-11 w-11 shrink-0 rounded-full object-cover"
                loading="lazy"
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{a.name}</div>
                <div className="text-xs text-subdued">
                  {a.albumCount} {a.albumCount === 1 ? 'album' : 'albums'} · {a.trackCount} songs
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
