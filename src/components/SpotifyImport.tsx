'use client';

import { useEffect, useState } from 'react';
import { XIcon } from './Icons';

interface SpotifyPlaylistInfo {
  id: string;
  name: string;
  trackCount: number;
}

interface ImportResult {
  playlistId: number;
  matched: number;
  total: number;
  missing: { title: string; artist: string; album: string }[];
}

export default function SpotifyImport({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [playlists, setPlaylists] = useState<SpotifyPlaylistInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // spotify playlist id being imported
  const [results, setResults] = useState<Record<string, ImportResult>>({});

  useEffect(() => {
    fetch('/api/spotify/playlists')
      .then((r) => r.json())
      .then((d) => (Array.isArray(d) ? setPlaylists(d) : setError(d.error || 'Failed to load playlists')))
      .catch(() => setError('Failed to load playlists'));
  }, []);

  const doImport = async (p: SpotifyPlaylistInfo) => {
    setBusy(p.id);
    setError(null);
    const res = await fetch('/api/spotify/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, name: p.name }),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) {
      setError(data.error || 'Import failed');
      return;
    }
    setResults((r) => ({ ...r, [p.id]: data }));
    onImported();
  };

  const copyMissing = (r: ImportResult) => {
    navigator.clipboard.writeText(r.missing.map((m) => `${m.artist} - ${m.title} (${m.album})`).join('\n')).catch(() => {});
  };

  const [filling, setFilling] = useState<Record<string, string>>({}); // playlist id -> progress text

  const sendMissingToLidarr = async (pid: string, r: ImportResult) => {
    // dedupe to unique albums — grabbing the album gets the song
    const albums = new Map<string, { artist: string; album: string }>();
    for (const m of r.missing) albums.set(`${m.artist}|${m.album}`.toLowerCase(), { artist: m.artist, album: m.album });
    const list = [...albums.values()];
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < list.length; i++) {
      setFilling((f) => ({ ...f, [pid]: `Sending ${i + 1}/${list.length}…` }));
      const res = await fetch('/api/lidarr/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: list[i].artist, album: list[i].album }),
      }).catch(() => null);
      if (res?.ok) ok++;
      else fail++;
    }
    setFilling((f) => ({ ...f, [pid]: `Done: ${ok} albums sent${fail ? `, ${fail} failed (not on MusicBrainz?)` : ''}` }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg bg-elevated p-5 shadow-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold">Import Spotify playlists</h2>
          <button onClick={onClose} className="rounded-full p-1 text-subdued hover:text-white" title="Close">
            <XIcon size={20} />
          </button>
        </div>

        {error && <div className="mb-3 rounded bg-negative/10 px-3 py-2 text-sm text-negative">{error}</div>}
        {!playlists && !error && <div className="text-subdued">Loading your Spotify playlists…</div>}
        {playlists?.length === 0 && <div className="text-subdued">No playlists on your Spotify account.</div>}

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {playlists?.map((p) => {
            const r = results[p.id];
            return (
              <div key={p.id} className="rounded bg-base p-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{p.name}</div>
                    <div className="text-sm text-subdued">
                      {p.trackCount > 0 ? `${p.trackCount} songs on Spotify` : 'Spotify playlist'}
                    </div>
                  </div>
                  {r ? (
                    <span className="text-sm font-medium text-accent">
                      ✓ {r.matched}/{r.total} matched
                    </span>
                  ) : (
                    <button
                      onClick={() => doImport(p)}
                      disabled={busy !== null}
                      className="btn-pill"
                    >
                      {busy === p.id ? 'Importing…' : 'Import'}
                    </button>
                  )}
                </div>
                {r && r.missing.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm text-subdued hover:text-white">
                      {r.missing.length} songs not in your library
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          copyMissing(r);
                        }}
                        className="ml-2 rounded border border-subdued px-2 py-0.5 text-xs hover:border-white hover:text-white"
                      >
                        Copy list
                      </button>
                      {filling[p.id] ? (
                        <span className="ml-2 text-xs text-accent">{filling[p.id]}</span>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            sendMissingToLidarr(p.id, r);
                          }}
                          className="ml-2 rounded border border-subdued px-2 py-0.5 text-xs hover:border-white hover:text-white"
                        >
                          ⤓ Send all to Lidarr
                        </button>
                      )}
                    </summary>
                    <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-sm text-subdued">
                      {r.missing.map((m, i) => (
                        <li key={i} className="truncate">
                          {m.artist} — {m.title}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
