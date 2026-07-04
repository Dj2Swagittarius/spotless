import { NextResponse } from 'next/server';
import { getQueue } from '@/lib/lidarr';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ items: await getQueue() });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
