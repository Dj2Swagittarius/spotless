'use client';

import { useEffect, useState } from 'react';
import FolderPicker from '@/components/FolderPicker';
import DjSettings from '@/components/DjSettings';
import ThemePicker from '@/components/ThemePicker';
import { XIcon } from '@/components/Icons';
import { usePlayer } from '@/store/player';
import { loadEq, saveEq, EQ_PRESETS, EQ_FREQS, EQ_MIN, EQ_MAX, type EqState } from '@/lib/eq';
import {
  RUNGS,
  autoRung,
  loadQuality,
  onNetworkChange,
  readNetwork,
  saveQuality as persistQuality,
  type NetworkInfo,
  type QualityId,
  type Rung,
} from '@/lib/adaptive';

interface SpotifyStatus {
  connected: boolean;
  importedAt: string | null;
  topCount: number;
  savedCount: number;
  clientConfigured?: boolean;
}

interface SpotifyRedirectConfig {
  customOrigin: string;
  origin: string;
  redirectUri: string;
  source: 'setting' | 'environment' | 'default';
}

interface ScanStatus {
  scanning: boolean;
  lastScan: { at: string; added: number; removed: number; total: number } | null;
  lastScanError: { at: string; message: string } | null;
  autoScanIntervalMinutes: number;
  nextAutoScanAt: string | null;
}

interface LyricsSidecarStatus {
  enabled: boolean;
  running: boolean;
  lastRun: {
    at: string;
    total: number;
    existing: number;
    written: number;
    cached: number;
    noSyncedLyrics: number;
    deferred: number;
    errors: number;
    stoppedByRateLimit: boolean;
  } | null;
  lastError: string | null;
  writeRoot: string;
}

const AUTO_SCAN_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 5, label: 'Every 5 minutes' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every 1 hour' },
  { value: 180, label: 'Every 3 hours' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Every 12 hours' },
  { value: 1440, label: 'Every 24 hours' },
];

interface Dislike {
  name: string;
  disliked_at: string;
}

// Inlined by next.config.mjs at build time (see src/lib/version.ts for the server side).
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'dev';
const APP_COMMIT = process.env.NEXT_PUBLIC_APP_COMMIT || '';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-elevated p-5">
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  // music folder
  const [musicDir, setMusicDir] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanInfo, setScanInfo] = useState<string>('');
  const [scanError, setScanError] = useState<string>('');
  const [autoScanInterval, setAutoScanInterval] = useState(0);
  const [nextAutoScanAt, setNextAutoScanAt] = useState<string | null>(null);
  const [scanScheduleBusy, setScanScheduleBusy] = useState(false);
  const [scanScheduleMsg, setScanScheduleMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // automatic synced .lrc sidecars
  const [lyricsEnabled, setLyricsEnabled] = useState(false);
  const [lyricsBusy, setLyricsBusy] = useState(false);
  const [lyricsInfo, setLyricsInfo] = useState('');
  const [lyricsError, setLyricsError] = useState('');
  const [lyricsWriteRoot, setLyricsWriteRoot] = useState('');

  // spotify
  const [spotify, setSpotify] = useState<SpotifyStatus | null>(null);
  const [spotifyOrigin, setSpotifyOrigin] = useState('');
  const [spotifyRedirectUri, setSpotifyRedirectUri] = useState('http://127.0.0.1:3000/api/spotify/callback');
  const [spotifyRedirectSource, setSpotifyRedirectSource] = useState<SpotifyRedirectConfig['source']>('default');
  const [spotifyRedirectMsg, setSpotifyRedirectMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [spotifyRedirectBusy, setSpotifyRedirectBusy] = useState(false);
  const [spotifyMsg, setSpotifyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [spotifyBusy, setSpotifyBusy] = useState(false);

  // last.fm
  const [lastfm, setLastfm] = useState<{ configured: boolean; connected: boolean; username: string | null } | null>(null);
  const [lfmKey, setLfmKey] = useState('');
  const [lfmSecret, setLfmSecret] = useState('');
  const [lfmMsg, setLfmMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [lfmBusy, setLfmBusy] = useState(false);

  // lidarr
  const [lidarrUrl, setLidarrUrl] = useState('');
  const [lidarrKey, setLidarrKey] = useState('');
  const [lidarrConfigured, setLidarrConfigured] = useState(false);
  const [lidarrMsg, setLidarrMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [lidarrBusy, setLidarrBusy] = useState(false);

  // hidden artists
  const [dislikes, setDislikes] = useState<Dislike[]>([]);

  // artwork
  const [artBusy, setArtBusy] = useState(false);
  const [artInfo, setArtInfo] = useState('');

  // playback
  const [crossfade, setCrossfade] = useState(0);
  const [quality, setQuality] = useState<QualityId>('raw');
  const [auto, setAuto] = useState<{ rung: Rung; net: NetworkInfo } | null>(null);
  const [eq, setEq] = useState<EqState | null>(null);
  const radio = usePlayer((s) => s.radio);
  const toggleRadio = usePlayer((s) => s.toggleRadio);

  // profile
  const [me, setMe] = useState<{ id: number; name: string; color: string; isAdmin?: boolean } | null>(null);

  // mobile apps (Subsonic credential)
  const [appCred, setAppCred] = useState<{ username: string; password: string } | null>(null);
  const [credVisible, setCredVisible] = useState(false);

  // duplicates
  const [dupes, setDupes] = useState<{ artist: string; title: string; keep: string; remove: string[] }[] | null>(null);
  const [dupesLoading, setDupesLoading] = useState(false);

  const loadScan = () =>
    fetch('/api/scan')
      .then((r) => r.json())
      .then((s: ScanStatus) => {
        setScanning(s.scanning);
        setAutoScanInterval(s.autoScanIntervalMinutes ?? 0);
        setNextAutoScanAt(s.nextAutoScanAt ?? null);
        setScanError(s.lastScanError?.message ?? '');
        if (s.lastScan) {
          setScanInfo(`Last scan: ${new Date(s.lastScan.at).toLocaleString()} — ${s.lastScan.total} tracks`);
        }
      })
      .catch(() => {});


  const loadLyrics = () =>
    fetch('/api/settings/lyrics')
      .then(async (r) => {
        if (!r.ok) return null;
        return (await r.json()) as LyricsSidecarStatus;
      })
      .then((s) => {
        if (!s) return;
        setLyricsEnabled(s.enabled);
        setLyricsBusy(s.running);
        setLyricsWriteRoot(s.writeRoot ?? '');
        setLyricsError(s.lastError ?? '');
        if (s.running) {
          setLyricsInfo('Downloading missing synchronized lyrics…');
        } else if (s.lastRun) {
          const rate = s.lastRun.stoppedByRateLimit ? ' — paused by LRCLIB rate limit' : '';
          setLyricsInfo(
            `Last lyrics run: wrote ${s.lastRun.written} .lrc, ${s.lastRun.existing} already existed, ${s.lastRun.noSyncedLyrics} had no synced lyrics, ${s.lastRun.deferred} waiting for retry${rate}`
          );
        }
      })
      .catch(() => {});

  useEffect(() => {
    fetch('/api/settings/music-dir').then((r) => r.json()).then((d) => setMusicDir(d.dir)).catch(() => {});
    fetch('/api/spotify/status').then((r) => r.json()).then(setSpotify).catch(() => {});
    fetch('/api/settings/spotify')
      .then((r) => r.json())
      .then((d: SpotifyRedirectConfig) => {
        setSpotifyOrigin(d.customOrigin ?? '');
        setSpotifyRedirectUri(d.redirectUri ?? 'http://127.0.0.1:3000/api/spotify/callback');
        setSpotifyRedirectSource(d.source ?? 'default');
      })
      .catch(() => {});
    fetch('/api/lastfm/status').then((r) => r.json()).then(setLastfm).catch(() => {});
    fetch('/api/settings/lidarr')
      .then((r) => r.json())
      .then((d) => {
        setLidarrConfigured(d.configured);
        if (d.url) setLidarrUrl(d.url);
      })
      .catch(() => {});
    fetch('/api/discover/dislike').then((r) => r.json()).then(setDislikes).catch(() => {});
    fetch('/api/users').then((r) => r.json()).then((d) => setMe(d.current)).catch(() => {});
    fetch('/api/users/app-password').then((r) => r.json()).then((d) => d.username && setAppCred(d)).catch(() => {});
    loadScan();
    loadArt();
    loadLyrics();
    try {
      setCrossfade(Number(localStorage.getItem('crossfade') ?? 0) || 0);
      setQuality(loadQuality());
    } catch {
      // ignore
    }
    setEq(loadEq());

    // Keep automatic scans, errors and the next scheduled run visible while
    // the Settings page stays open.
    const scanPoll = setInterval(() => {
      loadScan();
      loadArt();
      loadLyrics();
    }, 5000);
    return () => clearInterval(scanPoll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveCrossfade = (v: number) => {
    setCrossfade(v);
    try {
      localStorage.setItem('crossfade', String(v));
    } catch {
      // ignore
    }
  };

  const saveQuality = (v: QualityId) => {
    setQuality(v);
    persistQuality(v);
  };

  // live readout of what Auto is picking; refreshes as the connection changes
  useEffect(() => {
    const read = () => setAuto({ rung: autoRung(), net: readNetwork() });
    read();
    const off = onNetworkChange(read);
    const t = setInterval(read, 5000); // stall-driven changes come from the player
    return () => {
      off();
      clearInterval(t);
    };
  }, []);

  const loadDupes = async () => {
    setDupesLoading(true);
    const d = await fetch('/api/duplicates').then((r) => r.json()).catch(() => ({ dupes: [] }));
    setDupes(d.dupes ?? []);
    setDupesLoading(false);
  };

  const loadArt = () =>
    fetch('/api/art/fetch')
      .then((r) => r.json())
      .then((s) => {
        setArtBusy(s.running);
        if (s.running && s.progress) {
          const phase =
            s.progress.phase === 'albums-local'
              ? 'checking local album art'
              : s.progress.phase === 'albums-remote'
                ? 'fetching album art'
                : 'fetching artist art';
          setArtInfo(`Artwork: ${phase} ${s.progress.done}/${s.progress.total}`);
        } else if (s.lastError) {
          setArtInfo(`Artwork error: ${s.lastError}`);
        } else if (s.lastRun) {
          setArtInfo(
            `Last artwork run: fixed ${s.lastRun.albumsFixed} album + ${s.lastRun.artistsFixed} artist images, ${s.lastRun.albumsMissing} albums still without art, ${s.lastRun.errors ?? 0} errors`
          );
        }
      })
      .catch(() => {});

  const fetchArt = async () => {
    setArtBusy(true);
    await fetch('/api/art/fetch', { method: 'POST' });
    const poll = setInterval(async () => {
      const s = await fetch('/api/art/fetch').then((r) => r.json());
      if (!s.running) {
        clearInterval(poll);
        loadArt();
        setArtBusy(false);
      }
    }, 2000);
  };

  const rescan = async () => {
    setScanning(true);
    await fetch('/api/scan', { method: 'POST' });
    const poll = setInterval(async () => {
      const s = await fetch('/api/scan').then((r) => r.json());
      if (!s.scanning) {
        clearInterval(poll);
        loadScan();
        setScanning(false);
      }
    }, 1500);
  };

  const saveAutoScanInterval = async (minutes: number) => {
    setScanScheduleBusy(true);
    setScanScheduleMsg(null);

    const res = await fetch('/api/scan', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intervalMinutes: minutes }),
    });
    const data = await res.json().catch(() => ({}));
    setScanScheduleBusy(false);

    if (!res.ok) {
      setScanScheduleMsg({ ok: false, text: data.error || 'Could not save automatic refresh interval' });
      loadScan();
      return;
    }

    setAutoScanInterval(data.autoScanIntervalMinutes ?? minutes);
    setNextAutoScanAt(data.nextAutoScanAt ?? null);
    setScanScheduleMsg({
      ok: true,
      text:
        minutes === 0
          ? 'Automatic library refresh disabled.'
          : `Automatic library refresh set to ${AUTO_SCAN_OPTIONS.find((o) => o.value === minutes)?.label.toLowerCase() ?? `${minutes} minutes`}.`,
    });
  };

  const saveLyricsEnabled = async (enabled: boolean) => {
    setLyricsError('');
    const res = await fetch('/api/settings/lyrics', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLyricsError(data.error || 'Could not save synchronized lyrics setting');
      return;
    }
    setLyricsEnabled(Boolean(data.enabled));
    setLyricsWriteRoot(data.writeRoot ?? lyricsWriteRoot);
    if (enabled) {
      setLyricsInfo('Enabled — every successful library scan will trigger a missing synced .lrc check.');
    } else {
      setLyricsInfo('Automatic synced .lrc download disabled. Existing lyric files are untouched.');
    }
  };

  const fetchMissingLyrics = async () => {
    setLyricsBusy(true);
    setLyricsError('');
    const res = await fetch('/api/settings/lyrics', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLyricsBusy(false);
      setLyricsError(data.error || 'Could not start synchronized lyrics download');
      return;
    }
    setLyricsInfo(data.reason || 'Downloading missing synchronized lyrics…');
  };

  const saveLidarr = async () => {
    setLidarrBusy(true);
    setLidarrMsg(null);
    const res = await fetch('/api/settings/lidarr', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: lidarrUrl, apiKey: lidarrKey }),
    });
    const data = await res.json();
    setLidarrBusy(false);
    if (!res.ok) {
      setLidarrMsg({ ok: false, text: data.error || 'Failed' });
      return;
    }
    setLidarrConfigured(true);
    setLidarrKey('');
    setLidarrMsg({ ok: true, text: `Connected — Lidarr v${data.version}` });
  };

  const disconnectLidarr = async () => {
    await fetch('/api/settings/lidarr', { method: 'DELETE' });
    setLidarrConfigured(false);
    setLidarrUrl('');
    setLidarrKey('');
    setLidarrMsg({ ok: true, text: 'Disconnected' });
  };

  const refreshSpotify = () =>
    fetch('/api/spotify/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setSpotify(s))
      .catch(() => {});

  // the route answers 401 (reconnect), 429 (rate limited, with retryAfter) or 502 as JSON; show that text
  // rather than silently refetching the status, which would make a failed import look like a no-op
  const reimportSpotify = async () => {
    setSpotifyBusy(true);
    setSpotifyMsg(null);
    const res = await fetch('/api/spotify/status', { method: 'POST' }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setSpotifyBusy(false);
    if (!res?.ok) {
      setSpotifyMsg({ ok: false, text: data.error || `Re-import failed${res ? ` (HTTP ${res.status})` : ''}` });
      return;
    }
    setSpotifyMsg({ ok: true, text: `Re-imported ${data.topCount ?? 0} top and ${data.savedCount ?? 0} saved artists.` });
    await refreshSpotify();
  };

  const disconnectSpotify = async () => {
    setSpotifyBusy(true);
    setSpotifyMsg(null);
    const res = await fetch('/api/spotify/status', { method: 'DELETE' }).catch(() => null);
    setSpotifyBusy(false);
    if (!res?.ok) {
      const data = res ? await res.json().catch(() => ({})) : {};
      setSpotifyMsg({ ok: false, text: data.error || 'Could not disconnect Spotify' });
      return;
    }
    await refreshSpotify();
  };

  const applySpotifyRedirectConfig = (d: SpotifyRedirectConfig) => {
    setSpotifyOrigin(d.customOrigin ?? '');
    setSpotifyRedirectUri(d.redirectUri ?? 'http://127.0.0.1:3000/api/spotify/callback');
    setSpotifyRedirectSource(d.source ?? 'default');
  };

  const saveSpotifyRedirect = async () => {
    setSpotifyRedirectBusy(true);
    setSpotifyRedirectMsg(null);
    const res = await fetch('/api/settings/spotify', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin: spotifyOrigin }),
    });
    const data = await res.json();
    setSpotifyRedirectBusy(false);
    if (!res.ok) {
      setSpotifyRedirectMsg({ ok: false, text: data.error || 'Could not save Spotify callback domain' });
      return;
    }
    applySpotifyRedirectConfig(data);
    setSpotifyRedirectMsg({ ok: true, text: 'Spotify callback setting saved.' });
  };

  const resetSpotifyRedirect = async () => {
    setSpotifyRedirectBusy(true);
    setSpotifyRedirectMsg(null);
    const res = await fetch('/api/settings/spotify', { method: 'DELETE' });
    const data = await res.json();
    setSpotifyRedirectBusy(false);
    if (!res.ok) {
      setSpotifyRedirectMsg({ ok: false, text: data.error || 'Could not reset Spotify callback domain' });
      return;
    }
    applySpotifyRedirectConfig(data);
    setSpotifyRedirectMsg({ ok: true, text: 'Custom callback domain cleared.' });
  };

  const updateEq = (s: EqState) => {
    setEq(s);
    saveEq(s);
  };

  const saveLastfmKeys = async () => {
    setLfmBusy(true);
    setLfmMsg(null);
    const res = await fetch('/api/lastfm/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: lfmKey, secret: lfmSecret }),
    });
    const data = await res.json();
    setLfmBusy(false);
    if (!res.ok) {
      setLfmMsg({ ok: false, text: data.error || 'Failed' });
      return;
    }
    setLfmKey('');
    setLfmSecret('');
    setLfmMsg({ ok: true, text: 'API keys saved — now connect your account below.' });
    const s = await fetch('/api/lastfm/status').then((r) => r.json());
    setLastfm(s);
  };

  const disconnectLastfm = async () => {
    await fetch('/api/lastfm/status', { method: 'DELETE' });
    const s = await fetch('/api/lastfm/status').then((r) => r.json());
    setLastfm(s);
  };

  const unhide = async (name: string) => {
    setDislikes((d) => d.filter((x) => x.name !== name));
    await fetch('/api/discover/dislike', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist: name }),
    }).catch(() => {});
  };

  const btn = 'btn-pill';
  const input = 'w-full rounded-sm bg-highlight px-3 py-2 text-sm text-white placeholder:text-subdued outline-hidden focus:shadow-insetBorder';

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {pickerOpen && (
        <FolderPicker
          onClose={() => setPickerOpen(false)}
          onSaved={(dir) => {
            setMusicDir(dir);
            setPickerOpen(false);
            rescan();
          }}
        />
      )}

      <h1 className="text-3xl font-bold">Settings</h1>

      <Section title="Profile">
        <div className="flex items-center gap-4">
          {me ? (
            <>
              <span
                className="flex h-12 w-12 items-center justify-center rounded-full text-xl font-extrabold text-black"
                style={{ backgroundColor: me.color }}
              >
                {me.name.charAt(0).toUpperCase()}
              </span>
              <div className="flex-1">
                <div className="font-semibold">{me.name}</div>
                <div className="text-sm text-subdued">Likes, playlists, history and Discover are yours alone.</div>
              </div>
            </>
          ) : (
            <div className="flex-1 text-sm text-subdued">No profile selected.</div>
          )}
          <button
            className={btn}
            onClick={async () => {
              await fetch('/api/users/select', { method: 'DELETE' });
              location.reload();
            }}
          >
            Switch profile
          </button>
        </div>
      </Section>

      <Section title="Appearance">
        <p className="mb-3 text-sm text-subdued">
          Pick a theme for this device. <span className="text-white">Remix</span> themes go further than color — new
          type, corners and window chrome.
        </p>
        <ThemePicker />
      </Section>

      <Section title="Mobile apps">
        <p className="mb-3 text-sm text-subdued">
          Spotless speaks the Subsonic API, so native mobile apps like{' '}
          <span className="text-white">Symfonium</span>, <span className="text-white">DSub</span> or{' '}
          <span className="text-white">play:Sub</span> can stream, transcode and download your library
          for offline listening. Add a server in the app with these details:
        </p>
        {appCred ? (
          <div className="space-y-2 text-sm">
            <div className="rounded-sm bg-highlight px-3 py-2">
              <span className="text-subdued">Server: </span>
              <span className="break-all">{typeof location !== 'undefined' ? location.origin : ''}</span>
            </div>
            <div className="rounded-sm bg-highlight px-3 py-2">
              <span className="text-subdued">Username: </span>
              {appCred.username}
            </div>
            <div className="flex items-center gap-2 rounded-sm bg-highlight px-3 py-2">
              <span className="text-subdued">Password: </span>
              <span className="font-mono">{credVisible ? appCred.password : '••••••••••••'}</span>
              <button
                onClick={() => setCredVisible((v) => !v)}
                className="ml-auto text-xs font-bold uppercase tracking-[0.08em] text-subdued hover:text-white"
              >
                {credVisible ? 'Hide' : 'Show'}
              </button>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button
                className={btn}
                onClick={async () => {
                  const d = await fetch('/api/users/app-password', { method: 'POST' }).then((r) => r.json());
                  setAppCred(d);
                  setCredVisible(true);
                }}
              >
                New password
              </button>
              <span className="text-xs text-subdued">Regenerating logs out apps using the old one.</span>
            </div>
          </div>
        ) : (
          <div className="text-sm text-subdued">Loading…</div>
        )}
      </Section>

      {me && !me.isAdmin && (
        <p className="px-1 text-sm text-subdued">
          Server settings — music folder, library scans and Lidarr — are managed from the admin profile.
        </p>
      )}

      {me?.isAdmin && (
        <Section title="Music library">
          <div className="mb-3 text-sm text-subdued">
            Folder: <span className="text-white">{musicDir || '…'}</span>
          </div>
          {scanInfo && <div className="mb-2 text-sm text-subdued">{scanInfo}</div>}
          {scanError && (
            <div className="mb-3 rounded-sm bg-red-950/40 px-3 py-2 text-sm text-red-300">
              Last scan failed: {scanError}
            </div>
          )}

          <div className="mb-4 max-w-sm">
            <label className="mb-1 block text-sm font-medium">Automatic library refresh</label>
            <select
              className={input}
              value={autoScanInterval}
              onChange={(e) => saveAutoScanInterval(Number(e.target.value))}
              disabled={scanScheduleBusy}
            >
              {AUTO_SCAN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-subdued">
              {autoScanInterval === 0
                ? 'Off — Spotless still scans once at server startup and whenever you click Rescan now.'
                : nextAutoScanAt
                  ? `Next automatic scan: ${new Date(nextAutoScanAt).toLocaleString()}. A manual scan resets this timer.`
                  : 'Automatic refresh is enabled; the next run will be scheduled after the current scan finishes.'}
            </p>
            {scanScheduleMsg && (
              <p className={`mt-2 text-xs ${scanScheduleMsg.ok ? 'text-accent' : 'text-red-400'}`}>
                {scanScheduleMsg.text}
              </p>
            )}
          </div>

          <div className="mb-4 rounded-lg bg-highlight/50 p-3">
            <label className="flex items-center justify-between gap-4">
              <span>
                <span className="block text-sm font-medium">Automatic synced lyrics sidecars</span>
                <span className="mt-1 block text-xs text-subdued">
                  After every successful library scan, fetch only synchronized lyrics from LRCLIB and save missing
                  same-name <code>.lrc</code> files beside the music. Existing lyric files are never overwritten.
                </span>
              </span>
              <input
                type="checkbox"
                checked={lyricsEnabled}
                onChange={(e) => saveLyricsEnabled(e.target.checked)}
                className="h-5 w-5 shrink-0 accent-green-500"
              />
            </label>
            {lyricsWriteRoot && (
              <p className="mt-2 text-xs text-subdued">
                Lyrics write path: <span className="text-white">{lyricsWriteRoot}</span>
              </p>
            )}
            {lyricsInfo && <p className="mt-2 text-xs text-subdued">{lyricsInfo}</p>}
            {lyricsError && <p className="mt-2 text-xs text-red-400">Lyrics error: {lyricsError}</p>}
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            <button className={btn} onClick={() => setPickerOpen(true)}>Change folder</button>
            <button className={btn} onClick={rescan} disabled={scanning}>
              {scanning ? 'Scanning…' : 'Rescan now'}
            </button>
            <button className={btn} onClick={fetchArt} disabled={artBusy}>
              {artBusy ? 'Fetching art…' : 'Fetch missing artwork'}
            </button>
            <button className={btn} onClick={fetchMissingLyrics} disabled={lyricsBusy}>
              {lyricsBusy ? 'Fetching synced lyrics…' : 'Fetch missing synced lyrics'}
            </button>
          </div>
          {artInfo && <div className="text-sm text-subdued">{artInfo}</div>}
        </Section>
      )}

      <Section title="Playback">
        <label className="mb-2 block text-sm font-medium">Streaming quality</label>
        <div className="flex flex-wrap gap-2">
          {[{ id: 'auto' as const, label: 'Auto' }, ...RUNGS.map((r) => ({ id: r.id, label: r.label }))].map((o) => (
            <button
              key={o.id}
              onClick={() => saveQuality(o.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                quality === o.id ? 'bg-white text-black' : 'bg-highlight text-white hover:bg-press'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {quality === 'auto' && auto && (
          <p className="mt-2 text-sm text-accent">
            Now streaming at {auto.rung.label} — {auto.net.label}
            {!auto.net.supported && ' (this browser reports no network details, so Auto starts here and drops a tier whenever playback stutters)'}
          </p>
        )}
        <p className="mb-5 mt-2 text-sm text-subdued">
          Auto follows your connection: full quality on Wi-Fi, a lighter stream on mobile data,
          and a step down whenever playback starts to stutter — so a song keeps going instead of
          cutting out. It picks up where it left off, not from the top of the track, and moves back
          up once the connection settles.
        </p>
        <p className="mb-5 mt-2 text-sm text-subdued">
          Original streams your files untouched — best quality, no server work. The lower tiers
          transcode to MP3 on the fly to save data and storage; the difference is subtle at 192kbps
          and up. Applies to this device.
        </p>

        <label className="mb-1 block text-sm font-medium">
          Crossfade: {crossfade === 0 ? 'off (gapless)' : `${crossfade}s`}
        </label>
        <input
          type="range"
          min={0}
          max={12}
          step={1}
          value={crossfade}
          onChange={(e) => saveCrossfade(Number(e.target.value))}
          className="w-full max-w-xs"
        />
        <p className="mt-1 text-sm text-subdued">
          0 = tracks start instantly back-to-back. Higher = songs blend into each other. Applies to this device.
        </p>
        <div className="mt-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Radio mode</div>
            <p className="text-sm text-subdued">
              Playing any song starts a station of similar music, and the queue never ends.
            </p>
          </div>
          <button
            onClick={toggleRadio}
            role="switch"
            aria-checked={radio}
            aria-label="Radio mode"
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${radio ? 'bg-accent' : 'bg-border'}`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${radio ? 'left-6' : 'left-1'}`}
            />
          </button>
        </div>

        {eq && (
          <div className="mt-6 border-t border-highlight pt-4">
            <div className="mb-3 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Equalizer</div>
                <p className="text-sm text-subdued">Shape the sound with a preset or your own curve. Applies to this device.</p>
              </div>
              <button
                onClick={() => updateEq({ ...eq, enabled: !eq.enabled })}
                role="switch"
                aria-checked={eq.enabled}
                aria-label="Equalizer"
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${eq.enabled ? 'bg-accent' : 'bg-border'}`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${eq.enabled ? 'left-6' : 'left-1'}`}
                />
              </button>
            </div>
            <div className={eq.enabled ? '' : 'pointer-events-none opacity-40'}>
              <div className="mb-4 flex flex-wrap gap-2">
                {Object.keys(EQ_PRESETS).map((name) => (
                  <button
                    key={name}
                    onClick={() => updateEq({ ...eq, preset: name, gains: EQ_PRESETS[name].slice() })}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      eq.preset === name ? 'bg-white text-black' : 'bg-highlight text-white hover:bg-press'
                    }`}
                  >
                    {name}
                  </button>
                ))}
                {eq.preset === 'Custom' && (
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-black">Custom</span>
                )}
              </div>
              <div className="space-y-1.5">
                {EQ_FREQS.map((freq, i) => (
                  <div key={freq} className="flex items-center gap-3">
                    <span className="w-10 text-right text-xs tabular-nums text-subdued">
                      {freq >= 1000 ? `${freq / 1000}K` : freq}
                    </span>
                    <input
                      type="range"
                      min={EQ_MIN}
                      max={EQ_MAX}
                      step={0.5}
                      value={eq.gains[i]}
                      onChange={(e) => {
                        const gains = eq.gains.slice();
                        gains[i] = Number(e.target.value);
                        updateEq({ ...eq, preset: 'Custom', gains });
                      }}
                      className="flex-1"
                      style={{ ['--fill' as string]: `${((eq.gains[i] - EQ_MIN) / (EQ_MAX - EQ_MIN)) * 100}%` }}
                      aria-label={`${freq} Hz gain`}
                    />
                    <span className="w-12 text-xs tabular-nums text-subdued">
                      {eq.gains[i] > 0 ? '+' : ''}{eq.gains[i]} dB
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Section>

      <Section title="Spotify">
        {spotify?.connected ? (
          <>
            <div className="mb-3 text-sm text-subdued">
              <span className="font-medium text-accent">✓ Connected.</span> {spotify.topCount} top artists ·{' '}
              {spotify.savedCount} saved artists imported
              {spotify.importedAt && <> · last import {new Date(spotify.importedAt).toLocaleString()}</>}
            </div>
            <div className="flex gap-2">
              <button className={btn} onClick={reimportSpotify} disabled={spotifyBusy}>
                {spotifyBusy ? 'Working…' : 'Re-import taste'}
              </button>
              <button className={btn} onClick={disconnectSpotify} disabled={spotifyBusy}>Disconnect</button>
            </div>
            {spotifyMsg && (
              <div className={`mt-3 rounded-sm px-3 py-2 text-sm ${spotifyMsg.ok ? 'bg-accent/10 text-accent' : 'bg-negative/10 text-negative'}`}>
                {spotifyMsg.text}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mb-3 text-sm text-subdued">Not connected. Seeds Discover with your Spotify taste.</div>
            <a href="/api/spotify/login" className="btn-primary inline-block">
              Connect Spotify
            </a>
          </>
        )}

        {me?.isAdmin && (
          <div className="mt-5 border-t border-highlight pt-4">
            <label className="mb-1 block text-sm font-medium">Public domain for Spotify OAuth</label>
            <p className="mb-3 text-sm text-subdued">
              Optional. For a reverse proxy, enter only your public domain, for example{' '}
              <span className="text-white">music.example.com</span>. Spotless adds{' '}
              <span className="text-white">/api/spotify/callback</span> automatically. Leave this blank to use{' '}
              <span className="text-white">SPOTIFY_REDIRECT_URI</span> when set, otherwise the local loopback default.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className={input}
                value={spotifyOrigin}
                onChange={(e) => setSpotifyOrigin(e.target.value)}
                placeholder="music.example.com"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <button className={btn} onClick={saveSpotifyRedirect} disabled={spotifyRedirectBusy}>
                {spotifyRedirectBusy ? 'Saving…' : 'Save'}
              </button>
              {spotifyRedirectSource === 'setting' && (
                <button className={btn} onClick={resetSpotifyRedirect} disabled={spotifyRedirectBusy}>
                  Use default
                </button>
              )}
            </div>
            <div className="mt-2 rounded-sm bg-base px-3 py-2 text-xs text-subdued">
              Spotify Redirect URI:{' '}
              <span className="break-all font-mono text-white">{spotifyRedirectUri}</span>
            </div>
            <p className="mt-2 text-xs text-subdued">
              Add that exact URI to your Spotify app's Redirect URIs before connecting. Public domains must use HTTPS.
            </p>
            {spotifyRedirectSource === 'environment' && !spotifyOrigin && (
              <p className="mt-2 text-xs text-subdued">
                Currently using the SPOTIFY_REDIRECT_URI environment variable. Saving a domain here overrides it.
              </p>
            )}
            {spotifyRedirectMsg && (
              <div className={`mt-3 rounded-sm px-3 py-2 text-sm ${spotifyRedirectMsg.ok ? 'bg-accent/10 text-accent' : 'bg-negative/10 text-negative'}`}>
                {spotifyRedirectMsg.text}
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="Last.fm">
        {!lastfm?.configured ? (
          me?.isAdmin ? (
            <>
              <div className="mb-3 text-sm text-subdued">
                Scrobble every play to Last.fm. Create a free API account at{' '}
                <a href="https://www.last.fm/api/account/create" target="_blank" rel="noreferrer" className="text-white underline">
                  last.fm/api/account/create
                </a>{' '}
                (any name, callback URL can stay blank), then paste the API key and shared secret here.
              </div>
              <div className="mb-3 grid gap-2 sm:grid-cols-2">
                <input className={input} value={lfmKey} onChange={(e) => setLfmKey(e.target.value)} placeholder="API key" />
                <input className={input} value={lfmSecret} onChange={(e) => setLfmSecret(e.target.value)} type="password" placeholder="Shared secret" />
              </div>
              {lfmMsg && (
                <div className={`mb-3 rounded-sm px-3 py-2 text-sm ${lfmMsg.ok ? 'bg-accent/10 text-accent' : 'bg-negative/10 text-negative'}`}>
                  {lfmMsg.text}
                </div>
              )}
              <button className={btn} onClick={saveLastfmKeys} disabled={lfmBusy || !lfmKey.trim() || !lfmSecret.trim()}>
                {lfmBusy ? 'Testing…' : 'Test & save'}
              </button>
            </>
          ) : (
            <div className="text-sm text-subdued">Not set up yet — ask the admin to add a Last.fm API key first.</div>
          )
        ) : lastfm.connected ? (
          <>
            <div className="mb-3 text-sm text-subdued">
              <span className="font-medium text-accent">✓ Scrobbling as {lastfm.username}.</span> Every play (web and
              mobile apps) is sent to your Last.fm profile.
            </div>
            <button className={btn} onClick={disconnectLastfm}>Disconnect</button>
          </>
        ) : (
          <>
            <div className="mb-3 text-sm text-subdued">
              Not connected. Link your Last.fm account to scrobble everything you play.
            </div>
            <a href="/api/lastfm/login" className="btn-primary inline-block">
              Connect Last.fm
            </a>
          </>
        )}
      </Section>

      {me?.isAdmin && (
        <div id="ai-dj">
          <Section title="AI DJ">
            <DjSettings />
          </Section>
        </div>
      )}

      {me?.isAdmin && (
        <Section title="Lidarr">
          <div className="mb-3 text-sm text-subdued">
            {lidarrConfigured ? (
              <span className="font-medium text-accent">✓ Connected — Discover cards show a download button.</span>
            ) : (
              'Connect your Lidarr server to download suggested artists. API key: Lidarr → Settings → General.'
            )}
          </div>
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <input className={input} value={lidarrUrl} onChange={(e) => setLidarrUrl(e.target.value)} placeholder="http://lidarr:8686" />
            <input className={input} value={lidarrKey} onChange={(e) => setLidarrKey(e.target.value)} type="password" placeholder={lidarrConfigured ? '•••••••• (saved)' : 'API key'} />
          </div>
          {lidarrMsg && (
            <div className={`mb-3 rounded-sm px-3 py-2 text-sm ${lidarrMsg.ok ? 'bg-accent/10 text-accent' : 'bg-negative/10 text-negative'}`}>
              {lidarrMsg.text}
            </div>
          )}
          <div className="flex gap-2">
            <button className={btn} onClick={saveLidarr} disabled={lidarrBusy || !lidarrUrl.trim() || !lidarrKey.trim()}>
              {lidarrBusy ? 'Testing…' : 'Test & save'}
            </button>
            {lidarrConfigured && <button className={btn} onClick={disconnectLidarr}>Disconnect</button>}
          </div>
        </Section>
      )}

      {me?.isAdmin && (
      <Section title="Duplicate songs">
        <div className="mb-3 flex items-center gap-3">
          <p className="flex-1 text-sm text-subdued">
            Finds the same song stored twice (e.g. MP3 + FLAC). Music folder is mounted read-only, so delete the
            listed files on the server yourself, then rescan.
          </p>
          <button className={btn} onClick={loadDupes} disabled={dupesLoading}>
            {dupesLoading ? 'Scanning…' : dupes ? 'Refresh' : 'Find duplicates'}
          </button>
        </div>
        {dupes && dupes.length === 0 && <div className="text-sm text-subdued">No duplicates found. Clean library 👌</div>}
        {dupes && dupes.length > 0 && (
          <div className="max-h-80 space-y-3 overflow-y-auto">
            {dupes.map((d, i) => (
              <div key={i} className="rounded-sm bg-base p-3 text-sm">
                <div className="font-medium">{d.artist} — {d.title}</div>
                <div className="mt-1 text-xs text-accent">keep: {d.keep}</div>
                {d.remove.map((p) => (
                  <div key={p} className="text-xs text-subdued">remove: {p}</div>
                ))}
              </div>
            ))}
          </div>
        )}
      </Section>
      )}

      <Section title="Hidden from Discover">
        {dislikes.length === 0 ? (
          <div className="text-sm text-subdued">Nothing hidden. Use the ✕ on Discover cards to hide artists.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {dislikes.map((d) => (
              <span key={d.name} className="flex items-center gap-1.5 rounded-full bg-highlight px-3 py-1 text-sm">
                {d.name}
                <button onClick={() => unhide(d.name)} title="Un-hide" className="text-subdued hover:text-white">
                  <XIcon size={14} />
                </button>
              </span>
            ))}
          </div>
        )}
      </Section>
      <Section title="About">
        <div className="text-sm">
          Spotless <span className="font-semibold">v{APP_VERSION}</span>
          {APP_COMMIT ? <span className="text-subdued"> · build {APP_COMMIT}</span> : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-sm text-subdued">
          <a
            href="https://github.com/Dj2Swagittarius/spotless/releases"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-white"
          >
            Release notes
          </a>
          <a
            href="https://github.com/Dj2Swagittarius/spotless"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-white"
          >
            Source on GitHub
          </a>
        </div>
      </Section>
    </div>
  );
}
