'use client';

import { useState } from 'react';
import { playOn, renameThisDevice, useDevices } from '@/lib/client/devices';
import { useEscape } from '@/lib/client/escapeStack';
import type { DeviceKind } from '@/lib/devices';
import { ComputerIcon, DevicesIcon, PhoneIcon, TvIcon } from './Icons';

const KIND_ICON: Record<DeviceKind, typeof TvIcon> = { computer: ComputerIcon, phone: PhoneIcon, tv: TvIcon };

/** "Play on": the button in the player bar and its list of this user's open devices. */
export default function DevicePicker({ size = 18, className = '' }: { size?: number; className?: string }) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const me = useDevices((s) => s.me);
  const devices = useDevices((s) => s.devices);
  const activeId = useDevices((s) => s.activeId);
  const remote = useDevices((s) => s.remote);
  const close = () => {
    setOpen(false);
    setRenaming(null);
  };
  useEscape(open, close);

  if (!me) return null;
  // this page first, then the rest in the order they connected
  const list = [me, ...devices.filter((d) => d.id !== me.id)];
  const playingId = activeId ?? me.id;

  const pick = async (id: string) => {
    if (id === playingId) return close();
    setBusy(id);
    await playOn(id);
    setBusy(null);
    close();
  };

  const saveName = async () => {
    if (renaming !== null) await renameThisDevice(renaming);
    setRenaming(null);
  };

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`rounded-full p-2 ${remote || open ? 'text-accent' : 'text-subdued hover:text-white'} ${className}`}
        title="Play on another device"
        aria-label="Play on another device"
        aria-expanded={open}
      >
        <DevicesIcon size={size} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-84 bg-black/40 md:z-40" onClick={close} aria-hidden />
          <div
            data-overlay
            className="fixed inset-x-2 bottom-56 z-85 max-h-[60vh] overflow-y-auto rounded-lg border border-highlight bg-elevated p-3 shadow-dialog md:inset-x-auto md:bottom-24 md:right-2 md:z-50 md:w-80"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-bold">Play on</span>
              <button onClick={close} className="rounded-full p-1.5 text-subdued hover:text-white" aria-label="Close devices">
                ✕
              </button>
            </div>
            {list.map((d) => {
              const Icon = KIND_ICON[d.kind];
              const playing = d.id === playingId;
              return (
                <button
                  key={d.id}
                  onClick={() => pick(d.id)}
                  disabled={busy !== null}
                  className={`flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left hover:bg-highlight disabled:opacity-60 ${playing ? 'text-accent' : ''}`}
                >
                  <Icon size={22} className="shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{d.name}</span>
                    <span className={`block truncate text-xs ${playing ? 'text-accent' : 'text-subdued'}`}>
                      {busy === d.id
                        ? 'Connecting...'
                        : [d.id === me.id ? 'This device' : null, playing ? 'Playing' : null].filter(Boolean).join(' · ') ||
                          'Available'}
                    </span>
                  </span>
                </button>
              );
            })}
            {list.length === 1 && (
              <p className="px-2 pt-1 text-xs text-subdued">
                Open Spotless on your TV, phone or another computer, signed in to this profile, and it shows up here.
              </p>
            )}
            <div className="mt-2 border-t border-highlight px-2 pt-2">
              {renaming === null ? (
                <button onClick={() => setRenaming(me.name)} className="text-xs text-subdued hover:text-white hover:underline">
                  Rename this device
                </button>
              ) : (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveName();
                  }}
                >
                  <input
                    autoFocus
                    value={renaming}
                    maxLength={60}
                    onChange={(e) => setRenaming(e.target.value)}
                    className="min-w-0 flex-1 rounded-sm bg-highlight px-2 py-1 text-sm outline-none"
                    aria-label="Device name"
                  />
                  <button type="submit" className="rounded-full bg-white px-3 py-1 text-xs font-bold text-black">
                    Save
                  </button>
                </form>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** "Playing on <device>" line, shown while this page is a remote. */
export function PlayingOnBanner({ className = '' }: { className?: string }) {
  const remote = useDevices((s) => s.remote);
  const name = useDevices((s) => s.activeName);
  if (!remote) return null;
  return (
    <div className={`flex items-center gap-1.5 text-xs font-bold text-accent ${className}`}>
      <DevicesIcon size={14} />
      <span className="truncate">Playing on {name ?? 'another device'}</span>
    </div>
  );
}
