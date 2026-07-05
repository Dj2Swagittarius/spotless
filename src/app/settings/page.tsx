'use client';

import { useEffect, useState } from 'react';
import FolderPicker from '@/components/FolderPicker';
import { XIcon } from '@/components/Icons';
import { usePlayer } from '@/store/player';

interface SpotifyStatus {
  connected: boolean;
  importedAt: string | null;
  topCount: number;
  savedCount: number;
}

interface Dislike {
  name: string;
  disliked_at: string;
}

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

  // spotify
  const [spotify, setSpotify] = useState<SpotifyStatus | null>(null);

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
  const [quality, setQuality] = useState('raw');
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
      .then((s) => {
        setScanning(s.scanning);
        if (s.lastScan) setScanInfo(`Last scan: ${new Date(s.lastScan.at).toLocaleString()} — ${s.lastScan.total} tracks`);
      })
      .catch(() => {});

  useEffect(() => {
    fetch('/api/settings/music-dir').then((r) => r.json()).then((d) => setMusicDir(d.dir)).catch(() => {});
    fetch('/api/spotify/status').then((r) => r.json()).then(setSpotify).catch(() => {});
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
    try {
      setCrossfade(Number(localStorage.getItem('crossfade') ?? 0) || 0);
      setQuality(localStorage.getItem('streamQuality') ?? 'raw');
    } catch {
      // ignore
    }
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

  const saveQuality = (v: string) => {
    setQuality(v);
    try {
      localStorage.setItem('streamQuality', v);
    } catch {
      // ignore
    }
  };

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
        if (s.lastRun)
          setArtInfo(
            `Last run: fixed ${s.lastRun.albumsFixed} album + ${s.lastRun.artistsFixed} artist images, ${s.lastRun.albumsMissing} albums still without art`
          );
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

  const reimportSpotify = async () => {
    await fetch('/api/spotify/status', { method: 'POST' });
    const s = await fetch('/api/spotify/status').then((r) => r.json());
    setSpotify(s);
  };

  const disconnectSpotify = async () => {
    await fetch('/api/spotify/status', { method: 'DELETE' });
    const s = await fetch('/api/spotify/status').then((r) => r.json());
    setSpotify(s);
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
  const input = 'w-full rounded bg-highlight px-3 py-2 text-sm text-white placeholder:text-subdued outline-none focus:shadow-insetBorder';

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

      <Section title="Mobile apps">
        <p className="mb-3 text-sm text-subdued">
          Spotless speaks the Subsonic API, so native mobile apps like{' '}
          <span className="text-white">Symfonium</span>, <span className="text-white">DSub</span> or{' '}
          <span className="text-white">play:Sub</span> can stream, transcode and download your library
          for offline listening. Add a server in the app with these details:
        </p>
        {appCred ? (
          <div className="space-y-2 text-sm">
            <div className="rounded bg-highlight px-3 py-2">
              <span className="text-subdued">Server: </span>
              <span className="break-all">{typeof location !== 'undefined' ? location.origin : ''}</span>
            </div>
            <div className="rounded bg-highlight px-3 py-2">
              <span className="text-subdued">Username: </span>
              {appCred.username}
            </div>
            <div className="flex items-center gap-2 rounded bg-highlight px-3 py-2">
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
          {scanInfo && <div className="mb-3 text-sm text-subdued">{scanInfo}</div>}
          <div className="mb-3 flex flex-wrap gap-2">
            <button className={btn} onClick={() => setPickerOpen(true)}>Change folder</button>
            <button className={btn} onClick={rescan} disabled={scanning}>
              {scanning ? 'Scanning…' : 'Rescan now'}
            </button>
            <button className={btn} onClick={fetchArt} disabled={artBusy}>
              {artBusy ? 'Fetching art…' : 'Fetch missing artwork'}
            </button>
          </div>
          {artInfo && <div className="text-sm text-subdued">{artInfo}</div>}
        </Section>
      )}

      <Section title="Playback">
        <label className="mb-2 block text-sm font-medium">Streaming quality</label>
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'raw', label: 'Original' },
            { id: 'high', label: 'High · 320' },
            { id: 'normal', label: 'Normal · 192' },
            { id: 'saver', label: 'Data saver · 128' },
          ].map((o) => (
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
              <button className={btn} onClick={reimportSpotify}>Re-import taste</button>
              <button className={btn} onClick={disconnectSpotify}>Disconnect</button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-3 text-sm text-subdued">Not connected. Seeds Discover with your Spotify taste.</div>
            <a href="/api/spotify/login" className="btn-primary inline-block">
              Connect Spotify
            </a>
          </>
        )}
      </Section>

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
            <div className={`mb-3 rounded px-3 py-2 text-sm ${lidarrMsg.ok ? 'bg-accent/10 text-accent' : 'bg-negative/10 text-negative'}`}>
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
              <div key={i} className="rounded bg-base p-3 text-sm">
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
    </div>
  );
}
