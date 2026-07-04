'use client';

import { use, useEffect, useRef, useState } from 'react';
import TrackList from '@/components/TrackList';
import { CardGrid, AlbumCard, ArtistCard } from '@/components/Cards';
import { SearchIcon, PlayIcon, PauseIcon, MicIcon } from '@/components/Icons';
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

export default function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q: urlQ } = use(searchParams);
  const [q, setQ] = useState(urlQ ?? '');
  const [results, setResults] = useState<Results | null>(null);
  const [dz, setDz] = useState<DzResults | null>(null);
  const [lidarrConfigured, setLidarrConfigured] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [dlState, setDlState] = useState<Record<string, string>>({});
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetch('/api/settings/lidarr').then((r) => r.json()).then((d) => setLidarrConfigured(d.configured)).catch(() => {});
    fetch('/api/users').then((r) => r.json()).then((d) => setIsAdmin(!!d.current?.isAdmin)).catch(() => {});
    return () => audioRef.current?.pause();
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
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then(setResults)
        .catch(() => {});
      fetch(`/api/search/deezer?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then(setDz)
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const download = async (artist: string, key: string, album?: string) => {
    setDlState((s) => ({ ...s, [key]: 'busy' }));
    const res = await fetch('/api/lidarr/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(album ? { artist, album } : { artist }),
    });
    const data = await res.json().catch(() => ({}));
    setDlState((s) => ({
      ...s,
      [key]: res.ok ? (data.status === 'requested' ? 'requested' : 'ok') : `err:${data.error ?? 'failed'}`,
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

  const DlButton = ({ artist, k, album }: { artist: string; k: string; album?: string }) => {
    if (!lidarrConfigured) return null;
    const st = dlState[k];
    if (st === 'busy') return <span className="text-xs text-subdued">Sending…</span>;
    if (st === 'ok') return <span className="text-xs font-medium text-accent">✓ Sent to Lidarr</span>;
    if (st === 'requested') return <span className="text-xs font-medium text-accent">✓ Requested</span>;
    if (st?.startsWith('err')) return <span className="text-xs text-negative" title={st}>Failed</span>;
    return (
      <button
        onClick={() => download(artist, k, album)}
        className="rounded-full border border-border px-2.5 py-0.5 text-xs font-bold uppercase tracking-[0.06em] text-subdued hover:border-white hover:text-white"
      >
        {isAdmin ? '⤓ Lidarr' : '⤓ Request'}
      </button>
    );
  };

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

      {results && (
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
                {dz!.artists.map((a) => (
                  <div key={a.name} className="flex w-64 items-center gap-3 rounded-lg bg-elevated p-3">
                    {a.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.image} alt="" className="h-12 w-12 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-highlight"><MicIcon size={20} className="text-subdued" /></div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{a.name}</div>
                      <div className="text-xs text-subdued">{a.fans.toLocaleString()} fans</div>
                    </div>
                    <DlButton artist={a.name} k={`ar|${a.name}`} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {dz!.albums.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-2 font-bold text-subdued">Albums</h3>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {dz!.albums.map((al) => (
                  <div key={`${al.artist}-${al.title}`} className="w-40 shrink-0 rounded-lg bg-elevated p-3">
                    {al.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={al.cover} alt="" className="mb-2 aspect-square w-full rounded object-cover" />
                    ) : (
                      <div className="mb-2 aspect-square w-full rounded bg-highlight" />
                    )}
                    <div className="truncate text-sm font-semibold" title={al.title}>{al.title}</div>
                    <div className="mb-2 truncate text-xs text-subdued">{al.artist}</div>
                    <DlButton artist={al.artist} k={`al|${al.artist}|${al.title}`} album={al.title} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {dz!.tracks.length > 0 && (
            <div>
              <h3 className="mb-2 font-bold text-subdued">Songs</h3>
              <div className="grid grid-cols-1 gap-1 lg:grid-cols-2">
                {dz!.tracks.map((t) => (
                  <div key={t.deezerUrl} className="flex items-center gap-3 rounded p-2 hover:bg-white/5">
                    {t.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.cover} alt="" className="h-10 w-10 rounded object-cover" />
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
                      >
                        {playingUrl === t.previewUrl ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
                      </button>
                    )}
                    <DlButton artist={t.artist} k={`tr|${t.artist}|${t.title}`} album={t.album} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
