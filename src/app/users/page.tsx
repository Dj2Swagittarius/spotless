'use client';

import { FormEvent, useEffect, useState } from 'react';

interface User {
  id: number;
  name: string;
  color: string;
  passwordSet: boolean;
  isAdmin?: boolean;
}

function PasswordForm({
  user,
  currentUserId,
  onDone,
}: {
  user: User;
  currentUserId: number;
  onDone: (message: string) => void;
}) {
  const isSelf = user.id === currentUserId;
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/users/${user.id}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || 'Could not update password.');
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setConfirm('');
    onDone(isSelf ? 'Your password was changed. Other sessions were signed out.' : `${user.name}'s password was reset. Their existing sessions were signed out.`);
  };

  return (
    <form onSubmit={submit} className="mt-4 space-y-2">
      {isSelf && (
        <input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="Current password"
          maxLength={128}
          className="w-full rounded-sm bg-highlight px-3 py-2 text-sm outline-hidden focus:shadow-insetBorder"
        />
      )}
      <input
        type="password"
        autoComplete="new-password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        placeholder={isSelf ? 'New password' : `New password for ${user.name}`}
        maxLength={128}
        className="w-full rounded-sm bg-highlight px-3 py-2 text-sm outline-hidden focus:shadow-insetBorder"
      />
      <input
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Confirm new password"
        maxLength={128}
        className="w-full rounded-sm bg-highlight px-3 py-2 text-sm outline-hidden focus:shadow-insetBorder"
      />
      <div className="text-xs text-subdued">A PIN is fine on a home network; use a long passphrase if Spotless is reachable from the internet.</div>
      {error && <div className="text-sm text-negative">{error}</div>}
      <button className="btn-pill" disabled={busy || !newPassword || !confirm || (isSelf && !currentPassword)}>
        {busy ? 'Saving…' : isSelf ? 'Change my password' : 'Reset password'}
      </button>
    </form>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [me, setMe] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = () => {
    setLoading(true);
    fetch('/api/users', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setUsers(d.users ?? []);
        setMe(d.current ?? null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []);

  const createProfile = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setCreateBusy(true);
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password }),
    });
    const data = await res.json().catch(() => ({}));
    setCreateBusy(false);
    if (!res.ok) {
      setError(data.error || 'Could not create profile.');
      return;
    }
    setName('');
    setPassword('');
    setConfirm('');
    setMessage(`Profile “${data.name}” created.`);
    load();
  };

  if (loading) return <div className="mx-auto max-w-3xl text-subdued">Loading profiles…</div>;
  if (!me) return <div className="mx-auto max-w-3xl text-subdued">Sign in to manage your profile.</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-3xl font-bold">{me.isAdmin ? 'Profile management' : 'Password'}</h1>
        <p className="mt-1 text-sm text-subdued">
          {me.isAdmin
            ? 'Create profiles and reset web-login passwords. Password changes revoke the affected profile’s existing web sessions.'
            : 'Change the password used to sign in to this Spotless profile.'}
        </p>
      </div>

      {message && <div className="rounded-sm bg-accent/10 px-3 py-2 text-sm text-accent">{message}</div>}

      {me.isAdmin && (
        <section className="rounded-lg bg-elevated p-5">
          <h2 className="text-lg font-bold">Create profile</h2>
          <form onSubmit={createProfile} className="mt-4 space-y-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Profile name"
              maxLength={30}
              autoComplete="off"
              className="w-full rounded-sm bg-highlight px-3 py-2 text-sm outline-hidden focus:shadow-insetBorder"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password or passphrase"
              maxLength={128}
              autoComplete="new-password"
              className="w-full rounded-sm bg-highlight px-3 py-2 text-sm outline-hidden focus:shadow-insetBorder"
            />
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm password"
              maxLength={128}
              autoComplete="new-password"
              className="w-full rounded-sm bg-highlight px-3 py-2 text-sm outline-hidden focus:shadow-insetBorder"
            />
            <div className="text-xs text-subdued">A PIN is fine on a home network; use a long passphrase if Spotless is reachable from the internet.</div>
            {error && <div className="text-sm text-negative">{error}</div>}
            <button className="btn-primary" disabled={createBusy || !name.trim() || !password || !confirm}>
              {createBusy ? 'Creating…' : 'Create profile'}
            </button>
          </form>
        </section>
      )}

      <section className="space-y-3">
        {users.filter((u) => me.isAdmin || u.id === me.id).map((u) => (
          <div key={u.id} className="rounded-lg bg-elevated p-5">
            <div className="flex items-center gap-3">
              <span
                className="flex h-11 w-11 items-center justify-center rounded-full text-lg font-extrabold text-black"
                style={{ backgroundColor: u.color }}
              >
                {u.name.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-bold">
                  {u.name} {u.id === me.id && <span className="text-xs font-medium text-subdued">· you</span>}
                </div>
                <div className="text-xs text-subdued">
                  {u.id === 1 ? 'Admin profile' : 'Profile'} · {u.passwordSet ? 'password configured' : 'password not configured'}
                </div>
              </div>
            </div>
            <PasswordForm
              user={u}
              currentUserId={me.id}
              onDone={(text) => {
                setMessage(text);
                load();
              }}
            />
          </div>
        ))}
      </section>
    </div>
  );
}
