import { NextRequest, NextResponse } from 'next/server';
import { countryChart, genreTrending, COUNTRIES } from '@/lib/trending';
import { userIdFrom } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const country = req.nextUrl.searchParams.get('country') ?? 'ww';
  const [chart, genres] = await Promise.all([countryChart(country), genreTrending(userIdFrom(req))]);
  return NextResponse.json({ country, countries: COUNTRIES, chart, ...genres });
}
