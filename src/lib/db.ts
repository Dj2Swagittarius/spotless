import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'art'), { recursive: true });
  db = new Database(path.join(DATA_DIR, 'library.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS artists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      artist_id INTEGER NOT NULL REFERENCES artists(id),
      year INTEGER,
      has_art INTEGER NOT NULL DEFAULT 0,
      UNIQUE(name, artist_id)
    );
    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      album_id INTEGER NOT NULL REFERENCES albums(id),
      artist_id INTEGER NOT NULL REFERENCES artists(id),
      duration REAL NOT NULL DEFAULT 0,
      track_no INTEGER NOT NULL DEFAULT 0,
      disc_no INTEGER NOT NULL DEFAULT 1,
      genre TEXT,
      path TEXT NOT NULL UNIQUE,
      mtime INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, track_id)
    );
    CREATE TABLE IF NOT EXISTS likes (
      track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
      liked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      played_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS discover_dislikes (
      name TEXT PRIMARY KEY COLLATE NOCASE,
      disliked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS lyrics (
      track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
      synced TEXT,
      plain TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist_id);
    CREATE INDEX IF NOT EXISTS idx_history_track ON history(track_id);
    CREATE INDEX IF NOT EXISTS idx_history_played ON history(played_at);
  `);
  migrateMultiUser(db);
  if (!hasColumn(db, 'tracks', 'gain')) db.exec('ALTER TABLE tracks ADD COLUMN gain REAL');
  // per-profile credential for Subsonic mobile clients (generated on demand)
  if (!hasColumn(db, 'users', 'app_password')) db.exec('ALTER TABLE users ADD COLUMN app_password TEXT');
  db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      user_id INTEGER NOT NULL,
      artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, artist_id)
    );
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS radio_stations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      stream_url TEXT NOT NULL,
      home_page_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

const hasColumn = (d: Database.Database, table: string, col: string) =>
  (d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);

/** One-time migration to per-user data. Existing likes/history/playlists move to user 1. */
function migrateMultiUser(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#1ed760',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  if (hasColumn(d, 'history', 'user_id')) return; // already migrated

  const migrate = d.transaction(() => {
    // only pre-existing single-user data needs an owner; fresh installs create
    // their first profile (= user 1 = admin) through the Who's-listening picker
    const legacy =
      (d.prepare('SELECT COUNT(*) AS n FROM history').get() as { n: number }).n > 0 ||
      (d.prepare('SELECT COUNT(*) AS n FROM likes').get() as { n: number }).n > 0 ||
      (d.prepare('SELECT COUNT(*) AS n FROM playlists').get() as { n: number }).n > 0;
    if (legacy) d.prepare("INSERT OR IGNORE INTO users (id, name, color) VALUES (1, 'Me', '#1ed760')").run();

    d.exec('ALTER TABLE history ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1');
    d.exec('ALTER TABLE playlists ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1');

    // likes: PK becomes (user_id, track_id)
    d.exec(`
      CREATE TABLE likes_new (
        user_id INTEGER NOT NULL DEFAULT 1,
        track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        liked_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, track_id)
      );
      INSERT INTO likes_new (user_id, track_id, liked_at) SELECT 1, track_id, liked_at FROM likes;
      DROP TABLE likes;
      ALTER TABLE likes_new RENAME TO likes;
    `);

    // dislikes: PK becomes (user_id, name)
    d.exec(`
      CREATE TABLE discover_dislikes_new (
        user_id INTEGER NOT NULL DEFAULT 1,
        name TEXT NOT NULL COLLATE NOCASE,
        disliked_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, name)
      );
      INSERT INTO discover_dislikes_new (user_id, name, disliked_at) SELECT 1, name, disliked_at FROM discover_dislikes;
      DROP TABLE discover_dislikes;
      ALTER TABLE discover_dislikes_new RENAME TO discover_dislikes;
    `);

    // per-user settings keys
    for (const key of ['spotify_tokens', 'spotify_taste', 'discover_cache']) {
      d.prepare('UPDATE OR IGNORE settings SET key = ? WHERE key = ?').run(`${key}:1`, key);
    }
  });
  migrate();
  console.log('db: migrated to multi-user (existing data -> user 1)');
}

export function artDir(): string {
  return path.join(DATA_DIR, 'art');
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

export function delSetting(key: string): void {
  getDb().prepare('DELETE FROM settings WHERE key = ?').run(key);
}
