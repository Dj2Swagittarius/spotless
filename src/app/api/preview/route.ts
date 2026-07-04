import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Deezer preview URLs are signed and expire within hours, so cached ones go
// stale. This fetches a fresh 30s preview URL on demand.
export async function GET(req: NextRequest) {
  const artist = req.nextUrl.searchParams.get('artist')?.trim() ?? '';
  const title = req.nextUrl.searchParams.get('title')?.trim() ?? '';
  if (!artist || !title) return NextResponse.json({ error: 'artist and title required' }, { status: 400 });

  try {
    const q = encodeURIComponent(`artist:"${artist}" track:"${title}"`);
    let res = await fetch(`https://api.deezer.com/search/track?q=${q}&limit=1`, { signal: AbortSignal.timeout(8000) });
    let data = res.ok ? await res.json() : null;
    if (!data?.data?.length) {
      // loose fallback
      const loose = encodeURIComponent(`${artist} ${title}`);
      res = await fetch(`https://api.deezer.com/search/track?q=${loose}&limit=1`, { signal: AbortSignal.timeout(8000) });
      data = res.ok ? await res.json() : null;
    }
    const url = data?.data?.[0]?.preview || null;
    return NextResponse.json({ previewUrl: url });
  } catch {
    return NextResponse.json({ previewUrl: null });
  }
}
