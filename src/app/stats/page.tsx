'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StatTilesSkeleton, RowListSkeleton } from '@/components/Skeleton';

type Period = 'week' | 'month' | 'year' | 'all';

interface Stats {
  totals: { plays: number; seconds: number; artists: number; uniqueTracks: number };
  topArtists: { id: number; name: string; plays: number; seconds: number }[];
  topTracks: { id: number; title: string; albumId: number; artist: string; plays: number }[];
  topAlbums: { id: number; name: string; artist: string; plays: number }[];
  daily: { day: string; plays: number }[];
}

const LABELS: Record<Period, string> = { week: 'Last 7 days', month: 'Last 30 days', year: 'Last year', all: 'All time' };

function fmtHours(seconds: number): string {
  const h = seconds / 3600;
  if (h >= 10) return `${Math.round(h)} h`;
  if (h >= 1) return `${h.toFixed(1)} h`;
  return `${Math.round(seconds / 60)} min`;
}

export default function StatsPage() {
  const [period, setPeriod] = useState<Period>('month');
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch(`/api/stats?period=${period}`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, [period]);

  const tabClass = (p: Period) =>
    `rounded-full px-4 py-1.5 text-sm font-medium ${period === p ? 'bg-white text-black' : 'bg-highlight text-white hover:bg-press'}`;

  const maxArtistPlays = stats?.topArtists[0]?.plays ?? 1;
  const maxDaily = Math.max(1, ...(stats?.daily.map((d) => d.plays) ?? [1]));

  // fill missing days so the strip is a continuous 30 slots
  const dailyMap = new Map((stats?.daily ?? []).map((d) => [d.day, d.plays]));
  const days: { day: string; plays: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ day: key, plays: dailyMap.get(key) ?? 0 });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-4 text-3xl font-bold">Listening stats</h1>
        {(Object.keys(LABELS) as Period[]).map((p) => (
          <button key={p} className={tabClass(p)} onClick={() => setPeriod(p)}>
            {LABELS[p]}
          </button>
        ))}
      </div>

      {!stats ? (
        <div className="space-y-6">
          <StatTilesSkeleton />
          <RowListSkeleton count={5} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: 'Plays', value: String(stats.totals.plays) },
              { label: 'Time listened', value: fmtHours(stats.totals.seconds) },
              { label: 'Different songs', value: String(stats.totals.uniqueTracks) },
              { label: 'Different artists', value: String(stats.totals.artists) },
            ].map((c) => (
              <div key={c.label} className="rounded-lg bg-elevated p-4">
                <div className="text-2xl font-bold">{c.value}</div>
                <div className="text-sm text-subdued">{c.label}</div>
              </div>
            ))}
          </div>

          <section className="rounded-lg bg-elevated p-4">
            <h2 className="mb-3 font-bold">Activity — last 30 days</h2>
            <div className="flex h-20 items-end gap-[3px]">
              {days.map((d) => (
                <div key={d.day} className="group relative flex-1">
                  <div
                    className={`w-full rounded-sm ${d.plays > 0 ? 'bg-accent' : 'bg-highlight'}`}
                    style={{ height: `${Math.max(4, (d.plays / maxDaily) * 72)}px` }}
                  />
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-black px-2 py-1 text-xs group-hover:block">
                    {d.day}: {d.plays}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg bg-elevated p-4">
              <h2 className="mb-3 font-bold">Top artists</h2>
              {stats.topArtists.length === 0 && <div className="text-sm text-subdued">No plays in this period.</div>}
              <div className="space-y-2">
                {stats.topArtists.map((a, i) => (
                  <Link key={a.id} href={`/artist/${a.id}`} className="block">
                    <div className="mb-0.5 flex items-baseline justify-between text-sm">
                      <span className="font-medium">
                        <span className="mr-2 text-subdued">{i + 1}.</span>
                        {a.name}
                      </span>
                      <span className="text-subdued">{a.plays} plays · {fmtHours(a.seconds)}</span>
                    </div>
                    <div className="h-1.5 rounded bg-highlight">
                      <div className="h-full rounded bg-accent" style={{ width: `${(a.plays / maxArtistPlays) * 100}%` }} />
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            <section className="rounded-lg bg-elevated p-4">
              <h2 className="mb-3 font-bold">Top songs</h2>
              {stats.topTracks.length === 0 && <div className="text-sm text-subdued">No plays in this period.</div>}
              <div className="space-y-1">
                {stats.topTracks.map((t, i) => (
                  <div key={t.id} className="flex items-center gap-3 rounded p-1.5 hover:bg-highlight">
                    <span className="w-5 text-right text-sm text-subdued">{i + 1}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/artwork/${t.albumId}`} alt="" className="h-9 w-9 rounded object-cover" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{t.title}</div>
                      <div className="truncate text-xs text-subdued">{t.artist}</div>
                    </div>
                    <span className="text-sm text-subdued">{t.plays}×</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="rounded-lg bg-elevated p-4">
            <h2 className="mb-3 font-bold">Top albums</h2>
            {stats.topAlbums.length === 0 && <div className="text-sm text-subdued">No plays in this period.</div>}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {stats.topAlbums.map((al) => (
                <Link key={al.id} href={`/album/${al.id}`} className="rounded bg-base p-3 hover:bg-highlight">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/artwork/${al.id}`} alt="" className="mb-2 aspect-square w-full rounded object-cover" />
                  <div className="truncate text-sm font-medium">{al.name}</div>
                  <div className="truncate text-xs text-subdued">{al.artist} · {al.plays} plays</div>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
