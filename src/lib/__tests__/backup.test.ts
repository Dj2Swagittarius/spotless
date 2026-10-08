import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Both DATA_DIR and BACKUP_DIR are resolved when the modules load.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotless-backup-'));
const backupDir = path.join(dataDir, 'custom-backups');
process.env.DATA_DIR = dataDir;
process.env.BACKUP_DIR = backupDir;
process.env.LOG_LEVEL = 'error';

type Backup = typeof import('@/lib/backup');
type Db = typeof import('@/lib/db');
let backup: Backup;
let db: Db;

beforeAll(async () => {
  backup = await import('@/lib/backup');
  db = await import('@/lib/db');
  db.getDb().prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('probe', 'present');
});

afterAll(() => {
  db.getDb().close();
  delete process.env.BACKUP_DIR;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('backupDb', () => {
  it('honours BACKUP_DIR and leaves no temp file behind', async () => {
    const dest = await backup.backupDb();
    expect(backup.backupDir()).toBe(backupDir);
    expect(path.dirname(dest)).toBe(backupDir);
    expect(path.basename(dest)).toMatch(/^library-\d{4}-\d{2}-\d{2}\.db$/);
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.existsSync(`${dest}.tmp`)).toBe(false);
    // The read-only verification pass must not leave journal files next to the backup.
    expect(fs.readdirSync(backupDir).filter((f) => /\.tmp|-wal$|-shm$/.test(f))).toEqual([]);
  });

  it('writes a consistent copy that contains the live data', async () => {
    const dest = await backup.backupDb();
    const copy = new Database(dest, { readonly: true });
    try {
      expect(copy.pragma('quick_check')).toEqual([{ quick_check: 'ok' }]);
      const row = copy.prepare('SELECT value FROM settings WHERE key = ?').get('probe') as { value: string };
      expect(row.value).toBe('present');
    } finally {
      copy.close();
    }
  });

  it('keeps at most 7 dated backups, dropping the oldest', async () => {
    for (let i = 1; i <= 9; i++) {
      fs.writeFileSync(path.join(backupDir, `library-2000-01-0${i}.db`), '');
    }
    await backup.backupDb();
    const kept = fs.readdirSync(backupDir).filter((f) => /^library-\d{4}-\d{2}-\d{2}\.db$/.test(f));
    expect(kept).toHaveLength(7);
    expect(kept).not.toContain('library-2000-01-01.db');
    expect(kept).not.toContain('library-2000-01-02.db');
    expect(kept).toContain('library-2000-01-09.db');
  });
});
