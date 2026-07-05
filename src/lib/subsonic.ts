import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { NextRequest } from 'next/server';
import { getDb } from './db';
import { getMusicDir } from './scanner';

/**
 * Subsonic-compatible API support (see /rest/[...view]/route.ts).
 * Lets native mobile apps (Symfonium, DSub, Substreamer, play:Sub …) browse,
 * stream, transcode and offline-cache the library. Each profile gets a generated
 * "app password" — Subsonic clients authenticate with profile name + that password.
 */

export const SUBSONIC_VERSION = '1.16.1';
const SERVER = 'spotless';

// ---------- auth ----------

export interface SubUser {
  id: number;
  name: string;
  app_password: string | null;
}

export function getAppPassword(userId: number): string {
  const db = getDb();
  const row = db.prepare('SELECT app_password FROM users WHERE id = ?').get(userId) as
    | { app_password: string | null }
    | undefined;
  if (row?.app_password) return row.app_password;
  const pw = crypto.randomBytes(9).toString('base64url');
  db.prepare('UPDATE users SET app_password = ? WHERE id = ?').run(pw, userId);
  return pw;
}

export function regenerateAppPassword(userId: number): string {
  const pw = crypto.randomBytes(9).toString('base64url');
  getDb().prepare('UPDATE users SET app_password = ? WHERE id = ?').run(pw, userId);
  return pw;
}

/** Resolve the acting user from Subsonic auth params (u + t/s token, or u + p password). */
export function authenticate(req: NextRequest): SubUser | null {
  const q = req.nextUrl.searchParams;
  const username = q.get('u');
  if (!username) return null;
  const user = getDb()
    .prepare('SELECT id, name, app_password FROM users WHERE name = ? COLLATE NOCASE')
    .get(username) as SubUser | undefined;
  if (!user?.app_password) return null;

  const token = q.get('t');
  const salt = q.get('s');
  if (token && salt) {
    const expect = crypto.createHash('md5').update(user.app_password + salt).digest('hex');
    return token.toLowerCase() === expect ? user : null;
  }
  let password = q.get('p');
  if (password) {
    if (password.startsWith('enc:')) password = Buffer.from(password.slice(4), 'hex').toString('utf8');
    return password === user.app_password ? user : null;
  }
  return null;
}

// ---------- response envelopes ----------

type Body = Record<string, unknown>;

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Subsonic's JSON structure maps 1:1 to its XML: primitives → attributes, objects/arrays → children, `value` → text. */
function toXml(name: string, obj: unknown): string {
  if (obj === null || obj === undefined) return `<${name}/>`;
  if (Array.isArray(obj)) return obj.map((item) => toXml(name, item)).join('');
  if (typeof obj !== 'object') return `<${name}>${xmlEscape(String(obj))}</${name}>`;

  const attrs: string[] = [];
  const children: string[] = [];
  let text = '';
  for (const [k, v] of Object.entries(obj as Body)) {
    if (v === null || v === undefined) continue;
    if (k === 'value') text = xmlEscape(String(v));
    else if (Array.isArray(v) || typeof v === 'object') children.push(toXml(k, v));
    else attrs.push(`${k}="${xmlEscape(String(v))}"`);
  }
  const open = `<${name}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
  if (!children.length && !text) return `${open}/>`;
  return `${open}>${text}${children.join('')}</${name}>`;
}

export function subsonicResponse(req: NextRequest, body: Body = {}, status: 'ok' | 'failed' = 'ok'): Response {
  const payload = { status, version: SUBSONIC_VERSION, type: SERVER, serverVersion: '0.2.0', ...body };
  const format = req.nextUrl.searchParams.get('f') ?? 'xml';
  if (format.startsWith('json')) {
    const json = JSON.stringify({ 'subsonic-response': payload });
    if (format === 'jsonp') {
      const cb = req.nextUrl.searchParams.get('callback') ?? 'callback';
      return new Response(`${cb}(${json});`, { headers: { 'Content-Type': 'application/javascript' } });
    }
    return new Response(json, { headers: { 'Content-Type': 'application/json' } });
  }
  const inner = toXml('subsonic-response', { xmlns: 'http://subsonic.org/restapi', ...payload });
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${inner}`, {
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

export function subsonicError(req: NextRequest, code: number, message: string): Response {
  return subsonicResponse(req, { error: { code, message } }, 'failed');
}

// ---------- id namespaces ----------

export const artistSid = (id: number) => `ar-${id}`;
export const albumSid = (id: number) => `al-${id}`;
export const trackSid = (id: number) => `tr-${id}`;
export const playlistSid = (id: number) => `pl-${id}`;

export function parseSid(sid: string | null): { kind: 'artist' | 'album' | 'track' | 'playlist'; id: number } | null {
  if (!sid) return null;
  const m = sid.match(/^(ar|al|tr|pl)-(\d+)$/);
  if (!m) return null;
  const kind = m[1] === 'ar' ? 'artist' : m[1] === 'al' ? 'album' : m[1] === 'tr' ? 'track' : 'playlist';
  return { kind, id: Number(m[2]) };
}

// ---------- serializers ----------

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
};

export interface TrackRow {
  id: number;
  title: string;
  duration: number;
  track_no: number;
  disc_no: number;
  genre: string | null;
  path: string;
  mtime: number;
  album_id: number;
  artist_id: number;
  album: string;
  artist: string;
  year: number | null;
  starred: string | null;
  playCount: number | null;
}

export const TRACK_SQL = `
  SELECT t.id, t.title, t.duration, t.track_no, t.disc_no, t.genre, t.path, t.mtime,
         t.album_id, t.artist_id, al.name AS album, ar.name AS artist, al.year,
         (SELECT liked_at FROM likes l WHERE l.track_id = t.id AND l.user_id = @uid) AS starred,
         (SELECT COUNT(*) FROM history h WHERE h.track_id = t.id) AS playCount
  FROM tracks t JOIN albums al ON al.id = t.album_id JOIN artists ar ON ar.id = t.artist_id
`;

export function songJson(t: TrackRow): Body {
  const suffix = path.extname(t.path).slice(1).toLowerCase();
  let size = 0;
  try {
    size = fs.statSync(t.path).size;
  } catch {
    // file missing; clients tolerate size 0
  }
  const duration = Math.round(t.duration || 0);
  let rel = t.path;
  try {
    rel = path.relative(getMusicDir(), t.path).split(path.sep).join('/');
  } catch {
    // keep absolute path
  }
  return {
    id: trackSid(t.id),
    parent: albumSid(t.album_id),
    isDir: false,
    title: t.title,
    album: t.album,
    artist: t.artist,
    track: t.track_no || undefined,
    discNumber: t.disc_no || undefined,
    year: t.year ?? undefined,
    genre: t.genre ?? undefined,
    coverArt: albumSid(t.album_id),
    size,
    contentType: MIME[suffix] ?? 'application/octet-stream',
    suffix,
    duration,
    bitRate: duration > 0 && size > 0 ? Math.round((size * 8) / duration / 1000) : undefined,
    path: rel,
    playCount: t.playCount ?? undefined,
    starred: t.starred ? new Date(t.starred + 'Z').toISOString() : undefined,
    created: new Date(t.mtime || 0).toISOString(),
    albumId: albumSid(t.album_id),
    artistId: artistSid(t.artist_id),
    type: 'music',
  };
}

export interface AlbumRow {
  id: number;
  name: string;
  artist_id: number;
  artist: string;
  year: number | null;
  songCount: number;
  duration: number;
  created: number;
  genre: string | null;
}

export const ALBUM_SQL = `
  SELECT al.id, al.name, al.artist_id, ar.name AS artist, al.year,
         COUNT(t.id) AS songCount, COALESCE(SUM(t.duration), 0) AS duration,
         COALESCE(MAX(t.mtime), 0) AS created,
         MAX(t.genre) AS genre
  FROM albums al JOIN artists ar ON ar.id = al.artist_id LEFT JOIN tracks t ON t.album_id = al.id
`;

export function albumJson(a: AlbumRow): Body {
  return {
    id: albumSid(a.id),
    parent: artistSid(a.artist_id),
    isDir: true,
    name: a.name,
    title: a.name,
    album: a.name,
    artist: a.artist,
    year: a.year ?? undefined,
    genre: a.genre ?? undefined,
    coverArt: albumSid(a.id),
    songCount: a.songCount,
    duration: Math.round(a.duration),
    created: new Date(a.created || 0).toISOString(),
    artistId: artistSid(a.artist_id),
  };
}

export interface ArtistRow {
  id: number;
  name: string;
  albumCount: number;
}

export function artistJson(a: ArtistRow): Body {
  return {
    id: artistSid(a.id),
    name: a.name,
    albumCount: a.albumCount,
    coverArt: artistSid(a.id),
  };
}
