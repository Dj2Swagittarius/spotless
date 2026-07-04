import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/user';

export const dynamic = 'force-dynamic';

// Report duplicate tracks: same artist + title (normalized), 2+ files.
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.title, t.path, t.duration, ar.name AS artist
       FROM tracks t JOIN artists ar ON ar.id = t.artist_id`
    )
    .all() as { id: number; title: string; path: string; duration: number; artist: string }[];

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${norm(r.artist)}|${norm(r.title)}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const rank = (p: string) => {
    const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
    return ext === 'flac' ? 3 : ext === 'wav' ? 2 : 1; // higher = keep
  };

  const dupes = [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      const sorted = g.slice().sort((a, b) => rank(b.path) - rank(a.path));
      return {
        artist: g[0].artist,
        title: g[0].title,
        keep: sorted[0].path,
        remove: sorted.slice(1).map((r) => r.path),
      };
    })
    .sort((a, b) => a.artist.localeCompare(b.artist));

  return NextResponse.json({ count: dupes.length, dupes });
}
