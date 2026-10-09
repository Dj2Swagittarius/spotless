'use client';

import { useEffect, useRef, useState } from 'react';
import { PlayIcon, PauseIcon } from '@/components/Icons';
import { LoadErrorState } from '@/components/Cards';
import { RowListSkeleton } from '@/components/Skeleton';
import { getJson, isAbortError, type LoadStatus } from '@/lib/http';

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
  /** Set by the API when some genre charts could not be fetched; the rows below are incomplete. */
  error?: string;
}

type DlStatus = 'busy' | 'sent' | 'requested' | 'fail' | undefined;

interface TrackRowProps {
  t: TrendTrack;
  /** Stable id for this row's preview/download state; the same song can appear in several sections. */
  rowKey: string;
  playing: boolean;
  dl: DlStatus;
  lidarrConfigured: boolean;
  onPreview: (key: string, artist: string, title: string) => void;
  onGrab: (key: string, artist: string, album: string | null) => void;
}

// module scope on purpose: declared inside the page it would be a new component type on every
// render, remounting every row (and dropping focus) whenever preview/download state changed
function TrackRow({ t, rowKey, playing, dl, lidarrConfigured, onPreview, onGrab }: TrackRowProps) {
  const grabLabel = t.album ? `Download "${t.album}" via Lidarr` : `Download ${t.artist} via Lidarr`;
  return (
    <div className="flex items-center gap-3 rounded-sm p-1.5 hover:bg-white/5">
      <span className="w-6 shrink-0 text-right text-sm tabular-nums text-subdued">{t.rank}</span>
      {t.art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={t.art} alt="" className="h-10 w-10 rounded-sm object-cover" loading="lazy" decoding="async" />
      ) : (
        <div className="h-10 w-10 rounded-sm bg-highlight" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{t.title}</div>
        <div className="truncate text-xs text-subdued">{t.artist}</div>
      </div>
      <button
        onClick={() => onPreview(rowKey, t.artist, t.title)}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-accent hover:text-black md:h-8 md:w-8"
        title="30-second preview"
        aria-label={playing ? `Stop preview of ${t.title}` : `Preview ${t.title}`}
        aria-pressed={playing}
      >
        {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
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
            onClick={() => onGrab(rowKey, t.artist, t.album)}
            className="w-14 shrink-0 rounded-full border border-border py-0.5 text-xs font-bold text-subdued hover:border-white hover:text-white"
            title={grabLabel}
            aria-label={grabLabel}
          >
            ⤓
          </button>
        ))}
    </div>
  );
}

export default function TrendingPage() {
  const [data, setData] = useState<Data | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const [country, setCountry] = useState('ww');
  // separate from `status`: a region change reloads only the chart while the rest of the page stays up,
  // and an empty chart after the reload means "unavailable", not "still loading"
  const [chartLoading, setChartLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lidarrConfigured, setLidarrConfigured] = useState(false);
  const [dlState, setDlState] = useState<Record<string, DlStatus>>({});
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    getJson<{ configured: boolean }>('/api/settings/lidarr', { signal: ac.signal })
      .then((d) => setLidarrConfigured(Boolean(d.configured)))
      .catch(() => {});
    return () => {
      ac.abort();
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    // keep the rest of the page while only the chart reloads for a new region
    setData((d) => (d ? { ...d, chart: [] } : d));
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    setChartLoading(true);
    getJson<Data>(`/api/trending?country=${encodeURIComponent(country)}`, { signal: ac.signal })
      .then((d) => {
        setData(d);
        setStatus('ready');
        setChartLoading(false);
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setStatus('error');
        setChartLoading(false);
      });
    return () => ac.abort();
  }, [country, attempt]);

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
    }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setDlState((s) => ({ ...s, [key]: res?.ok ? (d.status === 'requested' ? 'requested' : 'sent') : 'fail' }));
  };

  const countryName = data?.countries.find((c) => c.code === country)?.name ?? 'Worldwide';

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Trending</h1>

      {status === 'error' ? (
        <LoadErrorState what="the charts" onRetry={() => setAttempt((n) => n + 1)} />
      ) : !data ? (
        <RowListSkeleton count={10} />
      ) : (
        <>
          {data.error && (
            <div role="status" className="rounded-sm bg-elevated px-3 py-2 text-sm text-subdued">
              Some charts could not be loaded; this view may be incomplete.
            </div>
          )}

          {data.forYou.length > 0 && (
            <section>
              <h2 className="mb-1 text-xl font-bold">Trending for you</h2>
              <p className="mb-3 text-sm text-subdued">What&apos;s hot right now in the genres you actually play.</p>
              <div className="grid grid-cols-1 gap-1 lg:grid-cols-2">
                {data.forYou.map((t) => {
                  const key = `fy|${t.artist}|${t.title}`;
                  return (
                    <TrackRow
                      key={`fy-${t.rank}`}
                      t={t}
                      rowKey={key}
                      playing={playingKey === key}
                      dl={dlState[key]}
                      lidarrConfigured={lidarrConfigured}
                      onPreview={preview}
                      onGrab={grab}
                    />
                  );
                })}
              </div>
            </section>
          )}

          <section>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-xl font-bold">Top songs</h2>
              <button onClick={() => setDrawerOpen(true)} className="btn-pill px-3 py-1" aria-haspopup="dialog" aria-expanded={drawerOpen}>
                {countryName} ▾
              </button>
            </div>
            {chartLoading && data.chart.length === 0 ? (
              <RowListSkeleton count={6} />
            ) : data.chart.length === 0 ? (
              <div role="status" className="rounded-sm bg-elevated px-3 py-2 text-sm text-subdued">
                The {countryName} chart is unavailable right now; try another region or check back later.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-1 lg:grid-cols-2">
                {data.chart.map((t) => {
                  const key = `c-${country}|${t.artist}|${t.title}`;
                  return (
                    <TrackRow
                      key={`c-${t.rank}`}
                      t={t}
                      rowKey={key}
                      playing={playingKey === key}
                      dl={dlState[key]}
                      lidarrConfigured={lidarrConfigured}
                      onPreview={preview}
                      onGrab={grab}
                    />
                  );
                })}
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
                        const playing = playingKey === key;
                        const grabLabel = t.album ? `Download "${t.album}" via Lidarr` : `Download ${t.artist} via Lidarr`;
                        return (
                          <div key={key} className="w-36 shrink-0 rounded-lg bg-elevated p-2">
                            {t.art ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={t.art} alt="" className="mb-2 aspect-square w-full rounded-sm object-cover" loading="lazy" decoding="async" />
                            ) : (
                              <div className="mb-2 aspect-square w-full rounded-sm bg-highlight" />
                            )}
                            <div className="truncate text-sm font-semibold" title={t.title}>{t.title}</div>
                            <div className="mb-1.5 truncate text-xs text-subdued">{t.artist}</div>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => preview(key, t.artist, t.title)}
                                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 hover:bg-accent hover:text-black md:h-7 md:w-7"
                                title="30-second preview"
                                aria-label={playing ? `Stop preview of ${t.title}` : `Preview ${t.title}`}
                                aria-pressed={playing}
                              >
                                {playing ? <PauseIcon size={12} /> : <PlayIcon size={12} />}
                              </button>
                              {lidarrConfigured &&
                                (dlState[key] === 'sent' || dlState[key] === 'requested' ? (
                                  <span className="text-xs text-accent">✓</span>
                                ) : (
                                  <button
                                    onClick={() => grab(key, t.artist, t.album)}
                                    className="rounded-full border border-border px-2 py-0.5 text-xs text-subdued hover:border-white hover:text-white"
                                    title={grabLabel}
                                    aria-label={grabLabel}
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
        <div className="fixed inset-0 z-90 flex items-end justify-center bg-black/70 md:items-center" onClick={() => setDrawerOpen(false)}>
          <div
            role="dialog"
            aria-label="Chart region"
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
                className={`block w-full rounded-sm px-3 py-2.5 text-left text-sm hover:bg-highlight ${c.code === country ? 'font-bold text-accent' : ''}`}
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
