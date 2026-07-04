import { NextResponse } from 'next/server';
import { getAlbums } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getAlbums());
}
