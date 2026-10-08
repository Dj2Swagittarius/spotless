import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { getDb } from './db';
import { createLogger } from './log';

const log = createLogger('backup');

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
// BACKUP_DIR lets backups land on a different disk/mount than the live database.
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
const KEEP = 7;

/** Where backups are written (resolved once at startup from BACKUP_DIR / DATA_DIR). */
export function backupDir(): string {
  return BACKUP_DIR;
}

/**
 * Open the freshly written copy read-only and run PRAGMA quick_check. A backup that fails
 * here is worse than no backup, because a restore would silently bring back corruption.
 */
function verifyBackupFile(file: string): boolean {
  let copy: Database.Database | null = null;
  try {
    copy = new Database(file, { readonly: true, fileMustExist: true });
    const rows = copy.pragma('quick_check') as { quick_check: string }[];
    return rows.length === 1 && rows[0]?.quick_check === 'ok';
  } catch (err) {
    log.error(`could not verify ${file}:`, err);
    return false;
  } finally {
    copy?.close();
    // The copy inherits WAL mode from the live DB, and a read-only connection cannot checkpoint,
    // so SQLite leaves an empty -wal and a -shm beside it on close. Nothing in them is needed.
    removeQuietly(`${file}-wal`);
    removeQuietly(`${file}-shm`);
  }
}

function removeQuietly(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    // already gone, or not ours to remove
  }
}

export async function backupDb(): Promise<string> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const dest = path.join(BACKUP_DIR, `library-${stamp}.db`);
  // Write to a temp name and rename at the end so a crash mid-copy never leaves a
  // truncated file under the final name that the retention logic would count as good.
  const tmp = `${dest}.tmp`;
  removeQuietly(tmp);
  try {
    await getDb().backup(tmp);
    if (!verifyBackupFile(tmp)) throw new Error(`integrity check failed for ${tmp}`);
    fs.renameSync(tmp, dest);
  } catch (err) {
    removeQuietly(tmp);
    throw err;
  }

  // prune old backups
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => /^library-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .reverse();
  for (const f of files.slice(KEEP)) removeQuietly(path.join(BACKUP_DIR, f));
  log.info(`wrote ${dest}, keeping ${Math.min(files.length, KEEP)}`);
  return dest;
}

let scheduled = false;

/** Backup on startup (if none today) and then every 24h. */
export function scheduleBackups(): void {
  if (scheduled) return;
  scheduled = true;
  const today = path.join(BACKUP_DIR, `library-${new Date().toISOString().slice(0, 10)}.db`);
  if (!fs.existsSync(today)) backupDb().catch((err) => log.error('backup failed:', err));
  setInterval(() => backupDb().catch((err) => log.error('backup failed:', err)), 24 * 60 * 60 * 1000);
}
