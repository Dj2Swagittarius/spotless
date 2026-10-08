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
