'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CardGrid, AlbumCard, LoadErrorState } from '@/components/Cards';
import { CardGridSkeleton, RowListSkeleton } from '@/components/Skeleton';
import { HeartIcon, PlusIcon, MusicIcon } from '@/components/Icons';
import SpotifyImport from '@/components/SpotifyImport';
import PromptModal from '@/components/PromptModal';
import PlaylistCover from '@/components/PlaylistCover';
import { getJson, isAbortError, type LoadStatus } from '@/lib/http';
import type { Album, Artist, Playlist } from '@/lib/types';

type Tab = 'playlists' | 'albums' | 'artists';

const TABS: { id: Tab; label: string }[] = [
  { id: 'playlists', label: 'Playlists' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
];

export default function LibraryPage() {
  const [tab, setTab] = useState<Tab>('playlists');
  const [albums, setAlbums] = useState<Album[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const [myArtistIds, setMyArtistIds] = useState<Set<number>>(new Set());
  const [isAdmin, setIsAdmin] = useState(false);
  // the rescan poll lives in a ref so navigating away mid-scan clears it instead of leaking a timer
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const router = useRouter();

  useEffect(() => {
    const ac = new AbortController();
    const init = { signal: ac.signal };
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    Promise.all([
      getJson<Album[]>('/api/albums', init),
      getJson<Artist[]>('/api/artists', init),
      getJson<Playlist[]>('/api/playlists', init),
    ])
      .then(([al, ar, pl]) => {
        setAlbums(al);
        setArtists(ar);
        setPlaylists(pl);
        setStatus('ready');
      })
      .catch((err) => {
        if (!isAbortError(err)) setStatus('error');
      });
    // these only affect the "My music" filter and the admin-only button; failures leave the defaults
    getJson<number[]>('/api/my-artists', init)
      .then((ids) => setMyArtistIds(new Set(ids)))
      .catch(() => {});
    getJson<{ current?: { isAdmin?: boolean } }>('/api/users', init)
      .then((d) => setIsAdmin(!!d.current?.isAdmin))
      .catch(() => {});
    return () => ac.abort();
  }, [attempt]);

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    []
  );

  // kick off a scan, then refetch the lists when it finishes: a reload here would stop playback
  const rescan = async () => {
    setScanning(true);
    const res = await fetch('/api/scan', { method: 'POST' }).catch(() => null);
    // 202 = a scan is already running; poll that one instead
    if (!res || (!res.ok && res.status !== 202)) {
      setScanning(false);
      return;
    }
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const s = await getJson<{ scanning: boolean }>('/api/scan').catch(() => null);
      if (s?.scanning) return;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      setScanning(false);
      setAttempt((n) => n + 1);
    }, 1500);
  };

  const createPlaylist = async (name: string) => {
    setCreateError(null);
    const res = await fetch('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => null) : null;
    setCreating(false);
    // a 400 (bad name) or 401 answers JSON without an id; navigating to /playlist/undefined would 404
    if (!res?.ok || typeof d?.id !== 'number') {
      setCreateError(d?.error || 'Could not create the playlist; try again.');
      return;
    }
    window.dispatchEvent(new Event('playlists-changed')); // sidebar refreshes its list
    router.push(`/playlist/${d.id}`);
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
          onImported={() => getJson<Playlist[]>('/api/playlists').then(setPlaylists).catch(() => {})}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-4 text-3xl font-bold">Your Library</h1>
        <div role="tablist" aria-label="Library sections" className="flex flex-wrap items-center gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`library-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`library-panel-${t.id}`}
              className={tabClass(t.id)}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Link href="/radios" className="rounded-full bg-highlight px-4 py-1.5 text-sm font-medium text-white hover:bg-press">
          Radio
        </Link>
        <button
          onClick={() => setMine((v) => !v)}
          aria-pressed={mine}
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

      {status === 'error' && <LoadErrorState what="your library" onRetry={() => setAttempt((n) => n + 1)} />}

      {tab === 'playlists' && (
        <div role="tabpanel" id="library-panel-playlists" aria-labelledby="library-tab-playlists" className="space-y-2">
          <Link href="/liked" className="flex items-center gap-4 rounded-lg bg-elevated p-3 hover:bg-highlight">
            <div className="flex h-16 w-16 items-center justify-center rounded-sm bg-linear-to-br from-indigo-600 to-white/80">
              <HeartIcon size={24} filled className="text-white" />
            </div>
            <div>
              <div className="font-bold">Liked Songs</div>
              <div className="text-sm text-subdued">Playlist</div>
            </div>
          </Link>
          {status === 'loading' && <RowListSkeleton count={3} />}
          {playlists.map((pl) => (
            <Link key={pl.id} href={`/playlist/${pl.id}`} className="flex items-center gap-4 rounded-lg bg-elevated p-3 hover:bg-highlight">
              <PlaylistCover artIds={pl.artIds} size="md" />
              <div>
                <div className="font-bold">{pl.name}</div>
                <div className="text-sm text-subdued">
                  Playlist · {pl.trackCount} songs
                  {pl.missingCount ? <span className="text-warning"> · {pl.missingCount} missing</span> : null}
                </div>
              </div>
            </Link>
          ))}
          <button
            onClick={() => {
              setCreateError(null);
              setCreating(true);
            }}
            className="flex w-full items-center gap-4 rounded-lg bg-elevated p-3 text-left hover:bg-highlight"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-sm bg-highlight">
              <PlusIcon size={24} className="text-subdued" />
            </div>
            <div className="font-bold">Create playlist</div>
          </button>
          {createError && (
            <div role="alert" className="rounded-sm bg-negative/10 px-3 py-2 text-sm text-negative">
              {createError}
            </div>
          )}
          <button onClick={() => setImportOpen(true)} className="flex w-full items-center gap-4 rounded-lg bg-elevated p-3 text-left hover:bg-highlight">
            <div className="flex h-16 w-16 items-center justify-center rounded-sm bg-highlight">
              <MusicIcon size={24} className="text-accent" />
            </div>
            <div>
              <div className="font-bold">Import from Spotify</div>
              <div className="text-sm text-subdued">Rebuild your Spotify playlists from local files; songs you don&apos;t own stay as placeholders</div>
            </div>
          </button>
        </div>
      )}

      {tab === 'albums' && (
        <div role="tabpanel" id="library-panel-albums" aria-labelledby="library-tab-albums">
          {status === 'loading' ? (
            <CardGridSkeleton count={14} />
          ) : (
            <CardGrid>
              {(mine ? albums.filter((a) => myArtistIds.has(a.artistId)) : albums).map((a) => (
                <AlbumCard key={a.id} album={a} />
              ))}
            </CardGrid>
          )}
        </div>
      )}

      {tab === 'artists' && (
        <div role="tabpanel" id="library-panel-artists" aria-labelledby="library-tab-artists">
          {status === 'loading' ? (
            <RowListSkeleton count={8} />
          ) : (
            <div className="grid grid-cols-1 gap-1 md:grid-cols-2 xl:grid-cols-3">
              {(mine ? artists.filter((a) => myArtistIds.has(a.id)) : artists).map((a) => (
                <Link
                  key={a.id}
                  href={`/artist/${a.id}`}
                  className="flex items-center gap-3 rounded-sm px-2 py-1.5 hover:bg-white/10"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/artwork/artist/${a.id}?l=${encodeURIComponent(a.name.charAt(0))}`}
                    alt=""
                    className="h-11 w-11 shrink-0 rounded-full object-cover"
                    loading="lazy"
                    decoding="async"
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
      )}
    </div>
  );
}
