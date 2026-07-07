import { NextRequest, NextResponse } from 'next/server';
import { setSetting, delSetting } from '@/lib/db';
import { testLastfmKeys } from '@/lib/lastfm';
import { requireAdmin } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json();
  const apiKey = String(body.apiKey ?? '').trim();
  const secret = String(body.secret ?? '').trim();
  if (!apiKey || !secret) return NextResponse.json({ error: 'API key and shared secret required' }, { status: 400 });
  try {
    await testLastfmKeys(apiKey, secret);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'validation failed' }, { status: 400 });
  }
  setSetting('lastfm_api_key', apiKey);
  setSetting('lastfm_api_secret', secret);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  delSetting('lastfm_api_key');
  delSetting('lastfm_api_secret');
  return NextResponse.json({ ok: true });
}
