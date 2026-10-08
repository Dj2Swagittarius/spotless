'use client';

import { useEffect, useRef, useState } from 'react';
import { usePlayer } from '@/store/player';
import { CardGrid, AlbumCard, MixCard, LoadErrorState } from '@/components/Cards';
import AddToPlaylist from '@/components/AddToPlaylist';
import { RowListSkeleton, CardGridSkeleton } from '@/components/Skeleton';
import { PlayIcon } from '@/components/Icons';
import { getJson, isAbortError, type LoadStatus } from '@/lib/http';
import type { HomeSection } from '@/lib/types';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Up late?';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function HomePage() {
  const [sections, setSections] = useState<HomeSection[] | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const [scanning, setScanning] = useState(false);
  // the scan poll lives in a ref so navigating away mid-scan clears it instead of leaking a timer
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playQueue = usePlayer((s) => s.playQueue);

  useEffect(() => {
    const ac = new AbortController();
    setStatus('loading');
    getJson<HomeSection[]>('/api/home', { signal: ac.signal })
      .then((d) => {
        setSections(d);
        setStatus('ready');
      })
      .catch((err) => {
        if (!isAbortError(err)) setStatus('error');
      });
    return () => ac.abort();
  }, [attempt]);

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    []
  );

  // kick off a scan, then refetch the sections when it finishes: a reload here would stop playback
  const scan = async () => {
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

  if (status === 'error') return <LoadErrorState what="your home page" onRetry={() => setAttempt((n) => n + 1)} />;
  if (status === 'loading' || sections === null)
    return (
      <div className="space-y-8">
        <div className="h-9 w-64 animate-pulse rounded bg-elevated" />
        <RowListSkeleton count={6} />
        <CardGridSkeleton count={6} />
      </div>
    );

  if (sections.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 p-12 text-center">
        <div className="text-2xl font-bold">Your library is empty</div>
        <p className="max-w-md text-subdued">
          Drop music files into your music folder, then trigger a scan. The library scans automatically on startup.
        </p>
        <button onClick={scan} disabled={scanning} className="btn-primary">
          {scanning ? 'Scanning…' : 'Scan library'}
        </button>
      </div>
    );
  }

  const trackSections = sections.filter((s) => s.kind === 'tracks');
  const mixSections = sections.filter((s) => s.kind === 'mix');
  const albumSections = sections.filter((s) => s.kind === 'albums');

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">{greeting()}</h1>

      {trackSections[0] && (
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          {trackSections[0].tracks!.slice(0, 8).map((t, i) => (
            // a real button for play with the ··· menu as its sibling: nesting the menu button inside a
            // role=button tile made Enter on the menu also start playback, and Space did nothing
            <div
              key={t.id}
              className="group flex items-center overflow-hidden rounded bg-white/10 transition-colors hover:bg-white/20"
            >
              <button
                type="button"
                onClick={() => playQueue(trackSections[0].tracks!, i)}
                aria-label={`Play ${t.title}`}
                className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:-outline-offset-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/artwork/${t.albumId}`} alt="" className="h-12 w-12 shrink-0 object-cover" loading="lazy" decoding="async" />
                <span className="min-w-0 flex-1 truncate pr-1 text-sm font-semibold">{t.title}</span>
                <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-black opacity-0 shadow-lg transition-opacity group-hover:opacity-100 md:flex">
                  <PlayIcon size={16} />
                </span>
              </button>
              <AddToPlaylist track={t} className="mr-1 shrink-0 rounded-full p-2 text-subdued opacity-60 hover:text-white md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100" />
            </div>
          ))}
        </div>
      )}

      {mixSections.length > 0 && (
        <section>
          <h2 className="mb-4 text-2xl font-bold">Made for you</h2>
          <CardGrid>
            {mixSections.map((s) => (
              <MixCard key={s.title} title={s.title} tracks={s.tracks!} />
            ))}
          </CardGrid>
        </section>
      )}

      {trackSections.slice(1).map((s) => (
        <section key={s.title}>
          <h2 className="mb-4 text-2xl font-bold">{s.title}</h2>
          <div className="grid grid-cols-1 gap-1 lg:grid-cols-2">
            {s.tracks!.map((t, i) => (
              <div key={t.id} className="group flex items-center gap-3 rounded p-2 hover:bg-white/10">
                <button
                  type="button"
                  onClick={() => playQueue(s.tracks!, i)}
                  aria-label={`Play ${t.title}`}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded text-left"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/artwork/${t.albumId}`} alt="" className="h-12 w-12 rounded object-cover" loading="lazy" decoding="async" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{t.title}</span>
                    <span className="block truncate text-sm text-subdued">{t.artist}</span>
                  </span>
                </button>
                <AddToPlaylist track={t} className="rounded-full p-2 text-subdued opacity-60 hover:text-white md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100" />
              </div>
            ))}
          </div>
        </section>
      ))}

      {albumSections.map((s) => (
        <section key={s.title}>
          <h2 className="mb-4 text-2xl font-bold">{s.title}</h2>
          <CardGrid>
            {s.albums!.map((a) => (
              <AlbumCard key={a.id} album={a} />
            ))}
          </CardGrid>
        </section>
      ))}
    </div>
  );
}
