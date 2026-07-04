import { NextResponse } from 'next/server';
import { getArtist } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const artist = getArtist(Number(id));
  if (!artist) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(artist);
}
