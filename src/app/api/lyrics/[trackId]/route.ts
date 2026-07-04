import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Lyrics via lrclib.net (free, no key). Cached per track; misses cached too
// so we don't hammer the API for songs it doesn't know.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ trackId: string }> }) {
  const { trackId } = await params;
  const id = Number(trackId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  const db = getDb();
  const cached = db.prepare('SELECT synced, plain FROM lyrics WHERE track_id = ?').get(id) as
    | { synced: string | null; plain: string | null }
    | undefined;
  if (cached) return NextResponse.json(cached);

  const track = db
    .prepare(
      `SELECT t.title, t.duration, ar.name AS artist, al.name AS album
       FROM tracks t JOIN artists ar ON ar.id = t.artist_id JOIN albums al ON al.id = t.album_id
       WHERE t.id = ?`
    )
    .get(id) as { title: string; duration: number; artist: string; album: string } | undefined;
  if (!track) return NextResponse.json({ error: 'track not found' }, { status: 404 });

  let synced: string | null = null;
  let plain: string | null = null;
  try {
    const qs = new URLSearchParams({
      artist_name: track.artist,
      track_name: track.title,
      album_name: track.album,
      duration: String(Math.round(track.duration)),
    });
    let res = await fetch(`https://lrclib.net/api/get?${qs}`, { signal: AbortSignal.timeout(10000) });
    if (res.status === 404) {
      // retry without album/duration constraints
      const loose = new URLSearchParams({ artist_name: track.artist, track_name: track.title });
      res = await fetch(`https://lrclib.net/api/get?${loose}`, { signal: AbortSignal.timeout(10000) });
    }
    if (res.ok) {
      const data = await res.json();
      synced = data.syncedLyrics || null;
      plain = data.plainLyrics || null;
    }
  } catch {
    // network failure: return miss but don't cache it
    return NextResponse.json({ synced: null, plain: null });
  }

  db.prepare('INSERT OR REPLACE INTO lyrics (track_id, synced, plain) VALUES (?, ?, ?)').run(id, synced, plain);
  return NextResponse.json({ synced, plain });
}
