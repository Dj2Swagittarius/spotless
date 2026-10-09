'use client';

import { FormEvent, useEffect, useState } from 'react';

interface User {
  id: number;
  name: string;
  color: string;
  passwordSet: boolean;
}

export default function ProfilePicker({ onSelected }: { onSelected: (u: User) => void }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [selected, setSelected] = useState<User | null>(null);
  const [bootstrapAllowed, setBootstrapAllowed] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/users', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setUsers(d.users ?? []);
        setBootstrapAllowed(Boolean(d.bootstrapAllowed));
      })
      .catch(() => setUsers([]));
  }, []);

  const choose = (u: User) => {
    setSelected(u);
    setPassword('');
    setError(null);
  };

  const login = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!selected || !password || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/users/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selected.id, password }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || 'Could not sign in.');
      return;
    }
    onSelected(data.user);
  };

  const isBootstrap = Boolean(selected && selected.id === 1 && !selected.passwordSet && bootstrapAllowed);

  return (
    <div className="fixed inset-0 z-100 flex flex-col items-center justify-center gap-8 overflow-y-auto bg-base p-6">
      <div className="text-center">
        <div className="text-3xl font-extrabold tracking-tight">
          Who&apos;s listening<span className="text-accent">?</span>
        </div>
        <p className="mt-2 text-sm text-subdued">Choose a profile, then enter its password.</p>
      </div>

      <div className="flex flex-wrap items-start justify-center gap-6">
        {users === null &&
          Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex w-24 animate-pulse flex-col items-center gap-2" aria-hidden>
              <div className="h-20 w-20 rounded-full bg-highlight" />
              <div className="h-3 w-14 rounded-sm bg-highlight" />
            </div>
          ))}
        {users?.map((u) => (
          <button key={u.id} onClick={() => choose(u)} className="group flex w-24 flex-col items-center gap-2">
            <span
              className={`flex h-20 w-20 items-center justify-center rounded-full text-3xl font-extrabold text-black transition-transform group-hover:scale-105 ${selected?.id === u.id ? 'ring-4 ring-white/80' : ''}`}
              style={{ backgroundColor: u.color }}
            >
              {u.name.charAt(0).toUpperCase()}
            </span>
            <span className="max-w-full truncate text-sm font-semibold">{u.name}</span>
          </button>
        ))}
      </div>

      {selected && (
        <form onSubmit={login} className="w-full max-w-sm space-y-3 rounded-lg bg-elevated p-5 shadow-dialog">
          <div>
            <div className="font-bold">{selected.name}</div>
            {isBootstrap ? (
              <p className="mt-1 text-sm text-subdued">
                Security upgrade: this old installation has no web passwords yet. Create the admin password now; this one-time claim closes immediately after success.
              </p>
            ) : !selected.passwordSet ? (
              <p className="mt-1 text-sm text-subdued">This profile is locked until the admin assigns it a password.</p>
            ) : null}
          </div>
          {(selected.passwordSet || isBootstrap) && (
            <>
              <input
                autoFocus
                type="password"
                autoComplete={isBootstrap ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isBootstrap ? 'Create admin password' : 'Password'}
                maxLength={128}
                className="w-full rounded-sm bg-highlight px-3 py-2.5 text-sm text-white placeholder:text-subdued outline-hidden focus:shadow-insetBorder"
              />
              {isBootstrap && <p className="text-xs text-subdued">A PIN is fine on a home network; use a long passphrase if Spotless is reachable from the internet.</p>}
              <button type="submit" disabled={busy || !password} className="btn-primary w-full">
                {busy ? 'Signing in…' : isBootstrap ? 'Secure & sign in' : 'Sign in'}
              </button>
            </>
          )}
          {error && <div className="text-sm text-negative">{error}</div>}
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setPassword('');
              setError(null);
            }}
            className="w-full text-sm text-subdued hover:text-white"
          >
            Back to profiles
          </button>
        </form>
      )}
    </div>
  );
}
