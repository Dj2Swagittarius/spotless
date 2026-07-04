'use client';

import { useEffect, useState } from 'react';
import { XIcon } from './Icons';

interface BrowseResult {
  path: string;
  parent: string | null;
  dirs: string[];
  error?: string;
}

export default function FolderPicker({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (dir: string) => void;
}) {
  const [current, setCurrent] = useState<BrowseResult | null>(null);
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const browse = async (p?: string) => {
    setError(null);
    const url = p !== undefined ? `/api/browse?path=${encodeURIComponent(p)}` : '/api/browse';
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Cannot read folder');
      return;
    }
    setCurrent(data);
    setManual(data.path === ':' ? '' : data.path);
  };

  useEffect(() => {
    browse();
  }, []);

  const enter = (name: string) => {
    if (!current) return;
    const sep = current.path.endsWith('\\') || current.path.endsWith('/') ? '' : current.path.includes('\\') ? '\\' : '/';
    browse(current.path === ':' ? name : current.path + sep + name);
  };

  const save = async () => {
    const dir = manual.trim();
    if (!dir) return;
    setSaving(true);
    setError(null);
    const res = await fetch('/api/settings/music-dir', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error || 'Failed to save');
      return;
    }
    onSaved(data.dir);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg bg-elevated p-5 shadow-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold">Music folder</h2>
          <button onClick={onClose} className="rounded-full p-1 text-subdued hover:text-white" title="Close">
            <XIcon size={20} />
          </button>
        </div>

        <div className="mb-3 flex gap-2">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && browse(manual.trim())}
            placeholder="Type a path or browse below"
            className="min-w-0 flex-1 rounded bg-highlight px-3 py-2 text-sm text-white placeholder:text-subdued focus:outline-none focus:ring-1 focus:ring-white/50"
          />
          <button
            onClick={() => browse(manual.trim())}
            className="btn-pill px-3"
          >
            Go
          </button>
        </div>

        {error && <div className="mb-3 rounded bg-negative/10 px-3 py-2 text-sm text-negative">{error}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto rounded bg-base">
          {current?.parent !== null && current !== null && (
            <button
              onClick={() => browse(current.parent!)}
              className="block w-full px-3 py-2 text-left text-sm text-subdued hover:bg-highlight hover:text-white"
            >
              ⬆ Up
            </button>
          )}
          {current?.dirs.map((d) => (
            <button
              key={d}
              onClick={() => enter(d)}
              className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-highlight"
            >
              📁 {d}
            </button>
          ))}
          {current && current.dirs.length === 0 && (
            <div className="px-3 py-2 text-sm text-subdued">No subfolders</div>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full px-4 py-1.5 text-sm font-medium text-subdued hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !manual.trim()}
            className="btn-primary"
          >
            {saving ? 'Saving…' : 'Use this folder'}
          </button>
        </div>
      </div>
    </div>
  );
}
