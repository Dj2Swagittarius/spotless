'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePlayer } from '@/store/player';
import { LoadErrorState } from '@/components/Cards';
import { PlayIcon, PauseIcon, RadioIcon, XIcon } from '@/components/Icons';
import { getJson, isAbortError, type LoadStatus } from '@/lib/http';
import { stationTrack, type RadioStation } from '@/lib/types';

interface FormState {
  id: number | null; // null = creating
  name: string;
  streamUrl: string;
  homePageUrl: string;
}

export default function RadiosPage() {
  const [stations, setStations] = useState<RadioStation[] | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState('');
  // selectors: only the current track and play state matter here, not every store change
  const current = usePlayer((s) => (s.index >= 0 ? (s.queue[s.index] ?? null) : null));
  const isPlaying = usePlayer((s) => s.isPlaying);
  const playQueue = usePlayer((s) => s.playQueue);
  const toggle = usePlayer((s) => s.toggle);

  // also called after saving or deleting a station; a failed refetch keeps the list already showing
  const load = useCallback(
    (signal?: AbortSignal) =>
      getJson<RadioStation[]>('/api/stations', { signal })
        .then((d) => {
          setStations(d);
          setStatus('ready');
        })
        .catch((err) => {
          if (!isAbortError(err)) setStatus((s) => (s === 'ready' ? s : 'error'));
        }),
    []
  );

  useEffect(() => {
    const ac = new AbortController();
    setStatus('loading');
    load(ac.signal);
    getJson<{ current?: { isAdmin?: boolean } }>('/api/users', { signal: ac.signal })
      .then((d) => setIsAdmin(Boolean(d.current?.isAdmin)))
      .catch(() => {});
    return () => ac.abort();
  }, [load, attempt]);

  const play = (s: RadioStation) => {
    if (current?.id === -s.id) toggle();
    else playQueue([stationTrack(s)]);
  };

  const submit = async () => {
    if (!form) return;
    setFormError('');
    const res = await fetch('/api/stations', {
      method: form.id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: form.id ?? undefined, name: form.name, streamUrl: form.streamUrl, homePageUrl: form.homePageUrl }),
    }).catch(() => null);
    if (!res?.ok) {
      const d = res ? await res.json().catch(() => ({})) : {};
      setFormError(d.error || 'Failed to save');
      return;
    }
    setForm(null);
    load();
  };

  const remove = async (s: RadioStation) => {
    await fetch('/api/stations', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.id }),
    }).catch(() => {});
    load();
  };

  const input = 'w-full rounded bg-highlight px-3 py-2 text-sm text-white placeholder:text-subdued outline-none focus:shadow-insetBorder';

  const hostOf = (url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Radio</h1>
        {isAdmin && (
          <button
            className="btn-pill"
            onClick={() => setForm({ id: null, name: '', streamUrl: '', homePageUrl: '' })}
          >
            Add station
          </button>
        )}
      </div>

      {form && (
        <>
          <div className="fixed inset-0 z-[90] bg-black/60" onClick={() => setForm(null)} aria-hidden />
          <div
            role="dialog"
            aria-label={form.id ? 'Edit station' : 'Add station'}
            className="fixed left-1/2 top-1/2 z-[95] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-elevated p-5 shadow-dialog"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">{form.id ? 'Edit station' : 'Add station'}</h2>
              <button onClick={() => setForm(null)} className="rounded-full p-1.5 text-subdued hover:text-white" title="Close" aria-label="Close">
                <XIcon size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Station name" aria-label="Station name" autoFocus />
              <input className={input} value={form.streamUrl} onChange={(e) => setForm({ ...form, streamUrl: e.target.value })} placeholder="Stream URL (http://…/stream)" aria-label="Stream URL" />
              <input className={input} value={form.homePageUrl} onChange={(e) => setForm({ ...form, homePageUrl: e.target.value })} placeholder="Homepage (optional)" aria-label="Homepage" />
              {formError && <div className="rounded bg-negative/10 px-3 py-2 text-sm text-negative">{formError}</div>}
              <div className="flex justify-end gap-2 pt-1">
                <button className="btn-pill" onClick={() => setForm(null)}>Cancel</button>
                <button className="btn-primary" onClick={submit} disabled={!form.name.trim() || !form.streamUrl.trim()}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* retry re-runs the effect so the page drops back to the skeleton while it refetches */}
      {status === 'error' && <LoadErrorState what="your stations" onRetry={() => setAttempt((n) => n + 1)} />}

      {status === 'loading' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-hidden>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-lg bg-elevated" />
          ))}
        </div>
      )}

      {status === 'ready' && stations && stations.length === 0 && (
        <div className="rounded-lg bg-elevated p-8 text-center text-subdued">
          <RadioIcon size={40} className="mx-auto mb-3 opacity-60" />
          <p className="font-medium text-white">No stations yet</p>
          <p className="mt-1 text-sm">
            {isAdmin
              ? 'Add your favorite internet radio streams — any direct icecast/shoutcast URL works.'
              : 'Ask the admin to add some internet radio stations.'}
          </p>
        </div>
      )}

      {status === 'ready' && stations && stations.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {stations.map((s) => {
            const active = current?.id === -s.id;
            return (
              <div key={s.id} className="group relative rounded-lg bg-elevated p-4 transition-colors hover:bg-highlight">
                <div className="mb-3 flex items-start justify-between">
                  <span className={`flex h-12 w-12 items-center justify-center rounded-full ${active ? 'bg-accent text-black' : 'bg-highlight text-subdued group-hover:bg-press'}`}>
                    <RadioIcon size={22} />
                  </span>
                  {isAdmin && (
                    <div className="flex gap-1 opacity-60 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                      <button
                        onClick={() => setForm({ id: s.id, name: s.name, streamUrl: s.streamUrl, homePageUrl: s.homePageUrl ?? '' })}
                        className="rounded-full px-2 py-1 text-xs text-subdued hover:text-white"
                        aria-label={`Edit ${s.name}`}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => remove(s)}
                        className="rounded-full p-1.5 text-subdued hover:text-negative"
                        title={`Delete ${s.name}`}
                        aria-label={`Delete ${s.name}`}
                      >
                        <XIcon size={14} />
                      </button>
                    </div>
                  )}
                </div>
                <div className="truncate font-semibold">{s.name}</div>
                <div className="mb-3 truncate text-xs text-subdued">
                  {active && isPlaying ? (
                    <span className="text-accent">● Live now</span>
                  ) : s.homePageUrl ? (
                    <a href={s.homePageUrl} target="_blank" rel="noreferrer" className="hover:text-white hover:underline">
                      {hostOf(s.homePageUrl)}
                    </a>
                  ) : (
                    'Internet radio'
                  )}
                </div>
                <button
                  onClick={() => play(s)}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-black transition-transform hover:scale-105 active:scale-95"
                  title={active && isPlaying ? `Pause ${s.name}` : `Play ${s.name}`}
                  aria-label={active && isPlaying ? `Pause ${s.name}` : `Play ${s.name}`}
                >
                  {active && isPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
