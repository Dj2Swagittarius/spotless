'use client';

import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import Player from './Player';
import MobileNav from './MobileNav';
import TopBar from './TopBar';
import ProfilePicker from './ProfilePicker';
import { useLikes } from '@/store/likes';

export default function Shell({ children }: { children: React.ReactNode }) {
  const loadLikes = useLikes((s) => s.load);
  const [needsProfile, setNeedsProfile] = useState(false);
  useEffect(() => {
    loadLikes();
    fetch('/api/users')
      .then((r) => r.json())
      .then((d) => {
        if (!d.current) setNeedsProfile(true);
      })
      .catch(() => {});
  }, [loadLikes]);

  if (needsProfile) {
    return (
      <ProfilePicker
        onSelected={() => {
          setNeedsProfile(false);
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
