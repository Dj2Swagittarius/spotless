import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { getDb, artDir } from '@/lib/db';
import { scanLibrary, scanStatus } from '@/lib/scanner';
import { serveTrack } from '@/lib/streaming';
import { ADMIN_USER_ID } from '@/lib/user';
import {
  authenticate,
  subsonicResponse,
  subsonicError,
  parseSid,
  artistSid,
  albumSid,
  trackSid,
  playlistSid,
  songJson,
  albumJson,
  artistJson,
  TRACK_SQL,
  ALBUM_SQL,
  type SubUser,
  type TrackRow,
  type AlbumRow,
  type ArtistRow,
} from '@/lib/subsonic';

export const dynamic = 'force-dynamic';

const IGNORED_ARTICLES = 'The El La Los Las Le Les';

type Ctx = { req: NextRequest; user: SubUser; q: URLSearchParams };

// ---------- helpers ----------

const db = () => getDb();

function tracksBy(where: string, params: Record<string, unknown>, uid: number, order = '', limit = ''): TrackRow[] {
  return db()
    .prepare(`${TRACK_SQL} WHERE ${where} ${order} ${limit}`)
    .all({ uid, ...params }) as TrackRow[];
}

function num(q: URLSearchParams, key: string, fallback: number, max = 500): number {
  const v = Number(q.get(key));
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(v, max);
}

function indexLetter(name: string): string {
  const stripped = name.replace(new RegExp(`^(${IGNORED_ARTICLES.split(' ').join('|')})\\s+`, 'i'), '');
  const ch = (stripped[0] ?? '#').toUpperCase();
  return /[A-Z]/.test(ch) ? ch : '#';
}

function allArtists(): ArtistRow[] {
  return db()
    .prepare(
      `SELECT ar.id, ar.name, COUNT(DISTINCT al.id) AS albumCount
       FROM artists ar LEFT JOIN albums al ON al.artist_id = ar.id
       GROUP BY ar.id ORDER BY ar.name COLLATE NOCASE`
    )
    .all() as ArtistRow[];
}

function artistIndexes() {
  const groups = new Map<string, ReturnType<typeof artistJson>[]>();
  for (const a of allArtists()) {
    const letter = indexLetter(a.name);
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter)!.push(artistJson(a));
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, artists]) => ({ name, artist: artists }));
}

function playlistJson(p: { id: number; name: string; created_at: string; owner: string; songCount: number; duration: number }) {
  return {
    id: playlistSid(p.id),
    name: p.name,
    songCount: p.songCount,
    duration: Math.round(p.duration),
    public: false,
    owner: p.owner,
    created: new Date(p.created_at + 'Z').toISOString(),
    changed: new Date(p.created_at + 'Z').toISOString(),
  };
}

const PLAYLIST_SQL = `
  SELECT p.id, p.name, p.created_at, u.name AS owner,
         COUNT(pt.track_id) AS songCount, COALESCE(SUM(t.duration), 0) AS duration
  FROM playlists p
  LEFT JOIN users u ON u.id = p.user_id
  LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
  LEFT JOIN tracks t ON t.id = pt.track_id
`;

function like(term: string): string {
  return `%${term.replace(/[%_]/g, ' ')}%`;
}

// ---------- media endpoints (non-envelope responses) ----------

async function streamTrack(ctx: Ctx, download = false): Promise<Response> {
  const sid = parseSid(ctx.q.get('id'));
  if (!sid || sid.kind !== 'track') return subsonicError(ctx.req, 70, 'song not found');
  const row = db().prepare('SELECT path FROM tracks WHERE id = ?').get(sid.id) as { path: string } | undefined;
  if (!row || !fs.existsSync(row.path)) return subsonicError(ctx.req, 70, 'song not found');
  return serveTrack(ctx.req, row.path, {
    format: ctx.q.get('format'),
    maxBitRate: Number(ctx.q.get('maxBitRate')) || 0,
    download,
  });
}

function coverArt(ctx: Ctx): Response {
  const sid = parseSid(ctx.q.get('id'));
  if (!sid) return subsonicError(ctx.req, 70, 'cover art not found');
  let file: string | null = null;
  if (sid.kind === 'album') file = path.join(artDir(), `${sid.id}.img`);
  else if (sid.kind === 'artist') file = path.join(artDir(), `artist-${sid.id}.img`);
  else if (sid.kind === 'track') {
    const row = db().prepare('SELECT album_id FROM tracks WHERE id = ?').get(sid.id) as { album_id: number } | undefined;
    if (row) file = path.join(artDir(), `${row.album_id}.img`);
  } else if (sid.kind === 'playlist') {
    const row = db()
      .prepare('SELECT t.album_id FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = ? ORDER BY pt.position LIMIT 1')
      .get(sid.id) as { album_id: number } | undefined;
    if (row) file = path.join(artDir(), `${row.album_id}.img`);
  }
  if (!file || !fs.existsSync(file)) return subsonicError(ctx.req, 70, 'cover art not found');
  const buf = fs.readFileSync(file);
  return new Response(new Uint8Array(buf), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
  });
}

// ---------- browsing / lists ----------

function albumList(ctx: CtxWithView): Response {
  const type = ctx.q.get('type') ?? 'alphabeticalByName';
  const size = num(ctx.q, 'size', 10);
  const offset = Number(ctx.q.get('offset')) || 0;
  let order = 'ORDER BY al.name COLLATE NOCASE';
  let where = '1=1';
  const params: Record<string, unknown> = {};
  if (type === 'random') order = 'ORDER BY RANDOM()';
  else if (type === 'newest') order = 'ORDER BY created DESC';
  else if (type === 'alphabeticalByArtist') order = 'ORDER BY artist COLLATE NOCASE, al.name COLLATE NOCASE';
  else if (type === 'recent')
    order = 'ORDER BY (SELECT MAX(h.played_at) FROM history h JOIN tracks ht ON ht.id = h.track_id WHERE ht.album_id = al.id) DESC';
  else if (type === 'frequent')
    order = 'ORDER BY (SELECT COUNT(*) FROM history h JOIN tracks ht ON ht.id = h.track_id WHERE ht.album_id = al.id) DESC';
  else if (type === 'byYear') {
    const from = Number(ctx.q.get('fromYear')) || 0;
    const to = Number(ctx.q.get('toYear')) || 3000;
    where = 'al.year BETWEEN @from AND @to';
    params.from = Math.min(from, to);
    params.to = Math.max(from, to);
    order = from <= to ? 'ORDER BY al.year' : 'ORDER BY al.year DESC';
  } else if (type === 'byGenre') {
    where = 'al.id IN (SELECT DISTINCT album_id FROM tracks WHERE genre = @genre)';
    params.genre = ctx.q.get('genre') ?? '';
  } else if (type === 'starred') {
    where = '0=1'; // no album-level stars in Spotless
  }
  const rows = db()
    .prepare(`${ALBUM_SQL} WHERE ${where} GROUP BY al.id ${order} LIMIT ${size} OFFSET ${offset}`)
    .all(params) as AlbumRow[];
  const key = ctx.view === 'getAlbumList' ? 'albumList' : 'albumList2';
  return subsonicResponse(ctx.req, { [key]: { album: rows.map(albumJson) } });
}

function search(ctx: CtxWithView): Response {
  const query = (ctx.q.get('query') ?? '').replace(/^"|"$/g, '').trim();
  const artistCount = num(ctx.q, 'artistCount', 20);
  const artistOffset = Number(ctx.q.get('artistOffset')) || 0;
  const albumCount = num(ctx.q, 'albumCount', 20);
  const albumOffset = Number(ctx.q.get('albumOffset')) || 0;
  const songCount = num(ctx.q, 'songCount', 20);
  const songOffset = Number(ctx.q.get('songOffset')) || 0;

  // empty query = full library listing (Symfonium and friends page through this for offline sync)
  const artistWhere = query ? 'WHERE ar.name LIKE @q' : '';
  const albumWhere = query ? 'WHERE (al.name LIKE @q OR ar.name LIKE @q)' : '';
  const songWhere = query ? 't.title LIKE @q OR ar.name LIKE @q OR al.name LIKE @q' : '1=1';
  const params = query ? { q: like(query) } : {};

  const artists = db()
    .prepare(
      `SELECT ar.id, ar.name, COUNT(DISTINCT al.id) AS albumCount
       FROM artists ar LEFT JOIN albums al ON al.artist_id = ar.id ${artistWhere}
       GROUP BY ar.id ORDER BY ar.name COLLATE NOCASE LIMIT ${artistCount} OFFSET ${artistOffset}`
    )
    .all(params) as ArtistRow[];
  const albums = db()
    .prepare(`${ALBUM_SQL} ${albumWhere} GROUP BY al.id ORDER BY al.name COLLATE NOCASE LIMIT ${albumCount} OFFSET ${albumOffset}`)
    .all(params) as AlbumRow[];
  const songs = tracksBy(songWhere, params, ctx.user.id, 'ORDER BY t.title COLLATE NOCASE', `LIMIT ${songCount} OFFSET ${songOffset}`);

  const key = ctx.view === 'search2' ? 'searchResult2' : 'searchResult3';
  return subsonicResponse(ctx.req, {
    [key]: { artist: artists.map(artistJson), album: albums.map(albumJson), song: songs.map(songJson) },
  });
}

// ---------- playlists ----------

function ownPlaylist(ctx: Ctx, sidParam: string): { id: number } | Response {
  const sid = parseSid(ctx.q.get(sidParam));
  if (!sid || sid.kind !== 'playlist') return subsonicError(ctx.req, 70, 'playlist not found');
  const row = db().prepare('SELECT id, user_id FROM playlists WHERE id = ?').get(sid.id) as
    | { id: number; user_id: number }
    | undefined;
  if (!row) return subsonicError(ctx.req, 70, 'playlist not found');
  if (row.user_id !== ctx.user.id) return subsonicError(ctx.req, 50, 'not your playlist');
  return { id: row.id };
}

function playlistWithSongs(ctx: Ctx, id: number): Response {
  const p = db().prepare(`${PLAYLIST_SQL} WHERE p.id = ? GROUP BY p.id`).get(id) as Parameters<typeof playlistJson>[0] | undefined;
  if (!p) return subsonicError(ctx.req, 70, 'playlist not found');
  const songs = db()
    .prepare(`${TRACK_SQL} JOIN playlist_tracks pt ON pt.track_id = t.id WHERE pt.playlist_id = @pl ORDER BY pt.position`)
    .all({ uid: ctx.user.id, pl: id }) as TrackRow[];
  return subsonicResponse(ctx.req, { playlist: { ...playlistJson(p), entry: songs.map(songJson) } });
}

// ---------- dispatcher ----------

type CtxWithView = Ctx & { view: string };

const HANDLERS: Record<string, (ctx: CtxWithView) => Response | Promise<Response>> = {
  ping: (ctx) => subsonicResponse(ctx.req),
  getLicense: (ctx) => subsonicResponse(ctx.req, { license: { valid: true } }),
  getOpenSubsonicExtensions: (ctx) => subsonicResponse(ctx.req, { openSubsonicExtensions: [] }),

  getMusicFolders: (ctx) =>
    subsonicResponse(ctx.req, { musicFolders: { musicFolder: [{ id: 1, name: 'Music' }] } }),

  getIndexes: (ctx) =>
    subsonicResponse(ctx.req, {
      indexes: { lastModified: Date.now(), ignoredArticles: IGNORED_ARTICLES, index: artistIndexes() },
    }),

  getArtists: (ctx) =>
    subsonicResponse(ctx.req, { artists: { ignoredArticles: IGNORED_ARTICLES, index: artistIndexes() } }),

  getArtist: (ctx) => {
    const sid = parseSid(ctx.q.get('id'));
    if (!sid || sid.kind !== 'artist') return subsonicError(ctx.req, 70, 'artist not found');
    const artist = db()
      .prepare(
        `SELECT ar.id, ar.name, COUNT(DISTINCT al.id) AS albumCount
         FROM artists ar LEFT JOIN albums al ON al.artist_id = ar.id WHERE ar.id = ? GROUP BY ar.id`
      )
      .get(sid.id) as ArtistRow | undefined;
    if (!artist) return subsonicError(ctx.req, 70, 'artist not found');
    const albums = db()
      .prepare(`${ALBUM_SQL} WHERE al.artist_id = ? GROUP BY al.id ORDER BY al.year DESC, al.name`)
      .all(sid.id) as AlbumRow[];
    return subsonicResponse(ctx.req, { artist: { ...artistJson(artist), album: albums.map(albumJson) } });
  },

  getAlbum: (ctx) => {
    const sid = parseSid(ctx.q.get('id'));
    if (!sid || sid.kind !== 'album') return subsonicError(ctx.req, 70, 'album not found');
    const album = db().prepare(`${ALBUM_SQL} WHERE al.id = ? GROUP BY al.id`).get(sid.id) as AlbumRow | undefined;
    if (!album) return subsonicError(ctx.req, 70, 'album not found');
    const songs = tracksBy('t.album_id = @al', { al: sid.id }, ctx.user.id, 'ORDER BY t.disc_no, t.track_no, t.title');
    return subsonicResponse(ctx.req, { album: { ...albumJson(album), song: songs.map(songJson) } });
  },

  getSong: (ctx) => {
    const sid = parseSid(ctx.q.get('id'));
    if (!sid || sid.kind !== 'track') return subsonicError(ctx.req, 70, 'song not found');
    const song = tracksBy('t.id = @id', { id: sid.id }, ctx.user.id)[0];
    if (!song) return subsonicError(ctx.req, 70, 'song not found');
    return subsonicResponse(ctx.req, { song: songJson(song) });
  },

  getGenres: (ctx) => {
    const rows = db()
      .prepare(
        `SELECT genre AS value, COUNT(*) AS songCount, COUNT(DISTINCT album_id) AS albumCount
         FROM tracks WHERE genre IS NOT NULL GROUP BY genre ORDER BY songCount DESC`
      )
      .all();
    return subsonicResponse(ctx.req, { genres: { genre: rows } });
  },

  getAlbumList: albumList,
  getAlbumList2: albumList,

  getRandomSongs: (ctx) => {
    const size = num(ctx.q, 'size', 10);
    const songs = tracksBy('1=1', {}, ctx.user.id, 'ORDER BY RANDOM()', `LIMIT ${size}`);
    return subsonicResponse(ctx.req, { randomSongs: { song: songs.map(songJson) } });
  },

  getSongsByGenre: (ctx) => {
    const size = num(ctx.q, 'count', 10);
    const offset = Number(ctx.q.get('offset')) || 0;
    const songs = tracksBy('t.genre = @g', { g: ctx.q.get('genre') ?? '' }, ctx.user.id, 'ORDER BY t.title', `LIMIT ${size} OFFSET ${offset}`);
    return subsonicResponse(ctx.req, { songsByGenre: { song: songs.map(songJson) } });
  },

  getStarred: (ctx) => {
    const songs = tracksBy('t.id IN (SELECT track_id FROM likes WHERE user_id = @uid)', {}, ctx.user.id, 'ORDER BY starred DESC');
    return subsonicResponse(ctx.req, { starred: { artist: [], album: [], song: songs.map(songJson) } });
  },

  getStarred2: (ctx) => {
    const songs = tracksBy('t.id IN (SELECT track_id FROM likes WHERE user_id = @uid)', {}, ctx.user.id, 'ORDER BY starred DESC');
    return subsonicResponse(ctx.req, { starred2: { artist: [], album: [], song: songs.map(songJson) } });
  },

  getTopSongs: (ctx) => {
    const artist = ctx.q.get('artist') ?? '';
    const count = num(ctx.q, 'count', 50);
    const songs = tracksBy('ar.name = @a COLLATE NOCASE', { a: artist }, ctx.user.id, 'ORDER BY playCount DESC, t.title', `LIMIT ${count}`);
    return subsonicResponse(ctx.req, { topSongs: { song: songs.map(songJson) } });
  },

  getArtistInfo: (ctx) => subsonicResponse(ctx.req, { artistInfo: { biography: {}, similarArtist: [] } }),
  getArtistInfo2: (ctx) => subsonicResponse(ctx.req, { artistInfo2: { biography: {}, similarArtist: [] } }),
  getAlbumInfo: (ctx) => subsonicResponse(ctx.req, { albumInfo: {} }),
  getAlbumInfo2: (ctx) => subsonicResponse(ctx.req, { albumInfo: {} }),

  search2: search,
  search3: search,

  stream: (ctx) => streamTrack(ctx),
  download: (ctx) => streamTrack(ctx, true),
  getCoverArt: coverArt,

  getLyrics: (ctx) => {
    const artist = ctx.q.get('artist') ?? '';
    const title = ctx.q.get('title') ?? '';
    const row = db()
      .prepare(
        `SELECT l.plain, l.synced FROM lyrics l JOIN tracks t ON t.id = l.track_id
         JOIN artists ar ON ar.id = t.artist_id
         WHERE t.title = ? COLLATE NOCASE AND ar.name = ? COLLATE NOCASE LIMIT 1`
      )
      .get(title, artist) as { plain: string | null; synced: string | null } | undefined;
    const text = row?.plain ?? row?.synced?.replace(/\[[\d:.]+\]/g, '').trim() ?? '';
    return subsonicResponse(ctx.req, { lyrics: { artist, title, value: text } });
  },

  scrobble: (ctx) => {
    const submission = ctx.q.get('submission') !== 'false';
    if (submission) {
      for (const raw of ctx.q.getAll('id')) {
        const sid = parseSid(raw);
        if (sid?.kind === 'track')
          db().prepare('INSERT INTO history (track_id, user_id) VALUES (?, ?)').run(sid.id, ctx.user.id);
      }
    }
    return subsonicResponse(ctx.req);
  },

  star: (ctx) => {
    for (const raw of ctx.q.getAll('id')) {
      const sid = parseSid(raw);
      if (sid?.kind === 'track')
        db().prepare('INSERT OR IGNORE INTO likes (user_id, track_id) VALUES (?, ?)').run(ctx.user.id, sid.id);
    }
    return subsonicResponse(ctx.req);
  },

  unstar: (ctx) => {
    for (const raw of ctx.q.getAll('id')) {
      const sid = parseSid(raw);
      if (sid?.kind === 'track')
        db().prepare('DELETE FROM likes WHERE user_id = ? AND track_id = ?').run(ctx.user.id, sid.id);
    }
    return subsonicResponse(ctx.req);
  },

  setRating: (ctx) => subsonicResponse(ctx.req),

  getPlaylists: (ctx) => {
    const rows = db()
      .prepare(`${PLAYLIST_SQL} WHERE p.user_id = ? GROUP BY p.id ORDER BY p.created_at DESC`)
      .all(ctx.user.id) as Parameters<typeof playlistJson>[0][];
    return subsonicResponse(ctx.req, { playlists: { playlist: rows.map(playlistJson) } });
  },

  getPlaylist: (ctx) => {
    const own = ownPlaylist(ctx, 'id');
    if (own instanceof Response) return own;
    return playlistWithSongs(ctx, own.id);
  },

  createPlaylist: (ctx) => {
    const existing = ctx.q.get('playlistId');
    let playlistId: number;
    if (existing) {
      const own = ownPlaylist(ctx, 'playlistId');
      if (own instanceof Response) return own;
      playlistId = own.id;
      db().prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlistId);
    } else {
      const name = ctx.q.get('name');
      if (!name) return subsonicError(ctx.req, 10, 'name required');
      playlistId = Number(
        db().prepare('INSERT INTO playlists (name, user_id) VALUES (?, ?)').run(name, ctx.user.id).lastInsertRowid
      );
    }
    const ins = db().prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)');
    let pos = 0;
    for (const raw of ctx.q.getAll('songId')) {
      const sid = parseSid(raw);
      if (sid?.kind === 'track') ins.run(playlistId, sid.id, pos++);
    }
    return playlistWithSongs(ctx, playlistId);
  },

  updatePlaylist: (ctx) => {
    const own = ownPlaylist(ctx, 'playlistId');
    if (own instanceof Response) return own;
    const name = ctx.q.get('name');
    if (name) db().prepare('UPDATE playlists SET name = ? WHERE id = ?').run(name, own.id);
    const removeIdx = ctx.q
      .getAll('songIndexToRemove')
      .map(Number)
      .filter((n) => Number.isInteger(n))
      .sort((a, b) => b - a);
    if (removeIdx.length) {
      const rows = db()
        .prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position')
        .all(own.id) as { track_id: number }[];
      const ids = rows.map((r) => r.track_id);
      for (const idx of removeIdx) if (idx >= 0 && idx < ids.length) ids.splice(idx, 1);
      db().prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(own.id);
      const ins = db().prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)');
      ids.forEach((tid, i) => ins.run(own.id, tid, i));
    }
    const maxPos = (db().prepare('SELECT COALESCE(MAX(position), -1) AS p FROM playlist_tracks WHERE playlist_id = ?').get(own.id) as { p: number }).p;
    const ins = db().prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)');
    let pos = maxPos + 1;
    for (const raw of ctx.q.getAll('songIdToAdd')) {
      const sid = parseSid(raw);
      if (sid?.kind === 'track') ins.run(own.id, sid.id, pos++);
    }
    return subsonicResponse(ctx.req);
  },

  deletePlaylist: (ctx) => {
    const own = ownPlaylist(ctx, 'id');
    if (own instanceof Response) return own;
    db().prepare('DELETE FROM playlists WHERE id = ?').run(own.id);
    return subsonicResponse(ctx.req);
  },

  getUser: (ctx) =>
    subsonicResponse(ctx.req, {
      user: {
        username: ctx.user.name,
        scrobblingEnabled: true,
        adminRole: ctx.user.id === ADMIN_USER_ID,
        settingsRole: false,
        downloadRole: true,
        uploadRole: false,
        playlistRole: true,
        coverArtRole: false,
        commentRole: false,
        podcastRole: false,
        streamRole: true,
        jukeboxRole: false,
        shareRole: false,
        videoConversionRole: false,
        folder: [1],
      },
    }),

  getScanStatus: (ctx) => {
    const s = scanStatus();
    const count = (db().prepare('SELECT COUNT(*) AS n FROM tracks').get() as { n: number }).n;
    return subsonicResponse(ctx.req, { scanStatus: { scanning: s.scanning, count } });
  },

  startScan: (ctx) => {
    if (ctx.user.id !== ADMIN_USER_ID) return subsonicError(ctx.req, 50, 'admin only');
    scanLibrary().catch(() => {});
    const count = (db().prepare('SELECT COUNT(*) AS n FROM tracks').get() as { n: number }).n;
    return subsonicResponse(ctx.req, { scanStatus: { scanning: true, count } });
  },

  getPlayQueue: (ctx) => subsonicResponse(ctx.req),
  savePlayQueue: (ctx) => subsonicResponse(ctx.req),
  getBookmarks: (ctx) => subsonicResponse(ctx.req, { bookmarks: {} }),
  getPodcasts: (ctx) => subsonicResponse(ctx.req, { podcasts: {} }),
  getInternetRadioStations: (ctx) => subsonicResponse(ctx.req, { internetRadioStations: {} }),
  getShares: (ctx) => subsonicResponse(ctx.req, { shares: {} }),
  getNowPlaying: (ctx) => subsonicResponse(ctx.req, { nowPlaying: {} }),
};

async function handle(req: NextRequest, { params }: { params: Promise<{ view: string[] }> }) {
  const { view: parts } = await params;
  const view = (parts?.[0] ?? '').replace(/\.view$/, '');
  const handler = HANDLERS[view];

  // ping without credentials still answers (clients probe before auth), everything else requires auth
  const user = authenticate(req);
  if (!user) {
    if (view === 'ping' || view === 'getOpenSubsonicExtensions')
      return subsonicError(req, 40, 'Wrong username or password');
    return subsonicError(req, 40, 'Wrong username or password');
  }
  if (!handler) return subsonicError(req, 0, `not implemented: ${view}`);
  try {
    return await handler({ req, user, q: req.nextUrl.searchParams, view });
  } catch (err) {
    console.error(`subsonic ${view} failed:`, err);
    return subsonicError(req, 0, 'internal error');
  }
}

export { handle as GET, handle as POST };
