import { NextResponse } from 'next/server';
import { getNewDownloads } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getNewDownloads());
}
