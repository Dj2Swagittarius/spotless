import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

// Next.js dev HMR re-evaluates this module and would open a fresh connection each
// time; a globalThis slot keeps one connection per process, like the other modules.
const dbGlobal = globalThis as typeof globalThis & {
  __spotlessDb?: Database.Database;
};

export function getDb(): Database.Database {
  if (dbGlobal.__spotlessDb) return dbGlobal.__spotlessDb;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'art'), { recursive: true });
  const db = new Database(path.join(DATA_DIR, 'library.db'));
  try {
    initSchema(db);
  } catch (err) {
    // never cache a half-initialised connection; the next call retries from scratch
    db.close();
    throw err;
  }
  dbGlobal.__spotlessDb = db;
  return db;
}

function initSchema(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  // WAL + NORMAL only loses the last transactions on power failure, never corrupts;
  // it avoids an fsync per autocommit during scans
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
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
  // web authentication: hashes only, never plaintext web passwords
  if (!hasColumn(db, 'users', 'password_hash')) db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS auth_login_attempts (
      key TEXT PRIMARY KEY,
      failures INTEGER NOT NULL DEFAULT 0,
      window_started_at INTEGER NOT NULL,
      blocked_until INTEGER NOT NULL DEFAULT 0
    );
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
    -- songs a playlist wants but the library lacks (Spotify import); share the
    -- position space with playlist_tracks, invisible to Subsonic clients
    CREATE TABLE IF NOT EXISTS playlist_placeholders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL DEFAULT '',
      duration REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_placeholders_playlist ON playlist_placeholders(playlist_id);
  `);
  ensureIndexes(db);
  const now = Math.floor(Date.now() / 1000);
  db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now);
  db.prepare('DELETE FROM auth_login_attempts WHERE window_started_at < ?').run(now - 86400);
}

/**
 * Indexes for the hot read paths (artist/album pages, per-user history, likes,
 * playlist membership, genre and case-insensitive title/album lookups). They run
 * after every migration so the columns exist; each one is still guarded so an
 * unexpected old schema degrades to "no index" instead of failing startup.
 */
function ensureIndexes(d: Database.Database): void {
  const indexes: { name: string; table: string; columns: string[]; expr: string }[] = [
    { name: 'idx_albums_artist', table: 'albums', columns: ['artist_id'], expr: 'artist_id' },
    { name: 'idx_albums_year', table: 'albums', columns: ['year'], expr: 'year' },
    { name: 'idx_albums_name_nocase', table: 'albums', columns: ['name'], expr: 'name COLLATE NOCASE' },
    { name: 'idx_history_user_played', table: 'history', columns: ['user_id', 'played_at'], expr: 'user_id, played_at' },
    { name: 'idx_history_track', table: 'history', columns: ['track_id'], expr: 'track_id' },
    { name: 'idx_tracks_genre', table: 'tracks', columns: ['genre'], expr: 'genre' },
    { name: 'idx_tracks_title_nocase', table: 'tracks', columns: ['title'], expr: 'title COLLATE NOCASE' },
    { name: 'idx_likes_track', table: 'likes', columns: ['track_id'], expr: 'track_id' },
    { name: 'idx_playlist_tracks_track', table: 'playlist_tracks', columns: ['track_id'], expr: 'track_id' },
  ];
  for (const ix of indexes) {
    if (!ix.columns.every((c) => hasColumn(d, ix.table, c))) continue;
    d.exec(`CREATE INDEX IF NOT EXISTS ${ix.name} ON ${ix.table}(${ix.expr})`);
  }
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
    // their first profile (= user 1 = admin) through the setup wizard
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
