import { NextRequest, NextResponse } from 'next/server';
import { buildReleases } from '@/lib/releases';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get('refresh') === '1';
  return NextResponse.json(await buildReleases(force));
}
