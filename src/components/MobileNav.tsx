'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { HomeIcon, SearchIcon, LibraryIcon, MusicIcon } from './Icons';

export default function MobileNav() {
  const pathname = usePathname();
  const [me, setMe] = useState<{ name: string; color: string } | null>(null);

  useEffect(() => {
    fetch('/api/users').then((r) => r.json()).then((d) => setMe(d.current)).catch(() => {});
  }, []);

  const cls = (active: boolean) =>
    `flex flex-col items-center gap-1 text-xs ${active ? 'text-white' : 'text-subdued'}`;

  return (
    <nav className="relative z-40 flex items-center justify-around border-t border-highlight bg-black py-2 md:hidden">
      <Link href="/" className={cls(pathname === '/')}>
        <HomeIcon size={24} /> Home
      </Link>
      <Link href="/search" className={cls(pathname === '/search')}>
        <SearchIcon size={24} /> Search
      </Link>
      <Link href="/discover" className={cls(pathname === '/discover')}>
        <MusicIcon size={24} /> Discover
      </Link>
      <Link href="/library" className={cls(pathname.startsWith('/library') || pathname.startsWith('/playlist') || pathname === '/liked')}>
        <LibraryIcon size={24} /> Library
      </Link>
      <Link href="/settings" className={cls(pathname === '/settings' || pathname === '/stats')}>
        {me ? (
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold text-black"
            style={{ backgroundColor: me.color }}
          >
            {me.name.charAt(0).toUpperCase()}
          </span>
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-highlight text-xs">?</span>
        )}
        You
      </Link>
    </nav>
  );
}
