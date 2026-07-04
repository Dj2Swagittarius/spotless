'use client';

import { useEffect, useState } from 'react';
import { usePlayer } from '@/store/player';
import { CardGrid, AlbumCard, MixCard } from '@/components/Cards';
import { RowListSkeleton, CardGridSkeleton } from '@/components/Skeleton';
import { PlayIcon } from '@/components/Icons';
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
  const playQueue = usePlayer((s) => s.playQueue);

  useEffect(() => {
    fetch('/api/home')
      .then((r) => r.json())
      .then(setSections)
      .catch(() => setSections([]));
  }, []);

  if (sections === null)
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
        <button
          onClick={() => fetch('/api/scan', { method: 'POST' }).then(() => location.reload())}
          className="btn-primary"
        >
          Scan library
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
            <button
              key={t.id}
              onClick={() => playQueue(trackSections[0].tracks!, i)}
              className="group flex items-center gap-2 overflow-hidden rounded bg-white/10 text-left transition-colors hover:bg-white/20"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/artwork/${t.albumId}`} alt="" className="h-12 w-12 shrink-0 object-cover" />
              <span className="min-w-0 flex-1 truncate pr-1 text-sm font-semibold">{t.title}</span>
              <span className="mr-2 hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-black opacity-0 shadow-lg transition-opacity group-hover:opacity-100 md:flex">
                <PlayIcon size={16} />
              </span>
            </button>
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
              <button
                key={t.id}
                onClick={() => playQueue(s.tracks!, i)}
                className="flex items-center gap-3 rounded p-2 text-left hover:bg-white/10"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/artwork/${t.albumId}`} alt="" className="h-12 w-12 rounded object-cover" />
                <div className="min-w-0">
                  <div className="truncate font-medium">{t.title}</div>
                  <div className="truncate text-sm text-subdued">{t.artist}</div>
                </div>
              </button>
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
