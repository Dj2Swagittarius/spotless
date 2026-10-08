import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

// getDb() resolves DATA_DIR when the module loads, so the temp dir must exist before any import.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotless-subsonic-'));
process.env.DATA_DIR = dataDir;

type Subsonic = typeof import('@/lib/subsonic');
type Users = typeof import('@/lib/user');
type Auth = typeof import('@/lib/auth');
type Db = typeof import('@/lib/db');

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
