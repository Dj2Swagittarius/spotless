import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolvePlaceholders } from '@/lib/playlistMatch';

export const dynamic = 'force-dynamic';

// Re-check this playlist's placeholders against the library (e.g. after a download landed).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const resolved = resolvePlaceholders(getDb(), Number(id));
  return NextResponse.json({ ok: true, resolved });
}
