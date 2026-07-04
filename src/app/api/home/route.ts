import { NextRequest, NextResponse } from 'next/server';
import { getHome } from '@/lib/data';
import { userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return NextResponse.json(getHome(userIdFrom(req)));
}
