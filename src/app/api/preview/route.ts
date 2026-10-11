import { NextRequest, NextResponse } from 'next/server';
import { deezerRequest } from '@/lib/deezer';

export const dynamic = 'force-dynamic';

// Deezer preview URLs are signed and expire within hours, so cached ones go
// stale. This fetches a fresh 30s preview URL on demand.
export async function GET(req: NextRequest) {
  const artist = req.nextUrl.searchParams.get('artist')?.trim() ?? '';
  const title = req.nextUrl.searchParams.get('title')?.trim() ?? '';
  if (!artist || !title) return NextResponse.json({ error: 'artist and title required' }, { status: 400 });

  type Hits = { data?: { preview?: string | null }[] };
  const q = encodeURIComponent(`artist:"${artist}" track:"${title}"`);
  let res = await deezerRequest<Hits>(`/search/track?q=${q}&limit=1`, 8000);
  if (res.ok && !res.data?.data?.length) {
    // loose fallback
    const loose = encodeURIComponent(`${artist} ${title}`);
    res = await deezerRequest<Hits>(`/search/track?q=${loose}&limit=1`, 8000);
  }
  // timeout, network failure or Deezer error: an upstream problem, not "no preview"
  if (!res.ok) return NextResponse.json({ error: 'preview lookup failed' }, { status: 502 });
  return NextResponse.json({ previewUrl: res.data?.data?.[0]?.preview || null });
}
