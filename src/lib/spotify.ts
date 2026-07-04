import crypto from 'crypto';
import { getDb, getSetting, setSetting, delSetting } from './db';

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
/** False when no Spotify app is configured (SPOTIFY_CLIENT_ID env) — connect flow unavailable. */
export const hasSpotifyClient = CLIENT_ID.length > 0;
// Spotify only allows loopback (127.0.0.1) or HTTPS redirect URIs, so the
// connect flow must be opened via http://127.0.0.1:3000 — see the login route.
export const REDIRECT_URI = 'http://127.0.0.1:3000/api/spotify/callback';
const SCOPES = 'user-top-read user-library-read playlist-read-private playlist-read-collaborative';

const tokensKey = (u: number) => `spotify_tokens:${u}`;
const tasteKey = (u: number) => `spotify_taste:${u}`;

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

export interface SpotifyTaste {
  topArtists: string[];
  savedArtists: string[];
  importedAt: string;
}

export function makePkce() {
  const verifier = crypto.randomBytes(64).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function authUrl(challenge: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

async function tokenRequest(userId: number, body: Record<string, string>): Promise<Tokens> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...body }),
  });
  if (!res.ok) throw new Error(`Spotify token request failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const prev = loadTokens(userId);
  const tokens: Tokens = {
    access_token: data.access_token,
    // refresh responses may omit refresh_token; keep the old one
    refresh_token: data.refresh_token || prev?.refresh_token || '',
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
  };
  setSetting(tokensKey(userId), JSON.stringify(tokens));
  return tokens;
}

function loadTokens(userId: number): Tokens | null {
  const raw = getSetting(tokensKey(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function exchangeCode(userId: number, code: string, verifier: string): Promise<void> {
  await tokenRequest(userId, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
}

async function accessToken(userId: number): Promise<string | null> {
  let tokens = loadTokens(userId);
  if (!tokens) return null;
  if (Date.now() >= tokens.expires_at) {
    if (!tokens.refresh_token) return null;
    tokens = await tokenRequest(userId, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
  }
  return tokens.access_token;
}

async function api<T>(token: string, path: string): Promise<T | null> {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export async function importTaste(userId: number): Promise<SpotifyTaste> {
  const token = await accessToken(userId);
  if (!token) throw new Error('Spotify not connected');

  const top = new Set<string>();
  for (const range of ['medium_term', 'long_term']) {
    const page = await api<{ items: { name: string }[] }>(token, `/me/top/artists?limit=50&time_range=${range}`);
    for (const a of page?.items ?? []) top.add(a.name);
  }

  const saved = new Set<string>();
  for (let offset = 0; offset < 200; offset += 50) {
    const page = await api<{ items: { track: { artists: { name: string }[] } }[]; next: string | null }>(
      token,
      `/me/tracks?limit=50&offset=${offset}`
    );
    for (const item of page?.items ?? []) for (const a of item.track.artists) saved.add(a.name);
    if (!page?.next) break;
  }

  const taste: SpotifyTaste = {
    topArtists: [...top],
    savedArtists: [...saved],
    importedAt: new Date().toISOString(),
  };
  setSetting(tasteKey(userId), JSON.stringify(taste));
  delSetting(`discover_cache:${userId}`); // seeds changed; rebuild suggestions on next visit
  return taste;
}

export function getTaste(userId: number): SpotifyTaste | null {
  const raw = getSetting(tasteKey(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function spotifyStatus(userId: number) {
  const taste = getTaste(userId);
  return {
    connected: loadTokens(userId) !== null,
    importedAt: taste?.importedAt ?? null,
    topCount: taste?.topArtists.length ?? 0,
    savedCount: taste?.savedArtists.length ?? 0,
  };
}

export function disconnect(userId: number): void {
  delSetting(tokensKey(userId));
  delSetting(tasteKey(userId));
  delSetting(`discover_cache:${userId}`);
}

export interface SpotifyPlaylistInfo {
  id: string;
  name: string;
  trackCount: number;
}

export async function listPlaylists(userId: number): Promise<SpotifyPlaylistInfo[]> {
  const token = await accessToken(userId);
  if (!token) throw new Error('Spotify not connected');
  const out: SpotifyPlaylistInfo[] = [];
  for (let offset = 0; offset < 250; offset += 50) {
    const page = await api<{ items: ({ id: string; name: string; tracks?: { total?: number } | null } | null)[]; next: string | null }>(
      token,
      `/me/playlists?limit=50&offset=${offset}`
    );
    for (const p of page?.items ?? []) {
      if (!p?.id) continue; // Spotify returns null entries for deleted/inaccessible playlists
      out.push({ id: p.id, name: p.name ?? 'Untitled', trackCount: p.tracks?.total ?? 0 });
    }
    if (!page?.next) break;
  }
  return out;
}

interface SpotifyPlaylistTrack {
  title: string;
  artist: string;
  album: string;
  durationSec: number;
}

async function playlistTracks(userId: number, playlistId: string): Promise<SpotifyPlaylistTrack[]> {
  const token = await accessToken(userId);
  if (!token) throw new Error('Spotify not connected');
  const out: SpotifyPlaylistTrack[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await api<{
      items: { track: { name: string; duration_ms: number; artists: { name: string }[]; album: { name: string } } | null }[];
      next: string | null;
    }>(token, `/playlists/${playlistId}/tracks?limit=100&offset=${offset}&fields=next,items(track(name,duration_ms,artists(name),album(name)))`);
    for (const item of page?.items ?? []) {
      const t = item?.track;
      if (!t?.name) continue; // deleted/local-only entries
      out.push({
        title: t.name,
        artist: t.artists?.[0]?.name ?? '',
        album: t.album?.name ?? '',
        durationSec: Math.round((t.duration_ms ?? 0) / 1000),
      });
    }
    if (!page?.next) break;
  }
  return out;
}

/** Normalize for matching: lowercase, drop "(feat. …)" / bracket noise and punctuation. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\((feat|ft|with|remaster)[^)]*\)|\[[^\]]*\]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface PlaylistImportResult {
  playlistId: number;
  name: string;
  matched: number;
  total: number;
  missing: { title: string; artist: string; album: string }[];
}

export async function importPlaylist(userId: number, spotifyPlaylistId: string, name: string): Promise<PlaylistImportResult> {
  const wanted = await playlistTracks(userId, spotifyPlaylistId);
  const db = getDb();

  const local = db
    .prepare(
      `SELECT t.id, t.title, t.duration, a.name AS artist
       FROM tracks t JOIN artists a ON a.id = t.artist_id`
    )
    .all() as { id: number; title: string; duration: number; artist: string }[];

  const byArtistTitle = new Map<string, number>();
  const byTitle = new Map<string, { id: number; duration: number }[]>();
  for (const t of local) {
    const titleKey = norm(t.title);
    byArtistTitle.set(`${norm(t.artist)}|${titleKey}`, t.id);
    const list = byTitle.get(titleKey) ?? [];
    list.push({ id: t.id, duration: t.duration });
    byTitle.set(titleKey, list);
  }

  const matchedIds: number[] = [];
  const missing: PlaylistImportResult['missing'] = [];
  for (const w of wanted) {
    const exact = byArtistTitle.get(`${norm(w.artist)}|${norm(w.title)}`);
    if (exact !== undefined) {
      matchedIds.push(exact);
      continue;
    }
    // fallback: same title and duration within 5s (covers artist-name spelling differences)
    const candidates = byTitle.get(norm(w.title)) ?? [];
    const close = candidates.find((c) => Math.abs(c.duration - w.durationSec) <= 5);
    if (close) matchedIds.push(close.id);
    else missing.push({ title: w.title, artist: w.artist, album: w.album });
  }

  const insert = db.transaction(() => {
    const res = db
      .prepare('INSERT INTO playlists (name, description, user_id) VALUES (?, ?, ?)')
      .run(name, `Imported from Spotify (${matchedIds.length}/${wanted.length} matched)`, userId);
    const playlistId = Number(res.lastInsertRowid);
    const add = db.prepare(
      'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)'
    );
    matchedIds.forEach((trackId, i) => add.run(playlistId, trackId, i));
    return playlistId;
  });

  return { playlistId: insert(), name, matched: matchedIds.length, total: wanted.length, missing };
}
