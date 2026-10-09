import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// getDb() resolves DATA_DIR when the module loads, so the temp dir must exist before any import.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotless-subsonic-'));
process.env.DATA_DIR = dataDir;

// The stream test checks what the /rest route hands to serveTrack, not what serveTrack does
// with it (streaming has its own behaviour); a stub also keeps ffmpeg out of the test run.
vi.mock('@/lib/streaming', () => ({
  serveTrack: vi.fn(async () => new Response('audio')),
}));

type Subsonic = typeof import('@/lib/subsonic');
type Users = typeof import('@/lib/user');
type Auth = typeof import('@/lib/auth');
type Db = typeof import('@/lib/db');
type RestRoute = typeof import('@/app/rest/[...view]/route');

let subsonic: Subsonic;
let db: Db;
let username = '';
let appPassword = '';

function ping(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/rest/ping.view');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

function token(password: string, salt: string): string {
  return crypto.createHash('md5').update(password + salt).digest('hex');
}

beforeAll(async () => {
  subsonic = await import('@/lib/subsonic');
  db = await import('@/lib/db');
  const users: Users = await import('@/lib/user');
  const auth: Auth = await import('@/lib/auth');

  // Same path the setup wizard and Settings → Mobile apps use: a real profile with a real app password.
  const user = users.createUser('Listener', await auth.hashPassword('correct horse'));
  username = user.name;
  appPassword = subsonic.getAppPassword(user.id);
});

afterAll(() => {
  db.getDb().close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('subsonic authenticate', () => {
  it('accepts u + t + s when t = md5(password + salt)', () => {
    const salt = 'abc123';
    const user = subsonic.authenticate(ping({ u: username, t: token(appPassword, salt), s: salt }));
    expect(user?.name).toBe(username);
  });

  it('matches the username case-insensitively and accepts an upper-case token', () => {
    const salt = 'xyz';
    const user = subsonic.authenticate(ping({ u: username.toUpperCase(), t: token(appPassword, salt).toUpperCase(), s: salt }));
    expect(user?.name).toBe(username);
  });

  it('rejects a wrong token and a token for a different salt', () => {
    expect(subsonic.authenticate(ping({ u: username, t: token('wrong', 's1'), s: 's1' }))).toBeNull();
    expect(subsonic.authenticate(ping({ u: username, t: token(appPassword, 's1'), s: 's2' }))).toBeNull();
  });

  it('accepts the legacy plain p= password', () => {
    expect(subsonic.authenticate(ping({ u: username, p: appPassword }))?.name).toBe(username);
    expect(subsonic.authenticate(ping({ u: username, p: 'nope' }))).toBeNull();
  });

  it('accepts the legacy hex-encoded p=enc: password', () => {
    const enc = 'enc:' + Buffer.from(appPassword, 'utf8').toString('hex');
    expect(subsonic.authenticate(ping({ u: username, p: enc }))?.name).toBe(username);
    expect(subsonic.authenticate(ping({ u: username, p: 'enc:00' }))).toBeNull();
  });

  it('fails for a missing or unknown user and for missing credentials', () => {
    expect(subsonic.authenticate(ping({ t: token(appPassword, 's'), s: 's' }))).toBeNull();
    expect(subsonic.authenticate(ping({ u: 'nobody', p: appPassword }))).toBeNull();
    expect(subsonic.authenticate(ping({ u: username }))).toBeNull();
  });

  it('token auth takes precedence over p= when both are present', () => {
    const salt = 'both';
    expect(subsonic.authenticate(ping({ u: username, t: token('wrong', salt), s: salt, p: appPassword }))).toBeNull();
  });
});

describe('subsonic stream', () => {
  it('passes the track duration to serveTrack so a fitting source can be served raw and timeOffset is bounded', async () => {
    const route: RestRoute = await import('@/app/rest/[...view]/route');
    const streaming = await import('@/lib/streaming');
    const d = db.getDb();
    const artistId = Number(d.prepare('INSERT INTO artists (name) VALUES (?)').run('Band').lastInsertRowid);
    const albumId = Number(d.prepare('INSERT INTO albums (name, artist_id) VALUES (?, ?)').run('Record', artistId).lastInsertRowid);
    const file = path.join(dataDir, 'song.mp3');
    fs.writeFileSync(file, Buffer.alloc(1200));
    const trackId = Number(
      d
        .prepare('INSERT INTO tracks (title, album_id, artist_id, duration, path) VALUES (?, ?, ?, ?, ?)')
        .run('Song', albumId, artistId, 10, file).lastInsertRowid
    );

    const url = new URL('http://localhost/rest/stream.view');
    url.searchParams.set('u', username);
    url.searchParams.set('p', appPassword);
    url.searchParams.set('id', `tr-${trackId}`);
    url.searchParams.set('maxBitRate', '128');
    url.searchParams.set('timeOffset', '4');
    const req = new NextRequest(url);

    const res = await route.GET(req, { params: Promise.resolve({ view: ['stream.view'] }) });
    expect(res.status).toBe(200);
    expect(streaming.serveTrack).toHaveBeenCalledTimes(1);
    expect(streaming.serveTrack).toHaveBeenCalledWith(
      req,
      file,
      expect.objectContaining({ maxBitRate: 128, offset: 4, download: false, durationSec: 10 })
    );
  });
});

describe('subsonic internet radio', () => {
  // The first user created is the admin, so `username` may manage stations.
  function radioRequest(view: string, params: Record<string, string>): NextRequest {
    const url = new URL(`http://localhost/rest/${view}`);
    url.searchParams.set('u', username);
    url.searchParams.set('p', appPassword);
    url.searchParams.set('f', 'json');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return new NextRequest(url);
  }

  it('refuses a stream hostname that resolves into the LAN and keeps it out of the list', async () => {
    delete process.env.ALLOW_PRIVATE_STREAM_URLS;
    const route: RestRoute = await import('@/app/rest/[...view]/route');
    const dns = await import('dns');
    const stations = await import('@/lib/stations');
    const lookup = vi
      .spyOn(dns.promises, 'lookup')
      .mockImplementation(async () => [{ address: '192.168.0.50', family: 4 }] as never);
    try {
      const req = radioRequest('createInternetRadioStation.view', {
        name: 'Rebinder',
        streamUrl: 'http://rebind.example.net:8000/stream',
      });
      const res = await route.GET(req, { params: Promise.resolve({ view: ['createInternetRadioStation.view'] }) });
      const body = await res.json();
      expect(body['subsonic-response'].status).toBe('failed');
      expect(body['subsonic-response'].error.message).toBe(stations.PRIVATE_STREAM_HOST_ERROR);
      expect(lookup).toHaveBeenCalledWith('rebind.example.net', { all: true });
      expect(stations.listStations().some((s) => s.name === 'Rebinder')).toBe(false);
    } finally {
      lookup.mockRestore();
    }
  });

  it('creates a station whose hostname resolves to a public address', async () => {
    delete process.env.ALLOW_PRIVATE_STREAM_URLS;
    const route: RestRoute = await import('@/app/rest/[...view]/route');
    const dns = await import('dns');
    const stations = await import('@/lib/stations');
    const lookup = vi
      .spyOn(dns.promises, 'lookup')
      .mockImplementation(async () => [{ address: '203.0.113.7', family: 4 }] as never);
    try {
      const req = radioRequest('createInternetRadioStation.view', {
        name: 'Public',
        streamUrl: 'https://ice.example.com/stream.mp3',
      });
      const res = await route.GET(req, { params: Promise.resolve({ view: ['createInternetRadioStation.view'] }) });
      const body = await res.json();
      expect(body['subsonic-response'].status).toBe('ok');
      expect(stations.listStations().some((s) => s.name === 'Public')).toBe(true);
    } finally {
      lookup.mockRestore();
    }
  });
});

// ---------- request handling: form bodies, required params, paging, scrobble time, album lists ----------

function restUrl(view: string, params: Record<string, string>): URL {
  const url = new URL(`http://localhost/rest/${view}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

async function callRoute(route: RestRoute, req: NextRequest, view: string): Promise<Response> {
  return route.GET(req, { params: Promise.resolve({ view: [view] }) });
}

/** Authenticated GET returning the parsed JSON envelope. */
async function restJson(route: RestRoute, view: string, params: Record<string, string>) {
  const req = new NextRequest(restUrl(view, { u: username, p: appPassword, f: 'json', ...params }));
  const res = await callRoute(route, req, view);
  return (await res.json())['subsonic-response'];
}

function formPost(view: string, body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(restUrl(view, { f: 'json' }), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body,
  });
}

/** Insert an album with one track (creating the artist if needed); returns the album and track ids. */
function insertAlbum(artist: string, album: string, title: string): { albumId: number; trackId: number } {
  const d = db.getDb();
  d.prepare('INSERT OR IGNORE INTO artists (name) VALUES (?)').run(artist);
  const artistId = (d.prepare('SELECT id FROM artists WHERE name = ?').get(artist) as { id: number }).id;
  const albumId = Number(d.prepare('INSERT INTO albums (name, artist_id) VALUES (?, ?)').run(album, artistId).lastInsertRowid);
  const trackId = Number(
    d
      .prepare('INSERT INTO tracks (title, album_id, artist_id, duration, path) VALUES (?, ?, ?, ?, ?)')
      .run(title, albumId, artistId, 10, path.join(dataDir, `${title}.mp3`)).lastInsertRowid
  );
  return { albumId, trackId };
}

describe('subsonic POST form body', () => {
  it('reads auth and parameters from a small form body', async () => {
    const route: RestRoute = await import('@/app/rest/[...view]/route');
    const body = new URLSearchParams({ u: username, p: appPassword }).toString();
    const res = await callRoute(route, formPost('ping.view', body), 'ping.view');
    expect(res.status).toBe(200);
    expect((await res.json())['subsonic-response'].status).toBe('ok');
  });

  it('refuses a declared Content-Length over the cap before authenticating', async () => {
    const route: RestRoute = await import('@/app/rest/[...view]/route');
    const req = formPost('ping.view', 'u=nobody', { 'content-length': String(65 * 1024) });
    const res = await callRoute(route, req, 'ping.view');
    expect(res.status).toBe(413);
    const body = (await res.json())['subsonic-response'];
    expect(body.status).toBe('failed');
    expect(body.error.code).toBe(0);
  });

  it('stops reading an undeclared (streamed) body once it passes the cap', async () => {
    const route: RestRoute = await import('@/app/rest/[...view]/route');
    // valid credentials inside an oversized body must not help: the body is refused unread
    const body = `u=${username}&p=${appPassword}&pad=${'x'.repeat(65 * 1024)}`;
    const res = await callRoute(route, formPost('ping.view', body), 'ping.view');
    expect(res.status).toBe(413);
    expect((await res.json())['subsonic-response'].error.code).toBe(0);
  });

  it('ignores a non-form body entirely', async () => {
    const route: RestRoute = await import('@/app/rest/[...view]/route');
    const req = new NextRequest(restUrl('ping.view', { u: username, p: appPassword, f: 'json' }), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pad: 'x'.repeat(65 * 1024) }),
    });
    const res = await callRoute(route, req, 'ping.view');
    expect(res.status).toBe(200);
    expect((await res.json())['subsonic-response'].status).toBe('ok');
  });
});

describe('subsonic required parameters', () => {
  it('reports a missing id as error 10 and an unknown id as error 70', async () => {
    const route: RestRoute = await import('@/app/rest/[...view]/route');
    const views = ['getSong', 'getAlbum', 'getArtist', 'getMusicDirectory', 'getCoverArt', 'stream', 'getSimilarSongs2', 'getPlaylist', 'scrobble'];
    for (const view of views) {
      const absent = await restJson(route, `${view}.view`, {});
      expect(absent.status, view).toBe('failed');
      expect(absent.error.code, view).toBe(10);
    }
    expect((await restJson(route, 'getSong.view', { id: 'tr-999999' })).error.code).toBe(70);
    expect((await restJson(route, 'getAlbum.view', { id: 'al-999999' })).error.code).toBe(70);
    expect((await restJson(route, 'getPlaylist.view', { id: 'pl-999999' })).error.code).toBe(70);
  });

  it('reports a missing playlistId on updatePlaylist as error 10', async () => {
    const route: RestRoute = await import('@/app/rest/[...view]/route');
    expect((await restJson(route, 'updatePlaylist.view', { name: 'x' })).error.code).toBe(10);
  });
});

describe('subsonic paging offsets', () => {
  it('clamps a fractional, huge or textual offset to 0 instead of failing the query', async () => {
    const route: RestRoute = await import('@/app/rest/[...view]/route');
    for (const offset of ['1.5', '1e999', 'abc', '-3']) {
      const list = await restJson(route, 'getAlbumList2.view', { type: 'alphabeticalByName', offset });
      expect(list.status, offset).toBe('ok');
      const search = await restJson(route, 'search3.view', { query: '', songOffset: offset, albumOffset: offset, artistOffset: offset });
      expect(search.status, offset).toBe('ok');
      const genre = await restJson(route, 'getSongsByGenre.view', { genre: 'Rock', offset });
      expect(genre.status, offset).toBe('ok');
    }
  });

  it('applies a valid integer offset', async () => {
    const route: RestRoute = await import('@/app/rest/[...view]/route');
    insertAlbum('Paging Artist', 'Paging One', 'p1');
    insertAlbum('Paging Artist', 'Paging Two', 'p2');
    const all = await restJson(route, 'search3.view', { query: 'Paging', albumCount: '10' });
    expect(all.searchResult3.album.map((a: { name: string }) => a.name)).toEqual(['Paging One', 'Paging Two']);
    const page = await restJson(route, 'search3.view', { query: 'Paging', albumCount: '10', albumOffset: '1' });
    expect(page.searchResult3.album.map((a: { name: string }) => a.name)).toEqual(['Paging Two']);
  });
});

describe('subsonic scrobble and played album lists', () => {
  it('lists no recent/frequent albums for a profile that has played nothing', async () => {
    const route: RestRoute = await import('@/app/rest/[...view]/route');
    db.getDb().prepare('DELETE FROM history').run();
    for (const type of ['recent', 'frequent']) {
      const list = await restJson(route, 'getAlbumList2.view', { type });
      expect(list.status, type).toBe('ok');
      expect(list.albumList2.album ?? [], type).toEqual([]);
    }
  });

  it('falls back to now for a scrobble time in seconds and keeps a plausible millisecond time', async () => {
    const route: RestRoute = await import('@/app/rest/[...view]/route');
    const { trackId } = insertAlbum('Scrobbler', 'Timed', 'tick');
    const d = db.getDb();
    const playedAt = (): string =>
      (d.prepare('SELECT played_at FROM history WHERE track_id = ? ORDER BY id DESC LIMIT 1').get(trackId) as { played_at: string })
        .played_at;

    const seconds = String(Math.floor(Date.now() / 1000));
    expect((await restJson(route, 'scrobble.view', { id: `tr-${trackId}`, time: seconds })).status).toBe('ok');
    const fallback = new Date(playedAt() + 'Z').getTime();
    expect(Math.abs(fallback - Date.now())).toBeLessThan(60_000);

    const ms = String(Date.UTC(2024, 0, 2, 3, 4, 5));
    expect((await restJson(route, 'scrobble.view', { id: `tr-${trackId}`, time: ms })).status).toBe('ok');
    expect(playedAt()).toBe('2024-01-02 03:04:05');
  });

  it('lists only albums this profile has played as recent/frequent', async () => {
    const route: RestRoute = await import('@/app/rest/[...view]/route');
    for (const type of ['recent', 'frequent']) {
      const list = await restJson(route, 'getAlbumList2.view', { type });
      expect(list.albumList2.album.map((a: { name: string }) => a.name), type).toEqual(['Timed']);
    }
  });
});
