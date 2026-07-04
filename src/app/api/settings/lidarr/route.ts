import { NextRequest, NextResponse } from 'next/server';
import { getLidarrConfig, saveLidarrConfig, clearLidarrConfig, testLidarr } from '@/lib/lidarr';
import { requireAdmin } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cfg = getLidarrConfig();
  return NextResponse.json({ configured: cfg !== null, url: cfg?.url ?? null });
}

export async function PUT(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const url = String(body.url ?? '').trim().replace(/\/+$/, '');
  const apiKey = String(body.apiKey ?? '').trim();
  if (!/^https?:\/\//.test(url) || !apiKey) {
    return NextResponse.json({ error: 'URL (with http://) and API key are required' }, { status: 400 });
  }
  try {
    const { version } = await testLidarr(url, apiKey);
    saveLidarrConfig(url, apiKey);
    return NextResponse.json({ configured: true, url, version });
  } catch (err) {
    return NextResponse.json({ error: `Connection failed: ${String(err).slice(0, 300)}` }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  clearLidarrConfig();
  return NextResponse.json({ configured: false });
}
