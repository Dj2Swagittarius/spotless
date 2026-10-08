import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { scanStatus } from '@/lib/scanner';
import pkg from '../../../../package.json';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// Liveness/readiness probe for Docker HEALTHCHECK and uptime monitors. Public (listed in the
// proxy's PUBLIC_API) and deliberately free of anything user- or path-specific.
// The probe must stay constant-time: it is unauthenticated and unthrottled, and better-sqlite3 is
// synchronous, so anything that walks the database (e.g. PRAGMA quick_check, which reads every
// page) would let any client stall playback for everyone just by polling this URL. Integrity is
// verified on the nightly backup copy instead (src/lib/backup.ts).
export async function GET() {
  try {
    const row = getDb().prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
    if (row?.ok !== 1) throw new Error('database query returned no row');
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
