import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { getDb, artDir } from '@/lib/db';
import { imageContentType } from '@/lib/art';
import { nextPosition } from '@/lib/playlistMatch';
import { scrobbleTrack, updateNowPlaying } from '@/lib/lastfm';
import { scanLibrary, scanStatus } from '@/lib/scanner';
import {
  listStations,
  createStation,
  updateStation,
  deleteStation,
  streamUrlError,
  assertPublicStreamUrl,
} from '@/lib/stations';
import { serveTrack } from '@/lib/streaming';
import { ADMIN_USER_ID } from '@/lib/user';
import { resolveLyrics } from '@/lib/lyrics';
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
  type Body,
  type SubUser,
  type TrackRow,
  type AlbumRow,
  type ArtistRow,
} from '@/lib/subsonic';

export const dynamic = 'force-dynamic';

const IGNORED_ARTICLES = 'The El La Los Las Le Les';

// Only advertise what the handlers below really implement: songLyrics = getLyricsBySongId,
// transcodeOffset = stream?timeOffset. Clients enable features purely from this list.
const OPEN_SUBSONIC_EXTENSIONS = [
  { name: 'songLyrics', versions: [1] },
  { name: 'transcodeOffset', versions: [1] },
];

// q is the query string merged with any POST form body, so handlers never read req.nextUrl directly
type Ctx = { req: NextRequest; user: SubUser; q: URLSearchParams };

// Envelope helpers bound to ctx.q so f=/callback= are honoured when a client sends them in a form body.
const ok = (ctx: Ctx, body?: Body): Response => subsonicResponse(ctx.req, body, 'ok', ctx.q);
const fail = (ctx: Ctx, code: number, message: string): Response => subsonicError(ctx.req, code, message, ctx.q);

// ---------- helpers ----------

const db = () => getDb();

function tracksBy(where: string, params: Record<string, unknown>, uid: number, order = '', limit = ''): TrackRow[] {
  return db()
    .prepare(`${TRACK_SQL} WHERE ${where} ${order} ${limit}`)
    .all({ uid, ...params }) as TrackRow[];
}

/** Count/size param: missing or invalid → fallback, but an explicit 0 means 0 (clients use it to skip a section). */
function num(q: URLSearchParams, key: string, fallback: number, max = 500): number {
  const raw = q.get(key);
  if (raw === null || raw.trim() === '') return fallback;
  const v = Math.floor(Number(raw));
  if (!Number.isFinite(v) || v < 0) return fallback;
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
  if (!sid || sid.kind !== 'track') return fail(ctx, 70, 'song not found');
  const row = db().prepare('SELECT path, duration FROM tracks WHERE id = ?').get(sid.id) as
    | { path: string; duration: number }
    | undefined;
  if (!row || !fs.existsSync(row.path)) return fail(ctx, 70, 'song not found');
  // OpenSubsonic transcodeOffset: seconds into the track to start a transcoded stream at
  const timeOffset = Number(ctx.q.get('timeOffset'));
  return serveTrack(ctx.req, row.path, {
    format: ctx.q.get('format'),
    maxBitRate: Number(ctx.q.get('maxBitRate')) || 0,
    download,
    offset: ctx.q.has('timeOffset') && Number.isFinite(timeOffset) && timeOffset >= 0 ? timeOffset : undefined,
    // Same as the web route: lets a source that already fits maxBitRate skip the transcode
    // and bounds timeOffset by the track length.
    durationSec: Number(row.duration) || 0,
  });
}

function coverArt(ctx: Ctx): Response {
  const sid = parseSid(ctx.q.get('id'));
  if (!sid) return fail(ctx, 70, 'cover art not found');
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
  if (!file || !fs.existsSync(file)) return fail(ctx, 70, 'cover art not found');
  const buf = fs.readFileSync(file);
  // .img files are whatever the scanner/fetcher found (jpeg, png, webp); sniff instead of assuming jpeg
  return new Response(new Uint8Array(buf), {
    headers: { 'Content-Type': imageContentType(buf) ?? 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
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
  else if (type === 'recent') {
    // per-profile, like the web app's recently played
    order =
      'ORDER BY (SELECT MAX(h.played_at) FROM history h JOIN tracks ht ON ht.id = h.track_id WHERE ht.album_id = al.id AND h.user_id = @uid) DESC';
    params.uid = ctx.user.id;
  } else if (type === 'frequent') {
    order =
      'ORDER BY (SELECT COUNT(*) FROM history h JOIN tracks ht ON ht.id = h.track_id WHERE ht.album_id = al.id AND h.user_id = @uid) DESC';
    params.uid = ctx.user.id;
  } else if (type === 'byYear') {
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
  return ok(ctx, { [key]: { album: rows.map(albumJson) } });
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
  return ok(ctx, {
    [key]: { artist: artists.map(artistJson), album: albums.map(albumJson), song: songs.map(songJson) },
  });
}

/**
 * getSimilarSongs(2): no audio similarity data here, so "similar" = random tracks by the same
 * artist or in the same genre as the seed (song, album or artist id), never the seed song itself.
 */
function similarSongs(ctx: CtxWithView): Response {
  const sid = parseSid(ctx.q.get('id'));
  if (!sid || sid.kind === 'playlist') return fail(ctx, 70, 'not found');
  const count = num(ctx.q, 'count', 50);
  type Seed = { artist_id: number; genre: string | null };
  let seed: Seed | undefined;
  if (sid.kind === 'track') {
    seed = db().prepare('SELECT artist_id, genre FROM tracks WHERE id = ?').get(sid.id) as Seed | undefined;
  } else if (sid.kind === 'album') {
    seed = db()
      .prepare(
        `SELECT al.artist_id,
                (SELECT genre FROM tracks WHERE album_id = al.id AND genre IS NOT NULL
                 GROUP BY genre ORDER BY COUNT(*) DESC LIMIT 1) AS genre
         FROM albums al WHERE al.id = ?`
      )
      .get(sid.id) as Seed | undefined;
  } else {
    seed = db()
      .prepare(
        `SELECT ar.id AS artist_id,
                (SELECT genre FROM tracks WHERE artist_id = ar.id AND genre IS NOT NULL
                 GROUP BY genre ORDER BY COUNT(*) DESC LIMIT 1) AS genre
         FROM artists ar WHERE ar.id = ?`
      )
      .get(sid.id) as Seed | undefined;
  }
  if (!seed) return fail(ctx, 70, 'not found');
  const params: Record<string, unknown> = { artist: seed.artist_id, exclude: sid.kind === 'track' ? sid.id : 0 };
  let where = 't.artist_id = @artist AND t.id != @exclude';
  if (seed.genre) {
    where = '(t.artist_id = @artist OR t.genre = @genre) AND t.id != @exclude';
    params.genre = seed.genre;
  }
  const songs = tracksBy(where, params, ctx.user.id, 'ORDER BY RANDOM()', `LIMIT ${count}`);
  const key = ctx.view === 'getSimilarSongs' ? 'similarSongs' : 'similarSongs2';
  return ok(ctx, { [key]: { song: songs.map(songJson) } });
}

// ---------- playlists ----------

function ownPlaylist(ctx: Ctx, sidParam: string): { id: number } | Response {
  const sid = parseSid(ctx.q.get(sidParam));
  if (!sid || sid.kind !== 'playlist') return fail(ctx, 70, 'playlist not found');
  const row = db().prepare('SELECT id, user_id FROM playlists WHERE id = ?').get(sid.id) as
    | { id: number; user_id: number }
    | undefined;
  if (!row) return fail(ctx, 70, 'playlist not found');
  if (row.user_id !== ctx.user.id) return fail(ctx, 50, 'not your playlist');
  return { id: row.id };
}

function playlistWithSongs(ctx: Ctx, id: number): Response {
  const p = db().prepare(`${PLAYLIST_SQL} WHERE p.id = ? GROUP BY p.id`).get(id) as Parameters<typeof playlistJson>[0] | undefined;
  if (!p) return fail(ctx, 70, 'playlist not found');
  const songs = db()
    .prepare(`${TRACK_SQL} JOIN playlist_tracks pt ON pt.track_id = t.id WHERE pt.playlist_id = @pl ORDER BY pt.position`)
    .all({ uid: ctx.user.id, pl: id }) as TrackRow[];
  return ok(ctx, { playlist: { ...playlistJson(p), entry: songs.map(songJson) } });
}

// ---------- dispatcher ----------

type CtxWithView = Ctx & { view: string };

const HANDLERS: Record<string, (ctx: CtxWithView) => Response | Promise<Response>> = {
  ping: (ctx) => ok(ctx),
  getLicense: (ctx) => ok(ctx, { license: { valid: true } }),
  getOpenSubsonicExtensions: (ctx) =>
    ok(ctx, { openSubsonicExtensions: OPEN_SUBSONIC_EXTENSIONS }),

  getMusicFolders: (ctx) =>
    ok(ctx, { musicFolders: { musicFolder: [{ id: 1, name: 'Music' }] } }),

  getIndexes: (ctx) =>
    ok(ctx, {
      indexes: { lastModified: Date.now(), ignoredArticles: IGNORED_ARTICLES, index: artistIndexes() },
    }),

  getArtists: (ctx) =>
    ok(ctx, { artists: { ignoredArticles: IGNORED_ARTICLES, index: artistIndexes() } }),

  // Folder-style browsing: getIndexes lists artists as 'ar-N', whose children are albums 'al-N',
  // whose children are songs. Same serializers as the ID3 endpoints so ids round-trip exactly.
  getMusicDirectory: (ctx) => {
    const sid = parseSid(ctx.q.get('id'));
    if (sid?.kind === 'artist') {
      const artist = db().prepare('SELECT id, name FROM artists WHERE id = ?').get(sid.id) as
        | { id: number; name: string }
        | undefined;
      if (!artist) return fail(ctx, 70, 'directory not found');
      const albums = db()
        .prepare(`${ALBUM_SQL} WHERE al.artist_id = ? GROUP BY al.id ORDER BY al.year, al.name COLLATE NOCASE`)
        .all(sid.id) as AlbumRow[];
      return ok(ctx, {
        directory: { id: artistSid(artist.id), name: artist.name, child: albums.map(albumJson) },
      });
    }
    if (sid?.kind === 'album') {
      const album = db().prepare('SELECT id, name, artist_id FROM albums WHERE id = ?').get(sid.id) as
        | { id: number; name: string; artist_id: number }
        | undefined;
      if (!album) return fail(ctx, 70, 'directory not found');
      const songs = tracksBy('t.album_id = @al', { al: sid.id }, ctx.user.id, 'ORDER BY t.disc_no, t.track_no, t.title');
      return ok(ctx, {
        directory: {
          id: albumSid(album.id),
          parent: artistSid(album.artist_id),
          name: album.name,
          child: songs.map(songJson),
        },
      });
    }
    return fail(ctx, 70, 'directory not found');
  },

  getArtist: (ctx) => {
    const sid = parseSid(ctx.q.get('id'));
    if (!sid || sid.kind !== 'artist') return fail(ctx, 70, 'artist not found');
    const artist = db()
      .prepare(
        `SELECT ar.id, ar.name, COUNT(DISTINCT al.id) AS albumCount
         FROM artists ar LEFT JOIN albums al ON al.artist_id = ar.id WHERE ar.id = ? GROUP BY ar.id`
      )
      .get(sid.id) as ArtistRow | undefined;
    if (!artist) return fail(ctx, 70, 'artist not found');
    const albums = db()
      .prepare(`${ALBUM_SQL} WHERE al.artist_id = ? GROUP BY al.id ORDER BY al.year DESC, al.name`)
      .all(sid.id) as AlbumRow[];
    return ok(ctx, { artist: { ...artistJson(artist), album: albums.map(albumJson) } });
  },

  getAlbum: (ctx) => {
    const sid = parseSid(ctx.q.get('id'));
    if (!sid || sid.kind !== 'album') return fail(ctx, 70, 'album not found');
    const album = db().prepare(`${ALBUM_SQL} WHERE al.id = ? GROUP BY al.id`).get(sid.id) as AlbumRow | undefined;
    if (!album) return fail(ctx, 70, 'album not found');
    const songs = tracksBy('t.album_id = @al', { al: sid.id }, ctx.user.id, 'ORDER BY t.disc_no, t.track_no, t.title');
    return ok(ctx, { album: { ...albumJson(album), song: songs.map(songJson) } });
  },

  getSong: (ctx) => {
    const sid = parseSid(ctx.q.get('id'));
    if (!sid || sid.kind !== 'track') return fail(ctx, 70, 'song not found');
    const song = tracksBy('t.id = @id', { id: sid.id }, ctx.user.id)[0];
    if (!song) return fail(ctx, 70, 'song not found');
    return ok(ctx, { song: songJson(song) });
  },

  getGenres: (ctx) => {
    const rows = db()
      .prepare(
        `SELECT genre AS value, COUNT(*) AS songCount, COUNT(DISTINCT album_id) AS albumCount
         FROM tracks WHERE genre IS NOT NULL GROUP BY genre ORDER BY songCount DESC`
      )
      .all();
    return ok(ctx, { genres: { genre: rows } });
  },

  getAlbumList: albumList,
  getAlbumList2: albumList,

  getRandomSongs: (ctx) => {
    const size = num(ctx.q, 'size', 10);
    // same optional filters as getAlbumList byGenre / byYear, applied at track level
    const where: string[] = ['1=1'];
    const params: Record<string, unknown> = {};
    const genre = ctx.q.get('genre');
    if (genre) {
      where.push('t.genre = @genre');
      params.genre = genre;
    }
    if (ctx.q.has('fromYear') || ctx.q.has('toYear')) {
      const from = Number(ctx.q.get('fromYear')) || 0;
      const to = Number(ctx.q.get('toYear')) || 3000;
      where.push('al.year BETWEEN @from AND @to');
      params.from = Math.min(from, to);
      params.to = Math.max(from, to);
    }
    const songs = tracksBy(where.join(' AND '), params, ctx.user.id, 'ORDER BY RANDOM()', `LIMIT ${size}`);
    return ok(ctx, { randomSongs: { song: songs.map(songJson) } });
  },

  getSimilarSongs: similarSongs,
  getSimilarSongs2: similarSongs,

  getSongsByGenre: (ctx) => {
    const size = num(ctx.q, 'count', 10);
    const offset = Number(ctx.q.get('offset')) || 0;
    const songs = tracksBy('t.genre = @g', { g: ctx.q.get('genre') ?? '' }, ctx.user.id, 'ORDER BY t.title', `LIMIT ${size} OFFSET ${offset}`);
    return ok(ctx, { songsByGenre: { song: songs.map(songJson) } });
  },

  getStarred: (ctx) => {
    const songs = tracksBy('t.id IN (SELECT track_id FROM likes WHERE user_id = @uid)', {}, ctx.user.id, 'ORDER BY starred DESC');
    return ok(ctx, { starred: { artist: [], album: [], song: songs.map(songJson) } });
  },

  getStarred2: (ctx) => {
    const songs = tracksBy('t.id IN (SELECT track_id FROM likes WHERE user_id = @uid)', {}, ctx.user.id, 'ORDER BY starred DESC');
    return ok(ctx, { starred2: { artist: [], album: [], song: songs.map(songJson) } });
  },

  getTopSongs: (ctx) => {
    const artist = ctx.q.get('artist') ?? '';
    const count = num(ctx.q, 'count', 50);
    const songs = tracksBy('ar.name = @a COLLATE NOCASE', { a: artist }, ctx.user.id, 'ORDER BY playCount DESC, t.title', `LIMIT ${count}`);
    return ok(ctx, { topSongs: { song: songs.map(songJson) } });
  },

  // no biography source; omit the field rather than send an empty object strict JSON clients reject
  getArtistInfo: (ctx) => ok(ctx, { artistInfo: { similarArtist: [] } }),
  getArtistInfo2: (ctx) => ok(ctx, { artistInfo2: { similarArtist: [] } }),
  getAlbumInfo: (ctx) => ok(ctx, { albumInfo: {} }),
  getAlbumInfo2: (ctx) => ok(ctx, { albumInfo: {} }),

  search2: search,
  search3: search,

  stream: (ctx) => streamTrack(ctx),
  download: (ctx) => streamTrack(ctx, true),
  getCoverArt: coverArt,

  getLyrics: async (ctx) => {
    const artist = ctx.q.get('artist') ?? '';
    const title = ctx.q.get('title') ?? '';

    const row = db()
      .prepare(
        `SELECT t.id FROM tracks t
         JOIN artists ar ON ar.id = t.artist_id
         WHERE t.title = ? COLLATE NOCASE AND ar.name = ? COLLATE NOCASE LIMIT 1`
      )
      .get(title, artist) as { id: number } | undefined;

    if (!row) {
      return ok(ctx, { lyrics: { artist, title, value: '' } });
    }

    const lyrics = await resolveLyrics(row.id);
    const text = lyrics?.plain ?? lyrics?.lines.map((line) => line.value).join('\n') ?? '';

    return ok(ctx, { lyrics: { artist, title, value: text } });
  },

  getLyricsBySongId: async (ctx) => {
    const rawId = ctx.q.get('id');
    if (!rawId) return fail(ctx, 10, 'id required');

    const sid = parseSid(rawId);
    if (!sid || sid.kind !== 'track') return fail(ctx, 70, 'song not found');

    const lyrics = await resolveLyrics(sid.id);
    if (!lyrics) return fail(ctx, 70, 'song not found');

    const structuredLyrics =
      lyrics.lines.length === 0
        ? []
        : [
            {
              displayArtist: lyrics.track.artist,
              displayTitle: lyrics.track.title,
              lang: 'und',
              offset: lyrics.offset,
              synced: lyrics.synced,
              line: lyrics.synced
                ? lyrics.lines.map((line) => ({
                    start: line.start ?? 0,
                    value: line.value,
                  }))
                : lyrics.lines.map((line) => ({ value: line.value })),
            },
          ];

    return ok(ctx, {
      lyricsList: { structuredLyrics },
    });
  },

  scrobble: (ctx) => {
    const submission = ctx.q.get('submission') !== 'false';
    const times = ctx.q.getAll('time'); // ms epoch, parallel to id per Subsonic spec
    ctx.q.getAll('id').forEach((raw, i) => {
      const sid = parseSid(raw);
      if (sid?.kind !== 'track') return;
      if (submission) {
        // Offline-cached plays arrive late with their original time; keep it so history and
        // Last.fm agree. Anything more than an hour ahead of us is a bad clock: use now.
        const timeMs = Number(times[i]);
        const playedMs = Number.isFinite(timeMs) && timeMs > 0 && timeMs <= Date.now() + 3_600_000 ? timeMs : null;
        if (playedMs === null) {
          db().prepare('INSERT INTO history (track_id, user_id) VALUES (?, ?)').run(sid.id, ctx.user.id);
        } else {
          // history.played_at is datetime('now') text, i.e. 'YYYY-MM-DD HH:MM:SS' in UTC
          const playedAt = new Date(playedMs).toISOString().slice(0, 19).replace('T', ' ');
          db()
            .prepare('INSERT INTO history (track_id, user_id, played_at) VALUES (?, ?, ?)')
            .run(sid.id, ctx.user.id, playedAt);
        }
        scrobbleTrack(ctx.user.id, sid.id, playedMs === null ? undefined : Math.floor(playedMs / 1000));
      } else {
        updateNowPlaying(ctx.user.id, sid.id);
      }
    });
    return ok(ctx);
  },

  star: (ctx) => {
    for (const raw of ctx.q.getAll('id')) {
      const sid = parseSid(raw);
      if (sid?.kind === 'track')
        db().prepare('INSERT OR IGNORE INTO likes (user_id, track_id) VALUES (?, ?)').run(ctx.user.id, sid.id);
    }
    return ok(ctx);
  },

  unstar: (ctx) => {
    for (const raw of ctx.q.getAll('id')) {
      const sid = parseSid(raw);
      if (sid?.kind === 'track')
        db().prepare('DELETE FROM likes WHERE user_id = ? AND track_id = ?').run(ctx.user.id, sid.id);
    }
    return ok(ctx);
  },

  setRating: (ctx) => ok(ctx),

  getPlaylists: (ctx) => {
    const rows = db()
      .prepare(`${PLAYLIST_SQL} WHERE p.user_id = ? GROUP BY p.id ORDER BY p.created_at DESC`)
      .all(ctx.user.id) as Parameters<typeof playlistJson>[0][];
    return ok(ctx, { playlists: { playlist: rows.map(playlistJson) } });
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
    } else {
      const name = ctx.q.get('name');
      if (!name) return fail(ctx, 10, 'name required');
      playlistId = Number(
        db().prepare('INSERT INTO playlists (name, user_id) VALUES (?, ?)').run(name, ctx.user.id).lastInsertRowid
      );
    }
    const songIds = ctx.q.getAll('songId');
    // One transaction so a client never observes the playlist half-replaced. Positions start after
    // any placeholders (songs not in the library) so they keep their slot in the shared position space.
    db().transaction(() => {
      if (existing) db().prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlistId);
      const ins = db().prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)');
      let pos = nextPosition(db(), playlistId);
      for (const raw of songIds) {
        const sid = parseSid(raw);
        if (sid?.kind === 'track') ins.run(playlistId, sid.id, pos++);
      }
    })();
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
    const addIds = ctx.q.getAll('songIdToAdd');
    db().transaction(() => {
      if (removeIdx.length) {
        // songIndexToRemove is the index in the song list the client saw (placeholders are invisible
        // to it), so map indexes to track ids and delete just those: no renumbering, placeholders intact
        const rows = db()
          .prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position')
          .all(own.id) as { track_id: number }[];
        const del = db().prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?');
        for (const idx of removeIdx) if (idx >= 0 && idx < rows.length) del.run(own.id, rows[idx].track_id);
      }
      const ins = db().prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)');
      let pos = nextPosition(db(), own.id);
      for (const raw of addIds) {
        const sid = parseSid(raw);
        if (sid?.kind === 'track') ins.run(own.id, sid.id, pos++);
      }
    })();
    return ok(ctx);
  },

  deletePlaylist: (ctx) => {
    const own = ownPlaylist(ctx, 'id');
    if (own instanceof Response) return own;
    db().prepare('DELETE FROM playlists WHERE id = ?').run(own.id);
    return ok(ctx);
  },

  getUser: (ctx) =>
    ok(ctx, {
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

  getInternetRadioStations: (ctx) =>
    ok(ctx, {
      internetRadioStations: {
        internetRadioStation: listStations().map((s) => ({
          id: `ir-${s.id}`,
          name: s.name,
          streamUrl: s.streamUrl,
          ...(s.homePageUrl ? { homePageUrl: s.homePageUrl } : {}),
        })),
      },
    }),

  createInternetRadioStation: async (ctx) => {
    if (ctx.user.id !== ADMIN_USER_ID) return fail(ctx, 50, 'admin only');
    const name = ctx.q.get('name') ?? '';
    const streamUrl = ctx.q.get('streamUrl') ?? '';
    if (!name || !streamUrl) return fail(ctx, 10, 'name and streamUrl required');
    // code 0 (generic) rather than 10: the parameter is present, it is the address that is refused
    const urlError = streamUrlError(streamUrl);
    if (urlError) return fail(ctx, 0, urlError);
    // literals passed; now make sure the hostname does not resolve back into the LAN either
    try {
      await assertPublicStreamUrl(streamUrl);
    } catch (err) {
      return fail(ctx, 0, (err as Error).message);
    }
    createStation(name, streamUrl, ctx.q.get('homepageUrl'));
    return ok(ctx);
  },

  updateInternetRadioStation: async (ctx) => {
    if (ctx.user.id !== ADMIN_USER_ID) return fail(ctx, 50, 'admin only');
    const id = Number((ctx.q.get('id') ?? '').replace(/^ir-/, ''));
    const name = ctx.q.get('name') ?? '';
    const streamUrl = ctx.q.get('streamUrl') ?? '';
    if (!id || !name || !streamUrl) return fail(ctx, 10, 'id, name and streamUrl required');
    const urlError = streamUrlError(streamUrl);
    if (urlError) return fail(ctx, 0, urlError);
    try {
      await assertPublicStreamUrl(streamUrl);
    } catch (err) {
      return fail(ctx, 0, (err as Error).message);
    }
    if (!updateStation(id, name, streamUrl, ctx.q.get('homepageUrl'))) return fail(ctx, 70, 'station not found');
    return ok(ctx);
  },

  deleteInternetRadioStation: (ctx) => {
    if (ctx.user.id !== ADMIN_USER_ID) return fail(ctx, 50, 'admin only');
    const id = Number((ctx.q.get('id') ?? '').replace(/^ir-/, ''));
    if (!id || !deleteStation(id)) return fail(ctx, 70, 'station not found');
    return ok(ctx);
  },

  getScanStatus: (ctx) => {
    const s = scanStatus();
    const count = (db().prepare('SELECT COUNT(*) AS n FROM tracks').get() as { n: number }).n;
    return ok(ctx, { scanStatus: { scanning: s.scanning, count } });
  },

  startScan: (ctx) => {
    if (ctx.user.id !== ADMIN_USER_ID) return fail(ctx, 50, 'admin only');
    scanLibrary().catch(() => {});
    const count = (db().prepare('SELECT COUNT(*) AS n FROM tracks').get() as { n: number }).n;
    return ok(ctx, { scanStatus: { scanning: true, count } });
  },

  getPlayQueue: (ctx) => ok(ctx),
  savePlayQueue: (ctx) => ok(ctx),
  getBookmarks: (ctx) => ok(ctx, { bookmarks: {} }),
  getPodcasts: (ctx) => ok(ctx, { podcasts: {} }),
  getShares: (ctx) => ok(ctx, { shares: {} }),
  getNowPlaying: (ctx) => ok(ctx, { nowPlaying: {} }),
};

/**
 * Query string merged with a POST form body. Subsonic clients may send every parameter (auth,
 * ids, format) as application/x-www-form-urlencoded instead of in the URL; a key present in both
 * is taken from the body, including all values of a repeated key such as id=.
 */
async function requestParams(req: NextRequest): Promise<URLSearchParams> {
  const merged = new URLSearchParams(req.nextUrl.searchParams);
  const type = (req.headers.get('content-type') ?? '').toLowerCase();
  if (req.method !== 'POST' || !type.startsWith('application/x-www-form-urlencoded')) return merged;
  let body: URLSearchParams;
  try {
    body = new URLSearchParams(await req.text());
  } catch {
    return merged; // unreadable body: fall back to the query string alone
  }
  for (const key of new Set(body.keys())) merged.delete(key);
  for (const [key, value] of body) merged.append(key, value);
  return merged;
}

async function handle(req: NextRequest, { params }: { params: Promise<{ view: string[] }> }) {
  const { view: parts } = await params;
  const view = (parts?.[0] ?? '').replace(/\.view$/, '');
  const q = await requestParams(req);

  // OpenSubsonic requires extension discovery to be publicly accessible.
  if (view === 'getOpenSubsonicExtensions') {
    return subsonicResponse(req, { openSubsonicExtensions: OPEN_SUBSONIC_EXTENSIONS }, 'ok', q);
  }

  const handler = HANDLERS[view];
  if (!handler) return subsonicError(req, 0, `not implemented: ${view}`, q);

  const user = authenticate(req, q);
  if (!user) return subsonicError(req, 40, 'Wrong username or password', q);

  try {
    return await handler({ req, user, q, view });
  } catch (err) {
    console.error(`subsonic ${view} failed:`, err);
    return subsonicError(req, 0, 'internal error', q);
  }
}

export { handle as GET, handle as POST };