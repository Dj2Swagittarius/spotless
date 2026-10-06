'use client';

import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import Player from './Player';
import MobileNav from './MobileNav';
import TopBar from './TopBar';
import ProfilePicker from './ProfilePicker';
import SetupWizard from './SetupWizard';
import { useLikes } from '@/store/likes';

type Gate = 'loading' | 'setup' | 'login' | 'ready';

export default function Shell({ children }: { children: React.ReactNode }) {
  const loadLikes = useLikes((s) => s.load);
  const [gate, setGate] = useState<Gate>('loading');

  useEffect(() => {
    fetch('/api/users', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.current) {
          setGate('ready');
          loadLikes();
          return;
        }
        if ((d.users?.length ?? 0) === 0) setGate('setup');
        else setGate('login');
      })
      .catch(() => setGate('login'));
  }, [loadLikes]);

  if (gate === 'loading') return <div className="h-dvh bg-black" />;
  if (gate === 'setup') return <SetupWizard onDone={() => location.reload()} />;
  if (gate === 'login') {
    return (
      <ProfilePicker
        onSelected={() => {
          setGate('ready');
          location.reload();
        }}
      />
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-black">
      <TopBar />
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        <Sidebar />
        <main className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-gradient-to-b from-highlight to-base">
          <div className="px-4 pb-6 pt-4 sm:px-6 sm:pb-8">{children}</div>
        </main>
      </div>
      <Player />
      <MobileNav />
    </div>
  );
}
