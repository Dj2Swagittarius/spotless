import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// DATA_DIR is resolved when the db module loads.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotless-newdl-'));
process.env.DATA_DIR = dataDir;
process.env.LOG_LEVEL = 'error';

type Db = typeof import('@/lib/db');
type Data = typeof import('@/lib/data');
let db: Db;
let data: Data;

const NOW = 1_800_000_000;
const DAY = 86400;

beforeAll(async () => {
  // a library from before tracks.added_at existed: one song with a known file mtime
  const legacy = new Database(path.join(dataDir, 'library.db'));
  legacy.exec(`
    CREATE TABLE artists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
    CREATE TABLE albums (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, artist_id INTEGER NOT NULL,
      year INTEGER, has_art INTEGER NOT NULL DEFAULT 0, UNIQUE(name, artist_id));
    CREATE TABLE tracks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, album_id INTEGER NOT NULL,
      artist_id INTEGER NOT NULL, duration REAL NOT NULL DEFAULT 0, track_no INTEGER NOT NULL DEFAULT 0,
      disc_no INTEGER NOT NULL DEFAULT 1, genre TEXT, path TEXT NOT NULL UNIQUE, mtime INTEGER NOT NULL DEFAULT 0);
    INSERT INTO artists (id, name) VALUES (1, 'Old Artist');
    INSERT INTO albums (id, name, artist_id) VALUES (1, 'Old Album', 1);
  `);
  legacy
    .prepare('INSERT INTO tracks (title, album_id, artist_id, path, mtime) VALUES (?, 1, 1, ?, ?)')
    .run('Legacy', '/m/legacy.flac', (NOW - 90 * DAY) * 1000);
  legacy.close();

  db = await import('@/lib/db');
  data = await import('@/lib/data');
});

afterAll(() => {
  db.getDb().close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const addTrack = (albumId: number, title: string, addedAt: number) =>
  db
    .getDb()
    .prepare('INSERT INTO tracks (title, album_id, artist_id, path, mtime, added_at) VALUES (?, ?, 1, ?, 0, ?)')
    .run(title, albumId, `/m/${albumId}/${title}.flac`, addedAt);

describe('tracks.added_at migration', () => {
  it('backfills rows that predate the column from their file mtime', () => {
    const row = db.getDb().prepare("SELECT added_at FROM tracks WHERE path = '/m/legacy.flac'").get() as {
      added_at: number;
    };
    expect(row.added_at).toBe(NOW - 90 * DAY);
  });
});

describe('getNewDownloads', () => {
  beforeAll(() => {
    const d = db.getDb();
    d.exec(`
      INSERT INTO albums (id, name, artist_id) VALUES (2, 'Fresh Album', 1);
      INSERT INTO albums (id, name, artist_id) VALUES (3, 'Last Week', 1);
    `);
    addTrack(2, 'a', NOW - 60);
    addTrack(2, 'b', NOW - 60);
    addTrack(3, 'c', NOW - 5 * DAY);
    // an old album that just gained one bonus track
    addTrack(1, 'Bonus', NOW - 2 * DAY);
  });

  it('lists albums that gained songs inside the window, newest first', () => {
    const ids = data.getNewDownloads(NOW).map((a) => a.id);
    expect(ids).toEqual([2, 1, 3]);
  });

  it('counts only the songs that are new, not the whole album', () => {
    const byId = new Map(data.getNewDownloads(NOW).map((a) => [a.id, a]));
    expect(byId.get(1)).toMatchObject({ trackCount: 2, newTracks: 1, addedAt: NOW - 2 * DAY });
    expect(byId.get(2)).toMatchObject({ trackCount: 2, newTracks: 2, addedAt: NOW - 60 });
  });

  it('drops albums whose newest song is older than the window', () => {
    expect(data.getNewDownloads(NOW + 40 * DAY)).toEqual([]);
  });
});
