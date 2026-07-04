import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function dz<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`https://api.deezer.com${path}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Search Deezer for things NOT in the library — suggestions to acquire.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!q) return NextResponse.json({ artists: [], albums: [], tracks: [] });

  const db = getDb();
  const libArtists = new Set(
    (db.prepare('SELECT name FROM artists').all() as { name: string }[]).map((r) => norm(r.name))
  );
  const libAlbums = new Set(
    (db.prepare('SELECT al.name AS album, ar.name AS artist FROM albums al JOIN artists ar ON ar.id = al.artist_id').all() as {
      album: string;
      artist: string;
    }[]).map((r) => `${norm(r.artist)}|${norm(r.album)}`)
  );
  const libTracks = new Set(
    (db.prepare('SELECT t.title, ar.name AS artist FROM tracks t JOIN artists ar ON ar.id = t.artist_id').all() as {
      title: string;
      artist: string;
    }[]).map((r) => `${norm(r.artist)}|${norm(r.title)}`)
  );

  const enc = encodeURIComponent(q);
  const [artists, albums, tracks] = await Promise.all([
    dz<{ data: { name: string; picture_medium: string | null; nb_fan: number; link: string }[] }>(`/search/artist?q=${enc}&limit=6`),
    dz<{ data: { title: string; cover_medium: string | null; link: string; artist: { name: string } }[] }>(`/search/album?q=${enc}&limit=8`),
    dz<{ data: { title: string; preview: string | null; link: string; artist: { name: string }; album: { title: string; cover_medium: string | null } }[] }>(
      `/search/track?q=${enc}&limit=10`
    ),
  ]);

  return NextResponse.json({
    artists: (artists?.data ?? [])
      .filter((a) => !libArtists.has(norm(a.name)))
      .map((a) => ({ name: a.name, image: a.picture_medium, fans: a.nb_fan, deezerUrl: a.link })),
    albums: (albums?.data ?? [])
      .filter((al) => !libAlbums.has(`${norm(al.artist.name)}|${norm(al.title)}`))
      .map((al) => ({ title: al.title, artist: al.artist.name, cover: al.cover_medium, deezerUrl: al.link })),
    tracks: (tracks?.data ?? [])
      .filter((t) => !libTracks.has(`${norm(t.artist.name)}|${norm(t.title)}`))
      .map((t) => ({
        title: t.title,
        artist: t.artist.name,
        album: t.album.title,
        cover: t.album.cover_medium,
        previewUrl: t.preview || null,
        deezerUrl: t.link,
      })),
  });
}
