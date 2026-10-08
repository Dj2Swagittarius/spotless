import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { scanStatus } from '@/lib/scanner';
import pkg from '../../../../package.json';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// Liveness/readiness probe for Docker HEALTHCHECK and uptime monitors. Public (listed in the
// proxy's PUBLIC_API) and deliberately free of anything user- or path-specific.
export async function GET() {
  try {
    const rows = getDb().pragma('quick_check') as { quick_check: string }[];
    const verdict = rows[0]?.quick_check;
    if (verdict !== 'ok') throw new Error(`quick_check reported: ${verdict ?? 'no result'}`);
  } catch (err) {
    console.error('health check failed:', err);
    return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
  }

  const scan = scanStatus();
  return NextResponse.json(
    { ok: true, scanning: scan.scanning, lastScanAt: scan.lastScan?.at ?? null, version: pkg.version },
    { headers: NO_STORE }
  );
}
