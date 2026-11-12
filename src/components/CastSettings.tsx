'use client';

import { useEffect, useState } from 'react';

interface CastDevice {
  id: string;
  name: string;
  host: string;
  port: number;
  model: string;
  manual: boolean;
  playing: boolean;
}

interface CastStatus {
  enabled: boolean;
  baseUrl: string | null;
  devices: CastDevice[];
  manual: { host: string; port: number; name: string }[];
}

const input =
  'w-full rounded-sm bg-highlight px-3 py-2 text-sm text-white placeholder:text-subdued outline-hidden focus:shadow-insetBorder';
const btn = 'btn-pill';

/** Settings → Chromecast: what the server found, and adding receivers by address. */
export default function CastSettings() {
  const [status, setStatus] = useState<CastStatus | null>(null);
  const [host, setHost] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/settings/cast')
      .then((r) => (r.ok ? (r.json() as Promise<CastStatus>) : null))
      .then((s) => s && setStatus(s))
      .catch(() => {});
  }, []);

  const post = async (body: Record<string, unknown>, done?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/settings/cast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await r.json()) as CastStatus & { error?: string };
      if (!r.ok) {
        setMsg({ ok: false, text: data.error ?? 'Something went wrong' });
        return false;
      }
      setStatus(data);
      if (done) setMsg({ ok: true, text: done });
      return true;
    } catch {
      setMsg({ ok: false, text: 'Could not reach the server' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (await post({ action: 'add', host, name }, 'Added. It now shows up under Play on.')) {
      setHost('');
      setName('');
    }
  };

  if (!status) return <div className="text-sm text-subdued">Loading…</div>;
  if (!status.enabled) {
    return <div className="text-sm text-subdued">Casting is turned off on this server (CAST_ENABLED=false).</div>;
  }

  return (
    <div>
      <p className="mb-3 text-sm text-subdued">
        Chromecasts and Google TV devices on your network show up under Play on, next to your other devices. The server
        plays to them directly, so this works from any browser, the Android app or a TV. If yours does not appear
        (common when Spotless runs in Docker on a bridge network), add it by its IP address.
      </p>
      <div className="mb-3 space-y-1">
        {status.devices.length === 0 && <div className="text-sm text-subdued">No Chromecasts found yet.</div>}
        {status.devices.map((d) => (
          <div key={d.id} className="flex items-center gap-3 rounded-sm bg-highlight px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{d.name}</span>
              <span className="block truncate text-xs text-subdued">
                {[
                  d.model,
                  `${d.host}${d.port === 8009 ? '' : `:${d.port}`}`,
                  d.manual ? 'added by hand' : 'found on network',
                  d.playing ? 'casting now' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            {d.manual && (
              <button
                className="text-xs text-subdued hover:text-white hover:underline"
                disabled={busy}
                onClick={() => post({ action: 'remove', host: d.host, port: d.port })}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input
          className={input}
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="IP address, e.g. 192.168.1.40"
          aria-label="Chromecast IP address"
        />
        <input
          className={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional)"
          maxLength={60}
          aria-label="Chromecast name"
        />
        <button className={btn} onClick={add} disabled={busy || !host.trim()}>
          Add
        </button>
      </div>
      {msg && (
        <div
          className={`mb-3 rounded-sm px-3 py-2 text-sm ${msg.ok ? 'bg-accent/10 text-accent' : 'bg-negative/10 text-negative'}`}
        >
          {msg.text}
        </div>
      )}
      <button className={btn} onClick={() => post({ action: 'scan' }, 'Search finished.')} disabled={busy}>
        {busy ? 'Working…' : 'Search again'}
      </button>
    </div>
  );
}
