'use client';

import { useEffect, useRef, useState } from 'react';
import { PlayIcon, PauseIcon, XIcon, MicIcon } from '@/components/Icons';
import { CardGridSkeleton } from '@/components/Skeleton';

interface DiscoverTrack {
  title: string;
  album: string;
  cover: string | null;
  previewUrl: string | null;
}

interface DiscoverArtist {
  name: string;
  image: string | null;
  fans: number;
  deezerUrl: string;
  because: string[];
  topTracks: DiscoverTrack[];
}

interface DiscoverData {
  generatedAt: string;
  seeds: string[];
  artists: DiscoverArtist[];
}

interface NewRelease {
  artist: string;
  title: string;
  cover: string | null;
  releaseDate: string;
  recordType: string;
  deezerUrl: string;
}

interface MissingAlbum {
  artist: string;
  title: string;
  cover: string | null;
  releaseDate: string;
  deezerUrl: string;
}

interface DownloadRequest {
  id: number;
  user_name: string | null;
  artist: string;
  album: string | null;
  status: 'pending' | 'approved' | 'denied';
  requested_at: string;
}

export default function DiscoverPage() {
  const [data, setData] = useState<DiscoverData | null>(null);
  const [loading, setLoading] = useState(true);
  const [spotifyError, setSpotifyError] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [lidarrConfigured, setLidarrConfigured] = useState(false);
  const [releases, setReleases] = useState<NewRelease[] | null>(null);
  const [gaps, setGaps] = useState<MissingAlbum[] | null>(null);
  const [gapsLoading, setGapsLoading] = useState(false);
  const [dlQueue, setDlQueue] = useState<{ title: string; artist: string | null; status: string; state: string | null; pct: number }[]>([]);
  // per-artist download state: 'busy' | 'added' | 'searching' | 'requested' | error text
  const [dlState, setDlState] = useState<Record<string, string>>({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [requests, setRequests] = useState<DownloadRequest[]>([]);
  const [reqErr, setReqErr] = useState<Record<number, string>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadRequests = () =>
    fetch('/api/requests').then((r) => r.json()).then((d) => setRequests(d.requests ?? [])).catch(() => {});

  const actOnRequest = async (id: number, action: 'approve' | 'deny') => {
    setReqErr((e) => ({ ...e, [id]: '' }));
    const res = await fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) setReqErr((e) => ({ ...e, [id]: d.error ?? 'failed' }));
    loadRequests();
  };

  const load = (refresh = false) => {
    setLoading(true);
    fetch(`/api/discover${refresh ? '?refresh=1' : ''}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ generatedAt: '', seeds: [], artists: [] }))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    fetch('/api/settings/lidarr').then((r) => r.json()).then((d) => setLidarrConfigured(d.configured)).catch(() => {});
    fetch('/api/users').then((r) => r.json()).then((d) => setIsAdmin(!!d.current?.isAdmin)).catch(() => {});
    loadRequests();
    fetch('/api/releases').then((r) => r.json()).then((d) => setReleases(d.releases ?? [])).catch(() => setReleases([]));
    const pollQueue = () =>
      fetch('/api/lidarr/queue').then((r) => r.json()).then((d) => setDlQueue(d.items ?? [])).catch(() => {});
    pollQueue();
    const qi = setInterval(pollQueue, 15000);
    const err = new URLSearchParams(location.search).get('spotify_error');
    if (err) setSpotifyError(err);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => {
      clearInterval(qi);
      audioRef.current?.pause();
    };
  }, []);

  // cached preview URLs expire (Deezer signs them), so fetch a fresh one per play
  const togglePreview = async (key: string, artist: string, title: string) => {
    if (playingUrl === key) {
      audioRef.current?.pause();
      setPlayingUrl(null);
      return;
    }
    audioRef.current?.pause();
    setPlayingUrl(key);
    const d = await fetch(`/api/preview?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`)
      .then((r) => r.json())
      .catch(() => null);
    if (!d?.previewUrl) {
      setPlayingUrl(null);
      return;
    }
    const audio = new Audio(d.previewUrl);
    audio.volume = 0.8;
    audio.onended = () => setPlayingUrl(null);
    audio.play().catch(() => setPlayingUrl(null));
    audioRef.current = audio;
  };

  const dislike = async (artist: string) => {
    // optimistic: remove card immediately
    setData((d) => (d ? { ...d, artists: d.artists.filter((a) => a.name !== artist) } : d));
    await fetch('/api/discover/dislike', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist }),
    }).catch(() => {});
  };

  const download = async (artist: string) => {
    setDlState((s) => ({ ...s, [artist]: 'busy' }));
    const res = await fetch('/api/lidarr/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist }),
    });
    const data = await res.json();
    setDlState((s) => ({ ...s, [artist]: res.ok ? data.status : `error: ${data.error}` }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold">Discover</h1>
        <a href="/trending" className="btn-pill px-3 py-1 md:hidden">Trending →</a>
        <div className="flex-1" />
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="btn-pill"
        >
          Refresh suggestions
        </button>
      </div>

      {spotifyError && (
        <div className="rounded bg-negative/10 px-3 py-2 text-sm text-negative">Spotify connect failed: {spotifyError}</div>
      )}

      {isAdmin && requests.some((r) => r.status === 'pending') && (
        <section className="rounded-lg bg-elevated p-4">
          <h2 className="mb-2 font-bold">Download requests</h2>
          <div className="space-y-2">
            {requests.filter((r) => r.status === 'pending').map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">{r.artist}</span>
                  {r.album && <span className="text-subdued"> — {r.album}</span>}
                  <span className="block text-xs text-subdued">
                    {r.user_name ?? 'Unknown'} · {r.requested_at.slice(0, 10)}
                  </span>
                  {reqErr[r.id] && <span className="block text-xs text-negative">{reqErr[r.id]}</span>}
                </div>
                <button onClick={() => actOnRequest(r.id, 'approve')} className="btn-pill px-3 py-1">
                  Approve
                </button>
                <button
                  onClick={() => actOnRequest(r.id, 'deny')}
                  className="rounded-full px-3 py-1.5 text-sm font-medium text-subdued hover:text-white"
                >
                  Deny
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {!isAdmin && requests.length > 0 && (
        <section className="rounded-lg bg-elevated p-4">
          <h2 className="mb-2 font-bold">Your download requests</h2>
          <div className="space-y-1.5">
            {requests.map((r) => (
              <div key={r.id} className="flex items-center gap-3 text-sm">
                <div className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{r.artist}</span>
                  {r.album && <span className="text-subdued"> — {r.album}</span>}
                </div>
                {r.status === 'pending' && <span className="shrink-0 text-xs text-subdued">waiting for approval</span>}
                {r.status === 'approved' && <span className="shrink-0 text-xs font-medium text-accent">✓ approved</span>}
                {r.status === 'denied' && <span className="shrink-0 text-xs text-negative">declined</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {dlQueue.length > 0 && (
        <section className="rounded-lg bg-elevated p-4">
          <h2 className="mb-2 font-bold">Downloads</h2>
          <div className="space-y-2">
            {dlQueue.map((d, i) => (
              <div key={i}>
                <div className="mb-0.5 flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{d.artist ? `${d.artist} — ` : ''}{d.title}</span>
                  <span className="shrink-0 text-xs text-subdued">
                    {d.state === 'importFailed' ? 'import failed' : d.status === 'completed' ? 'importing…' : `${d.pct}%`}
                  </span>
                </div>
                <div className="h-1 rounded bg-highlight">
                  <div
                    className={`h-full rounded ${d.state === 'importFailed' ? 'bg-negative' : 'bg-accent'}`}
                    style={{ width: `${d.status === 'completed' ? 100 : d.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {releases && releases.length > 0 && (
        <section>
          <h2 className="mb-3 text-xl font-bold">New releases from your artists</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {releases.map((r) => (
              <div key={`${r.artist}-${r.title}`} className="w-40 shrink-0 rounded-lg bg-elevated p-3">
                {r.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.cover} alt="" className="mb-2 aspect-square w-full rounded object-cover" />
                ) : (
                  <div className="mb-2 aspect-square w-full rounded bg-highlight" />
                )}
                <div className="truncate text-sm font-semibold" title={r.title}>{r.title}</div>
                <div className="truncate text-xs text-subdued">{r.artist}</div>
                <div className="mb-2 text-xs text-subdued">
                  {r.releaseDate} · {r.recordType.toUpperCase()}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => togglePreview(`rel|${r.artist}|${r.title}`, r.artist, r.title)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-accent hover:text-black md:h-8 md:w-8"
                    title="30-second preview"
                    aria-label="30-second preview"
                  >
                    {playingUrl === `rel|${r.artist}|${r.title}` ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
                  </button>
                  {lidarrConfigured && (
                    dlState[`${r.artist}|${r.title}`] ? (
                      <span className="text-xs font-medium text-accent">
                        {dlState[`${r.artist}|${r.title}`] === 'busy'
                          ? 'Sending…'
                          : dlState[`${r.artist}|${r.title}`] === 'requested'
                            ? '✓ Requested'
                            : '✓ Sent'}
                      </span>
                    ) : (
                      <button
                        onClick={async () => {
                          const key = `${r.artist}|${r.title}`;
                          setDlState((s) => ({ ...s, [key]: 'busy' }));
                          const res = await fetch('/api/lidarr/add', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ artist: r.artist, album: r.title }),
                          });
                          const d = await res.json().catch(() => ({}));
                          setDlState((s) => ({ ...s, [key]: res.ok ? (d.status === 'requested' ? 'requested' : 'sent') : 'busy' }));
                        }}
                        className="rounded-full border border-border px-2.5 py-0.5 text-xs font-bold uppercase tracking-[0.06em] text-subdued hover:border-white hover:text-white"
                        title={isAdmin ? 'Get via Lidarr' : 'Request download'}
                      >
                        {isAdmin ? '⤓ Lidarr' : '⤓ Request'}
                      </button>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {data && data.seeds.length > 0 && (
        <p className="text-sm text-subdued">Based on your listening: {data.seeds.join(', ')}</p>
      )}

      {loading && (
        <div className="space-y-3">
          <div className="text-sm text-subdued">Finding new music for you…</div>
          <CardGridSkeleton count={6} />
        </div>
      )}

      <section className="rounded-lg bg-elevated p-4">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <h2 className="font-bold">Complete your collection</h2>
            <p className="text-sm text-subdued">Albums from your artists that you don&apos;t own yet.</p>
          </div>
          <button
            onClick={async () => {
              setGapsLoading(true);
              const d = await fetch('/api/collection').then((r) => r.json()).catch(() => ({ missing: [] }));
              setGaps(d.missing ?? []);
              setGapsLoading(false);
            }}
            disabled={gapsLoading}
            className="btn-pill"
          >
            {gapsLoading ? 'Checking…' : gaps ? 'Refresh' : 'Show gaps'}
          </button>
        </div>
        {gaps && gaps.length === 0 && <div className="mt-3 text-sm text-subdued">No gaps found — collection complete for your top artists.</div>}
        {gaps && gaps.length > 0 && (
          <div className="mt-4 grid max-h-96 grid-cols-1 gap-1 overflow-y-auto md:grid-cols-2">
            {gaps.map((g) => {
              const key = `gap|${g.artist}|${g.title}`;
              const st = dlState[key];
              return (
                <div key={key} className="flex items-center gap-3 rounded p-1.5 hover:bg-highlight">
                  {g.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={g.cover} alt="" className="h-10 w-10 rounded object-cover" />
                  ) : (
                    <div className="h-10 w-10 rounded bg-highlight" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{g.title}</div>
                    <div className="truncate text-xs text-subdued">{g.artist} · {g.releaseDate.slice(0, 4)}</div>
                  </div>
                  {lidarrConfigured &&
                    (st === 'busy' ? (
                      <span className="text-xs text-subdued">Sending…</span>
                    ) : st === 'sent' ? (
                      <span className="text-xs font-medium text-accent">✓ Sent</span>
                    ) : st === 'requested' ? (
                      <span className="text-xs font-medium text-accent">✓ Requested</span>
                    ) : (
                      <button
                        onClick={async () => {
                          setDlState((s) => ({ ...s, [key]: 'busy' }));
                          const res = await fetch('/api/lidarr/add', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ artist: g.artist, album: g.title }),
                          });
                          const d = await res.json().catch(() => ({}));
                          setDlState((s) => ({ ...s, [key]: res.ok ? (d.status === 'requested' ? 'requested' : 'sent') : 'busy' }));
                        }}
                        className="rounded-full border border-border px-2.5 py-0.5 text-xs font-bold uppercase tracking-[0.06em] text-subdued hover:border-white hover:text-white"
                        title={isAdmin ? 'Get via Lidarr' : 'Request download'}
                      >
                        ⤓
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {!loading && data && data.artists.length === 0 && (
        <div className="rounded-lg bg-elevated p-6 text-subdued">
          No suggestions yet. Play some music so there&apos;s listening history to work from — or check that the
          server has internet access.
        </div>
      )}

      {!loading && data && data.artists.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.artists.map((a) => (
            <div key={a.name} className="group relative rounded-lg bg-elevated p-4">
              <button
                onClick={() => dislike(a.name)}
                title="Not interested — never suggest this artist"
                aria-label={`Hide ${a.name} from Discover`}
                className="absolute right-2 top-2 rounded-full p-2 text-subdued opacity-60 transition-opacity hover:bg-highlight hover:text-white focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
              >
                <XIcon size={16} />
              </button>
              <div className="mb-3 flex items-center gap-3">
                {a.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.image} alt="" className="h-16 w-16 rounded-full object-cover" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-highlight"><MicIcon size={24} className="text-subdued" /></div>
                )}
                <div className="min-w-0">
                  <a
                    href={a.deezerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-lg font-bold hover:underline"
                  >
                    {a.name}
                  </a>
                  <div className="truncate text-xs text-subdued">Because you listen to {a.because.join(', ')}</div>
                </div>
              </div>
              {lidarrConfigured && (
                <div className="mb-3">
                  {(() => {
                    const st = dlState[a.name];
                    if (st === 'busy')
                      return <span className="text-sm text-subdued">Adding to Lidarr…</span>;
                    if (st === 'added')
                      return <span className="text-sm font-medium text-accent">✓ Added to Lidarr — downloading</span>;
                    if (st === 'searching')
                      return <span className="text-sm font-medium text-accent">✓ Already in Lidarr — search started</span>;
                    if (st === 'requested')
                      return <span className="text-sm font-medium text-accent">✓ Requested — waiting for approval</span>;
                    if (st?.startsWith('error'))
                      return <span className="text-sm text-negative" title={st}>Failed — {st.replace('error: ', '').slice(0, 80)}</span>;
                    return (
                      <button
                        onClick={() => download(a.name)}
                        className="btn-pill px-3 py-1"
                      >
                        {isAdmin ? '⤓ Download via Lidarr' : '⤓ Request download'}
                      </button>
                    );
                  })()}
                </div>
              )}
              <div className="space-y-1">
                {a.topTracks.map((t) => (
                  <div key={t.title} className="flex items-center gap-2 rounded p-1.5 hover:bg-highlight">
                    {t.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.cover} alt="" className="h-9 w-9 rounded object-cover" />
                    ) : (
                      <div className="h-9 w-9 rounded bg-highlight" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{t.title}</div>
                      <div className="truncate text-xs text-subdued">{t.album}</div>
                    </div>
                    <button
                      onClick={() => togglePreview(`${a.name}|${t.title}`, a.name, t.title)}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-accent hover:text-black md:h-8 md:w-8"
                      title="30-second preview"
                    >
                      {playingUrl === `${a.name}|${t.title}` ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
