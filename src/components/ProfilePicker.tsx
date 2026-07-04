'use client';

import { useEffect, useState } from 'react';

interface User {
  id: number;
  name: string;
  color: string;
}

export default function ProfilePicker({ onSelected }: { onSelected: (u: User) => void }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/users')
      .then((r) => r.json())
      .then((d) => setUsers(d.users))
      .catch(() => setUsers([]));
  }, []);

  const select = async (u: User) => {
    await fetch('/api/users/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id }),
    });
    onSelected(u);
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Failed');
      return;
    }
    await select(data);
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-8 bg-base p-6">
      <div className="text-3xl font-extrabold tracking-tight">
        Who&apos;s listening<span className="text-accent">?</span>
      </div>
      <div className="flex flex-wrap items-start justify-center gap-6">
        {users === null &&
          Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex w-24 animate-pulse flex-col items-center gap-2" aria-hidden>
              <div className="h-20 w-20 rounded-full bg-highlight" />
              <div className="h-3 w-14 rounded bg-highlight" />
            </div>
          ))}
        {users?.map((u) => (
          <button key={u.id} onClick={() => select(u)} className="group flex w-24 flex-col items-center gap-2">
            <span
              className="flex h-20 w-20 items-center justify-center rounded-full text-3xl font-extrabold text-black transition-transform group-hover:scale-105"
              style={{ backgroundColor: u.color }}
            >
              {u.name.charAt(0).toUpperCase()}
            </span>
            <span className="max-w-full truncate text-sm font-semibold">{u.name}</span>
          </button>
        ))}
        {users !== null && !adding && (
          <button onClick={() => setAdding(true)} className="group flex w-24 flex-col items-center gap-2">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-highlight text-3xl text-subdued transition-transform group-hover:scale-105">
              +
            </span>
            <span className="text-sm font-semibold text-subdued">New profile</span>
          </button>
        )}
      </div>
      {adding && (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="Name"
            maxLength={30}
            className="rounded-full bg-highlight px-4 py-2 text-sm text-white placeholder:text-subdued focus:outline-none focus:shadow-insetBorder"
          />
          <button onClick={create} className="btn-primary">Add</button>
        </div>
      )}
      {error && <div className="text-sm text-negative">{error}</div>}
    </div>
  );
}
