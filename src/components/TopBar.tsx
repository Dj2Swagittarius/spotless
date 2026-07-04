'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { SearchIcon, HomeIcon, GearIcon } from './Icons';
import { Logo } from './Logo';

interface User {
  id: number;
  name: string;
  color: string;
}

export default function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState('');
  const [me, setMe] = useState<User | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (pathname !== '/search') setQ('');
  }, [pathname]);

  useEffect(() => {
    fetch('/api/users').then((r) => r.json()).then((d) => setMe(d.current)).catch(() => {});
  }, []);

  // close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const onChange = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (v.trim()) router.push(`/search?q=${encodeURIComponent(v.trim())}`);
    }, 300);
  };

  const switchUser = async () => {
    await fetch('/api/users/select', { method: 'DELETE' });
    location.reload();
  };

  return (
    <div className="hidden items-center gap-3 px-4 pt-2 md:flex">
      {/* brand */}
      <Link href="/" className="w-56 shrink-0">
        <Logo />
      </Link>

      {/* center: home + search */}
      <div className="flex flex-1 items-center justify-center gap-2">
        <Link
          href="/"
          aria-label="Home"
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-highlight transition-colors hover:bg-press ${pathname === '/' ? 'text-white' : 'text-subdued hover:text-white'}`}
        >
          <HomeIcon size={22} />
        </Link>
        <div className="relative w-full max-w-md">
          <SearchIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-subdued" />
          <input
            type="search"
            aria-label="Search music"
            value={q}
            onChange={(e) => onChange(e.target.value)}
            placeholder="What do you want to play?"
            className="w-full rounded-full bg-highlight py-2.5 pl-11 pr-4 text-sm font-medium placeholder-subdued outline-none focus:shadow-insetBorder"
          />
        </div>
      </div>

      {/* right: profile */}
      <div className="relative flex w-56 shrink-0 items-center justify-end" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Profile menu"
          aria-expanded={menuOpen}
          className="flex h-10 w-10 items-center justify-center rounded-full text-lg font-extrabold text-black transition-transform hover:scale-105"
          style={{ backgroundColor: me?.color ?? '#4d4d4d' }}
          title={me?.name ?? 'Profile'}
        >
          {me ? me.name.charAt(0).toUpperCase() : '?'}
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-12 z-50 w-56 rounded-lg bg-card p-1 shadow-dialog">
            <div className="flex items-center gap-3 px-3 py-2.5">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full text-base font-extrabold text-black"
                style={{ backgroundColor: me?.color ?? '#4d4d4d' }}
              >
                {me ? me.name.charAt(0).toUpperCase() : '?'}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{me?.name ?? 'No profile'}</div>
                <div className="text-xs text-subdued">Profile</div>
              </div>
            </div>
            <div className="mx-2 my-1 border-t border-border/40" />
            <Link
              href="/settings"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 rounded px-3 py-2 text-sm hover:bg-highlight"
            >
              <GearIcon size={16} /> Settings
            </Link>
            <button
              onClick={switchUser}
              className="flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm hover:bg-highlight"
            >
              <span className="inline-block w-4 text-center">⇄</span> Switch user
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
