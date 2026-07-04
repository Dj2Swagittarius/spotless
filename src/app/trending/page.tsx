'use client';

import { useEffect, useRef, useState } from 'react';
import { PlayIcon, PauseIcon } from '@/components/Icons';
import { RowListSkeleton } from '@/components/Skeleton';

interface TrendTrack {
  rank: number;
  title: string;
  artist: string;
  album: string | null;
  art: string | null;
}

interface GenreRow {
  name: string;
  forYou: boolean;
  tracks: TrendTrack[];
}

interface Data {
  country: string;
  countries: { code: string; name: string }[];
  chart: TrendTrack[];
  forYou: TrendTrack[];
  rows: GenreRow[];
}

export default function TrendingPage() {
  const [data, setData] = useState<Data | null>(null);
  const [country, setCountry] = useState('ww');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lidarrConfigured, setLidarrConfigured] = useState(false);
  const [dlState, setDlState] = useState<Record<string, string>>({});
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetch('/api/settings/lidarr').then((r) => r.json()).then((d) => setLidarrConfigured(d.configured)).catch(() => {});
    return () => audioRef.current?.pause();
  }, []);

  useEffect(() => {
    setData((d) => (d ? { ...d, chart: [] } : d));
    fetch(`/api/trending?country=${country}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [country]);

  const preview = async (key: string, artist: string, title: string) => {
    if (playingKey === key) {
      audioRef.current?.pause();
      setPlayingKey(null);
      return;
    }
    audioRef.current?.pause();
    setPlayingKey(key);
    const d = await fetch(`/api/preview?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`)
      .then((r) => r.json())
      .catch(() => null);
    if (!d?.previewUrl) {
      setPlayingKey(null);
      return;
    }
    const a = new Audio(d.previewUrl);
    a.volume = 0.8;
    a.onended = () => setPlayingKey(null);
    a.play().catch(() => setPlayingKey(null));
    audioRef.current = a;
  };

  const grab = async (key: string, artist: string, album: string | null) => {
    setDlState((s) => ({ ...s, [key]: 'busy' }));
    const res = await fetch('/api/lidarr/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(album ? { artist, album } : { artist }),
    });
    const d = await res.json().catch(() => ({}));
    setDlState((s) => ({ ...s, [key]: res.ok ? (d.status === 'requested' ? 'requested' : 'sent') : 'fail' }));
  };

  const TrackRow = ({ t, keyPrefix }: { t: TrendTrack; keyPrefix: string }) => {
    const key = `${keyPrefix}|${t.artist}|${t.title}`;
    const dl = dlState[key];
    return (
      <div className="flex items-center gap-3 rounded p-1.5 hover:bg-white/5">
        <span className="w-6 shrink-0 text-right text-sm tabular-nums text-subdued">{t.rank}</span>
        {t.art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.art} alt="" className="h-10 w-10 rounded object-cover" loading="lazy" />
        ) : (
          <div className="h-10 w-10 rounded bg-highlight" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{t.title}</div>
          <div className="truncate text-xs text-subdued">{t.artist}</div>
        </div>
        <button
          onClick={() => preview(key, t.artist, t.title)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-accent hover:text-black md:h-8 md:w-8"
          aria-label="30-second preview"
        >
          {playingKey === key ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
        </button>
        {lidarrConfigured &&
          (dl === 'busy' ? (
            <span className="w-14 text-center text-xs text-subdued">…</span>
          ) : dl === 'sent' ? (
            <span className="w-14 text-center text-xs font-medium text-accent">✓ Sent</span>
          ) : dl === 'requested' ? (
            <span className="w-14 text-center text-xs font-medium text-accent">✓ Req.</span>
          ) : dl === 'fail' ? (
            <span className="w-14 text-center text-xs text-negative">failed</span>
          ) : (
            <button
              onClick={() => grab(key, t.artist, t.album)}
              className="w-14 shrink-0 rounded-full border border-border py-0.5 text-xs font-bold text-subdued hover:border-white hover:text-white"
            >
              ⤓
            </button>
          ))}
      </div>
    );
  };

  const countryName = data?.countries.find((c) => c.code === country)?.name ?? 'Worldwide';

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Trending</h1>

      {!data ? (
        <RowListSkeleton count={10} />
      ) : (
        <>
          {data.forYou.length > 0 && (
            <section>
              <h2 className="mb-1 text-xl font-bold">Trending for you</h2>
              <p className="mb-3 text-sm text-subdued">What&apos;s hot right now in the genres you actually play.</p>
              <div className="grid grid-cols-1 gap-1 lg:grid-cols-2">
                {data.forYou.map((t) => (
                  <TrackRow key={`fy-${t.rank}`} t={t} keyPrefix="fy" />
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-xl font-bold">Top songs</h2>
              <button onClick={() => setDrawerOpen(true)} className="btn-pill px-3 py-1">
                {countryName} ▾
              </button>
            </div>
            {data.chart.length === 0 ? (
              <RowListSkeleton count={6} />
            ) : (
              <div className="grid grid-cols-1 gap-1 lg:grid-cols-2">
                {data.chart.map((t) => (
                  <TrackRow key={`c-${t.rank}`} t={t} keyPrefix={`c-${country}`} />
                ))}
              </div>
            )}
          </section>

          {data.rows.filter((r) => !r.forYou || data.forYou.length === 0).length > 0 && (
            <section>
              <h2 className="mb-3 text-xl font-bold">By genre</h2>
              <div className="space-y-6">
                {data.rows.map((r) => (
                  <div key={r.name}>
                    <h3 className="mb-2 font-bold">
                      {r.name} {r.forYou && <span className="ml-1 rounded-full bg-accent/20 px-2 py-0.5 text-xs font-medium text-accent">your genre</span>}
                    </h3>
                    <div className="flex gap-3 overflow-x-auto pb-2">
                      {r.tracks.slice(0, 12).map((t) => {
                        const key = `g-${r.name}|${t.artist}|${t.title}`;
                        return (
                          <div key={key} className="w-36 shrink-0 rounded-lg bg-elevated p-2">
                            {t.art ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={t.art} alt="" className="mb-2 aspect-square w-full rounded object-cover" loading="lazy" />
                            ) : (
                              <div className="mb-2 aspect-square w-full rounded bg-highlight" />
                            )}
                            <div className="truncate text-sm font-semibold" title={t.title}>{t.title}</div>
                            <div className="mb-1.5 truncate text-xs text-subdued">{t.artist}</div>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => preview(key, t.artist, t.title)}
                                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 hover:bg-accent hover:text-black md:h-7 md:w-7"
                                aria-label="Preview"
                              >
                                {playingKey === key ? <PauseIcon size={12} /> : <PlayIcon size={12} />}
                              </button>
                              {lidarrConfigured &&
                                (dlState[key] === 'sent' || dlState[key] === 'requested' ? (
                                  <span className="text-xs text-accent">✓</span>
                                ) : (
                                  <button
                                    onClick={() => grab(key, t.artist, t.album)}
                                    className="rounded-full border border-border px-2 py-0.5 text-xs text-subdued hover:border-white hover:text-white"
                                  >
                                    ⤓
                                  </button>
                                ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {drawerOpen && data && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 md:items-center" onClick={() => setDrawerOpen(false)}>
          <div
            className="max-h-[70vh] w-full overflow-y-auto rounded-t-2xl bg-elevated p-4 shadow-dialog md:max-w-sm md:rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 px-2 font-bold">Chart region</h3>
            {data.countries.map((c) => (
              <button
                key={c.code}
                onClick={() => {
                  setCountry(c.code);
                  setDrawerOpen(false);
                }}
                className={`block w-full rounded px-3 py-2.5 text-left text-sm hover:bg-highlight ${c.code === country ? 'font-bold text-accent' : ''}`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
