import fs from 'fs';
import path from 'path';
import { getDb } from './db';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP = 7;

export async function backupDb(): Promise<string> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const dest = path.join(BACKUP_DIR, `library-${stamp}.db`);
  await getDb().backup(dest);

  // prune old backups
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => /^library-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .reverse();
  for (const f of files.slice(KEEP)) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
    } catch {
      // ignore
    }
  }
  console.log(`backup: wrote ${dest}, keeping ${Math.min(files.length, KEEP)}`);
  return dest;
}

let scheduled = false;

/** Backup on startup (if none today) and then every 24h. */
export function scheduleBackups(): void {
  if (scheduled) return;
  scheduled = true;
  const today = path.join(BACKUP_DIR, `library-${new Date().toISOString().slice(0, 10)}.db`);
  if (!fs.existsSync(today)) backupDb().catch((err) => console.error('backup failed:', err));
  setInterval(() => backupDb().catch((err) => console.error('backup failed:', err)), 24 * 60 * 60 * 1000);
}
