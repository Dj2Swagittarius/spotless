import { NextResponse } from 'next/server';
import { getAlbum } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const album = getAlbum(Number(id));
  if (!album) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(album);
}
