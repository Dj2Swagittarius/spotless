import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getMusicDir } from '@/lib/scanner';
import { requireAdmin } from '@/lib/user';

export const dynamic = 'force-dynamic';

// Lists directories on the server so the user can pick a music folder.
// GET /api/browse            -> starts at the current music dir
// GET /api/browse?path=...   -> lists that directory
// GET /api/browse?path=:     -> lists Windows drive letters
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('path');

  if (raw === ':') {
    const drives: string[] = [];
    for (let i = 65; i <= 90; i++) {
      const root = `${String.fromCharCode(i)}:\\`;
      try {
        fs.readdirSync(root);
        drives.push(root);
      } catch {
        // drive absent or unreadable
      }
    }
    return NextResponse.json({ path: ':', parent: null, dirs: drives });
  }

  const target = path.resolve(raw || getMusicDir());
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch {
    return NextResponse.json({ error: `Cannot read folder: ${target}` }, { status: 400 });
  }

  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  const parentPath = path.dirname(target);
  // at a filesystem root, offer the drive list on Windows, nothing on POSIX
  const atRoot = parentPath === target;
  const parent = atRoot ? (process.platform === 'win32' ? ':' : null) : parentPath;

  return NextResponse.json({ path: target, parent, dirs });
}
