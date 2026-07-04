'use client';

import { useEffect, useRef, useState } from 'react';
import FolderPicker from './FolderPicker';
import { LogoMark } from './Logo';

/**
 * First-run wizard: shown only when the install has no profiles yet.
 * Every step except the profile is skippable — all of it lives in Settings too.
 */

const STEPS = ['Welcome', 'Profile', 'Music', 'Lidarr', 'Spotify', 'Done'] as const;
// the middle four are the real numbered sequence; welcome/done bookend it
const EYEBROWS: Record<number, string> = { 1: 'Profile', 2: 'Music', 3: 'Lidarr · optional', 4: 'Spotify · optional' };

export default function SetupWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);

  // profile
  const [name, setName] = useState('');
  const [profileErr, setProfileErr] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);

  // music
  const [musicDir, setMusicDir] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [trackCount, setTrackCount] = useState<number | null>(null);
  const scanPoll = useRef<ReturnType<typeof setInterval> | null>(null);

  // lidarr
  const [lidarrUrl, setLidarrUrl] = useState('');
  const [lidarrKey, setLidarrKey] = useState('');
  const [lidarrBusy, setLidarrBusy] = useState(false);
  const [lidarrMsg, setLidarrMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [lidarrDone, setLidarrDone] = useState(false);

  // spotify
  const [spotifyConfigured, setSpotifyConfigured] = useState<boolean | null>(null);
  const [spotifyConnected, setSpotifyConnected] = useState(false);

  useEffect(() => {
    fetch('/api/settings/music-dir').then((r) => r.json()).then((d) => setMusicDir(d.dir)).catch(() => {});
    return () => {
      if (scanPoll.current) clearInterval(scanPoll.current);
    };
  }, []);

  // spotify state is per-profile, so load it once the profile exists
  useEffect(() => {
    if (step !== 4) return;
    fetch('/api/spotify/status')
      .then((r) => r.json())
      .then((d) => {
        setSpotifyConfigured(!!d.clientConfigured);
        setSpotifyConnected(!!d.connected);
      })
      .catch(() => setSpotifyConfigured(false));
  }, [step]);

  const createProfile = async () => {
    const n = name.trim();
    if (!n) return;
    setProfileErr(null);
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n }),
    });
    const data = await res.json();
    if (!res.ok) {
      setProfileErr(data.error || 'Could not create the profile');
      return;
    }
    await fetch('/api/users/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: data.id }),
    });
    setProfileName(n);
    setStep(2);
  };

  const startScan = async () => {
    setScanning(true);
    setTrackCount(null);
    await fetch('/api/scan', { method: 'POST' }).catch(() => {});
    scanPoll.current = setInterval(async () => {
      const s = await fetch('/api/scan').then((r) => r.json()).catch(() => null);
      if (s && !s.scanning) {
        if (scanPoll.current) clearInterval(scanPoll.current);
        scanPoll.current = null;
        setScanning(false);
        setTrackCount(s.lastScan?.total ?? 0);
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
      setLidarrMsg({ ok: false, text: data.error || 'Connection failed' });
      return;
    }
    setLidarrMsg({ ok: true, text: `Connected — Lidarr v${data.version}` });
    setLidarrDone(true);
  };

  const finish = async () => {
    await fetch('/api/setup', { method: 'POST' }).catch(() => {});
    onDone();
  };

  const input =
    'w-full rounded bg-highlight px-3 py-2.5 text-sm text-white placeholder:text-subdued outline-none focus:shadow-insetBorder';

  const SkipButton = ({ to }: { to: number }) => (
    <button onClick={() => setStep(to)} className="rounded-full px-4 py-1.5 text-sm font-medium text-subdued hover:text-white">
      Skip for now
    </button>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-base p-4">
      {/* vinyl grooves — the logo's ring motif, pressed into the backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'repeating-radial-gradient(circle at 50% 42%, transparent 0px, transparent 42px, rgba(255,255,255,0.025) 42px, rgba(255,255,255,0.025) 44px)',
        }}
      />
      {pickerOpen && (
        <FolderPicker
          onClose={() => setPickerOpen(false)}
          onSaved={(dir) => {
            setMusicDir(dir);
            setPickerOpen(false);
          }}
        />
      )}

      <div className="relative w-full max-w-lg">
        {/* step dots: done · current · upcoming */}
        <div className="mb-6 flex items-center justify-center gap-2" aria-hidden>
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-6 bg-accent' : i < step ? 'w-1.5 bg-white/40' : 'w-1.5 bg-border'
              }`}
            />
          ))}
        </div>

        <div key={step} className="step-enter rounded-lg bg-elevated p-6 shadow-dialog sm:p-8">
          {step >= 1 && step <= 4 && (
            <div className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-subdued">
              Step {step} of 4 — {EYEBROWS[step]}
            </div>
          )}

          {step === 0 && (
            <div className="flex flex-col items-center gap-5 py-2 text-center">
              <LogoMark size={72} hole="#181818" />
              <h1 className="font-display text-4xl font-extrabold leading-none tracking-tight">
                Spotless<span className="text-accent">.</span>
              </h1>
              <p className="max-w-sm text-sm text-subdued">
                Your music, on your server, for the whole household. Setup takes about a minute —
                everything here can be changed later in Settings.
              </p>
              <button onClick={() => setStep(1)} className="btn-primary mt-1">
                Get started
              </button>
            </div>
          )}

          {step === 1 && profileName && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold">Create your profile</h2>
              <div className="text-sm font-medium text-accent">✓ Profile “{profileName}” created</div>
              <div className="flex justify-end">
                <button onClick={() => setStep(2)} className="btn-primary">
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 1 && !profileName && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold">Create your profile</h2>
              <p className="text-sm text-subdued">
                Profiles keep likes, playlists and history separate for each person. The first
                profile is the admin — server settings are only visible to it.
              </p>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createProfile()}
                placeholder="Your name"
                maxLength={30}
                className={input}
              />
              {profileErr && <div className="text-sm text-negative">{profileErr}</div>}
              <div className="flex justify-end">
                <button onClick={createProfile} disabled={!name.trim()} className="btn-primary">
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold">Your music folder</h2>
              <p className="text-sm text-subdued">
                Spotless scans this folder for audio files. In Docker it&apos;s the volume mounted at{' '}
                <span className="text-white">/music</span>.
              </p>
              <div className="rounded bg-highlight px-3 py-2.5 text-sm">
                <span className="text-subdued">Folder: </span>
                <span className="break-all">{musicDir || '…'}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setPickerOpen(true)} className="btn-pill">
                  Change folder
                </button>
                <button onClick={startScan} disabled={scanning} className="btn-pill">
                  {scanning ? 'Scanning…' : trackCount !== null ? 'Scan again' : 'Scan now'}
                </button>
              </div>
              {scanning && <div className="text-sm text-subdued">Reading tags — bigger libraries take a few minutes…</div>}
              {trackCount !== null && !scanning && (
                <div className="step-enter text-base font-bold text-accent">
                  ✓ Found {trackCount.toLocaleString()} tracks
                </div>
              )}
              <div className="flex justify-between pt-2">
                <SkipButton to={3} />
                <button onClick={() => setStep(3)} className="btn-primary" disabled={scanning}>
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold">Connect Lidarr</h2>
              <p className="text-sm text-subdued">
                With Lidarr connected, Discover and Search grow download buttons — and family
                profiles can request music for the admin to approve. API key: Lidarr → Settings →
                General.
              </p>
              <input className={input} value={lidarrUrl} onChange={(e) => setLidarrUrl(e.target.value)} placeholder="http://lidarr:8686" />
              <input
                className={input}
                value={lidarrKey}
                onChange={(e) => setLidarrKey(e.target.value)}
                type="password"
                placeholder="API key"
              />
              {lidarrMsg && (
                <div className={`rounded px-3 py-2 text-sm ${lidarrMsg.ok ? 'bg-accent/10 text-accent' : 'bg-negative/10 text-negative'}`}>
                  {lidarrMsg.text}
                </div>
              )}
              <div className="flex justify-between pt-2">
                <SkipButton to={4} />
                {lidarrDone ? (
                  <button onClick={() => setStep(4)} className="btn-primary">
                    Continue
                  </button>
                ) : (
                  <button onClick={saveLidarr} disabled={lidarrBusy || !lidarrUrl.trim() || !lidarrKey.trim()} className="btn-primary">
                    {lidarrBusy ? 'Testing…' : 'Test & save'}
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold">Connect Spotify</h2>
              {spotifyConfigured === null && <p className="text-sm text-subdued">Checking…</p>}
              {spotifyConfigured === false && (
                <p className="text-sm text-subdued">
                  Spotify import needs a free Spotify app: set the{' '}
                  <span className="text-white">SPOTIFY_CLIENT_ID</span> environment variable (see the
                  README) and this step lights up in Settings. Nothing else depends on it.
                </p>
              )}
              {spotifyConfigured && !spotifyConnected && (
                <>
                  <p className="text-sm text-subdued">
                    Imports your taste (top + saved artists) to seed Discover, and can rebuild your
                    Spotify playlists from your local files. Heads up: Spotify only allows the
                    connect flow from the machine running Spotless, browsed via{' '}
                    <span className="text-white">http://127.0.0.1:3000</span> — it&apos;s often easier
                    to do this later from Settings.
                  </p>
                  <a href="/api/spotify/login" className="btn-primary inline-block">
                    Connect Spotify
                  </a>
                </>
              )}
              {spotifyConnected && <div className="text-sm font-medium text-accent">✓ Spotify connected</div>}
              <div className="flex justify-between pt-2">
                <SkipButton to={5} />
                <button onClick={() => setStep(5)} className="btn-primary">
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold">You&apos;re set{profileName ? `, ${profileName}` : ''} 🎉</h2>
              <ul className="space-y-1.5 text-sm">
                <li>
                  <span className="text-accent">✓</span> Profile created — you&apos;re the admin
                </li>
                <li>
                  {trackCount !== null ? (
                    <>
                      <span className="text-accent">✓</span> Library scanned — {trackCount} tracks
                    </>
                  ) : (
                    <span className="text-subdued">○ Library scan skipped — Settings → Rescan when ready</span>
                  )}
                </li>
                <li>
                  {lidarrDone ? (
                    <>
                      <span className="text-accent">✓</span> Lidarr connected
                    </>
                  ) : (
                    <span className="text-subdued">○ Lidarr skipped — Settings → Lidarr any time</span>
                  )}
                </li>
                <li>
                  {spotifyConnected ? (
                    <>
                      <span className="text-accent">✓</span> Spotify connected
                    </>
                  ) : (
                    <span className="text-subdued">○ Spotify skipped — Settings → Spotify any time</span>
                  )}
                </li>
              </ul>
              <p className="text-sm text-subdued">
                Family members add their own profiles from the Who&apos;s-listening screen — no
                passwords needed.
              </p>
              <div className="flex justify-end pt-2">
                <button onClick={finish} className="btn-primary">
                  Start listening
                </button>
              </div>
            </div>
          )}
        </div>

        {step > 0 && step < 5 && (
          <button
            onClick={() => setStep(step - 1)}
            className="mt-4 block w-full text-center text-sm text-subdued hover:text-white"
          >
            ← Back
          </button>
        )}
      </div>
    </div>
  );
}
