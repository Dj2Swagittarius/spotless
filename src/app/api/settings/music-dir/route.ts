import { NextRequest, NextResponse } from 'next/server';
import { getMusicDir, setMusicDir } from '@/lib/scanner';
import { isAdmin, requireAdmin } from '@/lib/user';

export const dynamic = 'force-dynamic';

// The absolute server path is only shown to the admin profile, which is the only one that can change it.
export async function GET(req: NextRequest) {
  return NextResponse.json({ dir: isAdmin(req) ? getMusicDir() : null });
}

export async function PUT(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const dir = typeof body.dir === 'string' ? body.dir.trim() : '';
  if (!dir) return NextResponse.json({ error: 'dir is required' }, { status: 400 });
  try {
    setMusicDir(dir);
  } catch {
    return NextResponse.json({ error: `Folder not found or not a directory: ${dir}` }, { status: 400 });
  }
  return NextResponse.json({ dir: getMusicDir() });
}
