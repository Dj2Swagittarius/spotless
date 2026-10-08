'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import TrackList from '@/components/TrackList';
import { CardGrid, AlbumCard, ArtistCard, LoadErrorState } from '@/components/Cards';
import { SearchIcon, PlayIcon, PauseIcon, MicIcon } from '@/components/Icons';
import { getJson, isAbortError, type LoadStatus } from '@/lib/http';
import type { Track, Album, Artist } from '@/lib/types';

interface Results {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
}

interface DzArtist {
  name: string;
  image: string | null;
  fans: number;
  deezerUrl: string;
}

interface DzAlbum {
  title: string;
  artist: string;
  cover: string | null;
  deezerUrl: string;
}

interface DzTrack {
  title: string;
  artist: string;
  album: string;
  cover: string | null;
  previewUrl: string | null;
  deezerUrl: string;
}

interface DzResults {
  artists: DzArtist[];
  albums: DzAlbum[];
  tracks: DzTrack[];
}

interface DlButtonProps {
  artist: string;
  /** Stable id for this row's download state. */
  k: string;
  album?: string;
  /** Current state for `k`: 'busy' | 'ok' | 'requested' | 'err:<reason>' | undefined. */
  state: string | undefined;
  lidarrConfigured: boolean;
  isAdmin: boolean;
  onDownload: (artist: string, key: string, album?: string) => void;
}

// module scope on purpose: declared inside the page it would be a new component type on every
// render, remounting every button (and dropping focus) whenever any state changed
function DlButton({ artist, k, album, state, lidarrConfigured, isAdmin, onDownload }: DlButtonProps) {
  if (!lidarrConfigured) return null;
  if (state === 'busy') return <span className="text-xs text-subdued">Sending…</span>;
  if (state === 'ok') return <span className="text-xs font-medium text-accent">✓ Sent to Lidarr</span>;
  if (state === 'requested') return <span className="text-xs font-medium text-accent">✓ Requested</span>;
  if (state?.startsWith('err')) return <span className="text-xs text-negative" title={state}>Failed</span>;
  const what = album ? `"${album}" by ${artist}` : artist;
  return (
    <button
      onClick={() => onDownload(artist, k, album)}
      className="rounded-full border border-border px-2.5 py-0.5 text-xs font-bold uppercase tracking-[0.06em] text-subdued hover:border-white hover:text-white"
      title={isAdmin ? `Download ${what} via Lidarr` : `Request download of ${what}`}
    >
      {isAdmin ? '⤓ Lidarr' : '⤓ Request'}
    </button>
  );
}

export default function SearchPage() {
  // useSearchParams needs a Suspense boundary so the page can still prerender
  return (
    <Suspense>
      <Search />
    </Suspense>
  );
}

function Search() {
  // the searchParams page prop came back empty, so ?q= from the top bar never reached the page
  const urlQ = useSearchParams().get('q') ?? undefined;
  const [q, setQ] = useState(urlQ ?? '');
  const [results, setResults] = useState<Results | null>(null);
  const [status, setStatus] = useState<LoadStatus>('ready');
  const [attempt, setAttempt] = useState(0);
  const [dz, setDz] = useState<DzResults | null>(null);
  const [lidarrConfigured, setLidarrConfigured] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [dlState, setDlState] = useState<Record<string, string>>({});
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    getJson<{ configured: boolean }>('/api/settings/lidarr', { signal: ac.signal })
      .then((d) => setLidarrConfigured(Boolean(d.configured)))
      .catch(() => {});
    getJson<{ current?: { isAdmin?: boolean } }>('/api/users', { signal: ac.signal })
      .then((d) => setIsAdmin(!!d.current?.isAdmin))
      .catch(() => {});
    return () => {
      ac.abort();
      audioRef.current?.pause();
    };
  }, []);

  // desktop top bar drives the URL; follow it
  useEffect(() => {
    if (urlQ !== undefined && urlQ !== q) setQ(urlQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ]);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setResults(null);
      setDz(null);
      setStatus('ready');
      return;
    }
    // one controller per debounce tick: typing on cancels the in-flight requests, so a slow
    // response for an older query can never land on top of the newer results
    const ac = new AbortController();
    const t = setTimeout(() => {
      setStatus('loading');
      getJson<Results>(`/api/search?q=${encodeURIComponent(query)}`, { signal: ac.signal })
        .then((d) => {
          setResults(d);
          setStatus('ready');
        })
        .catch((err) => {
          if (!isAbortError(err)) setStatus('error');
        });
      // Deezer is a bonus: when it fails the library results still show
      getJson<DzResults>(`/api/search/deezer?q=${encodeURIComponent(query)}`, { signal: ac.signal })
        .then(setDz)
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [q, attempt]);

  const download = async (artist: string, key: string, album?: string) => {
    setDlState((s) => ({ ...s, [key]: 'busy' }));
    const res = await fetch('/api/lidarr/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(album ? { artist, album } : { artist }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setDlState((s) => ({
      ...s,
      [key]: res?.ok ? (data.status === 'requested' ? 'requested' : 'ok') : `err:${data.error ?? 'failed'}`,
    }));
  };

  const togglePreview = (url: string) => {
    if (playingUrl === url) {
      audioRef.current?.pause();
      setPlayingUrl(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(url);
    audio.volume = 0.8;
    audio.onended = () => setPlayingUrl(null);
    audio.play().catch(() => setPlayingUrl(null));
    audioRef.current = audio;
    setPlayingUrl(url);
  };

  const dlProps = { lidarrConfigured, isAdmin, onDownload: download };
  const hasLib = results && (results.tracks.length > 0 || results.albums.length > 0 || results.artists.length > 0);
  const hasDz = dz && (dz.artists.length > 0 || dz.albums.length > 0 || dz.tracks.length > 0);

  return (
    <div className="space-y-8">
      <div className="relative max-w-md md:hidden">
        <SearchIcon size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-subdued" />
        <input
          autoFocus
          type="search"
          aria-label="Search music"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your library and beyond…"
          className="w-full rounded-full bg-highlight py-3 pl-11 pr-4 text-sm font-medium placeholder-subdued outline-none focus:shadow-insetBorder"
        />
      </div>

      {!q.trim() && (
        <div className="flex flex-col items-center gap-3 py-16 text-center md:py-24">
          <SearchIcon size={40} className="text-subdued" />
          <div className="text-lg font-bold">Search Spotless</div>
          <p className="max-w-sm text-sm text-subdued">
            Find songs, albums and artists in your library — plus anything on Deezer you don&apos;t have yet.
          </p>
        </div>
      )}

      {status === 'error' && <LoadErrorState what="search results" onRetry={() => setAttempt((n) => n + 1)} />}

      {results && status !== 'error' && (
        <>
          {results.tracks.length > 0 && (
            <section>
              <h2 className="mb-3 text-2xl font-bold">Songs</h2>
              <TrackList tracks={results.tracks} />
            </section>
          )}
          {results.albums.length > 0 && (
            <section>
              <h2 className="mb-3 text-2xl font-bold">Albums</h2>
              <CardGrid>
                {results.albums.map((a) => (
                  <AlbumCard key={a.id} album={a} />
                ))}
              </CardGrid>
            </section>
          )}
          {results.artists.length > 0 && (
            <section>
              <h2 className="mb-3 text-2xl font-bold">Artists</h2>
              <CardGrid>
                {results.artists.map((a) => (
                  <ArtistCard key={a.id} artist={a} />
                ))}
              </CardGrid>
            </section>
          )}
          {!hasLib && <div className="text-subdued">Nothing in your library for “{q}”.</div>}
        </>
      )}

      {hasDz && (
        <section className="border-t border-highlight pt-6">
          <h2 className="mb-1 text-2xl font-bold">Not in your library</h2>
          <p className="mb-4 text-sm text-subdued">From Deezer — grab anything via Lidarr.</p>

          {dz!.artists.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-2 font-bold text-subdued">Artists</h3>
              <div className="flex flex-wrap gap-3">
                {dz!.artists.map((a) => {
                  const k = `ar|${a.name}`;
                  return (
                    <div key={a.name} className="flex w-64 items-center gap-3 rounded-lg bg-elevated p-3">
                      {a.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.image} alt="" className="h-12 w-12 rounded-full object-cover" loading="lazy" decoding="async" />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-highlight"><MicIcon size={20} className="text-subdued" /></div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{a.name}</div>
                        <div className="text-xs text-subdued">{a.fans.toLocaleString()} fans</div>
                      </div>
                      <DlButton artist={a.name} k={k} state={dlState[k]} {...dlProps} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {dz!.albums.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-2 font-bold text-subdued">Albums</h3>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {dz!.albums.map((al) => {
                  const k = `al|${al.artist}|${al.title}`;
                  return (
                    <div key={`${al.artist}-${al.title}`} className="w-40 shrink-0 rounded-lg bg-elevated p-3">
                      {al.cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={al.cover} alt="" className="mb-2 aspect-square w-full rounded object-cover" loading="lazy" decoding="async" />
                      ) : (
                        <div className="mb-2 aspect-square w-full rounded bg-highlight" />
                      )}
                      <div className="truncate text-sm font-semibold" title={al.title}>{al.title}</div>
                      <div className="mb-2 truncate text-xs text-subdued">{al.artist}</div>
                      <DlButton artist={al.artist} k={k} album={al.title} state={dlState[k]} {...dlProps} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {dz!.tracks.length > 0 && (
            <div>
              <h3 className="mb-2 font-bold text-subdued">Songs</h3>
              <div className="grid grid-cols-1 gap-1 lg:grid-cols-2">
                {dz!.tracks.map((t) => {
                  const k = `tr|${t.artist}|${t.title}`;
                  const playing = playingUrl !== null && playingUrl === t.previewUrl;
                  return (
                    <div key={t.deezerUrl} className="flex items-center gap-3 rounded p-2 hover:bg-white/5">
                      {t.cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={t.cover} alt="" className="h-10 w-10 rounded object-cover" loading="lazy" decoding="async" />
                      ) : (
                        <div className="h-10 w-10 rounded bg-highlight" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{t.title}</div>
                        <div className="truncate text-xs text-subdued">{t.artist} · {t.album}</div>
                      </div>
                      {t.previewUrl && (
                        <button
                          onClick={() => togglePreview(t.previewUrl!)}
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-accent hover:text-black md:h-8 md:w-8"
                          title="30-second preview"
                          aria-label={playing ? `Stop preview of ${t.title}` : `Preview ${t.title}`}
                          aria-pressed={playing}
                        >
                          {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
                        </button>
                      )}
                      <DlButton artist={t.artist} k={k} album={t.album} state={dlState[k]} {...dlProps} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
