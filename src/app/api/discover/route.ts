import { NextResponse } from 'next/server';
import { buildDiscover } from '@/lib/discover';
import { userIdFrom } from '@/lib/user';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const force = new URL(req.url).searchParams.get('refresh') === '1';
  const result = await buildDiscover(userIdFrom(req), force);
  return NextResponse.json(result);
}
