import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getDb, getSetting, setSetting, delSetting } from './db';
import { buildLocalIndex, norm, type WantedTrack } from './playlistMatch';

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
/** False when no Spotify app is configured (SPOTIFY_CLIENT_ID env) — connect flow unavailable. */
export const hasSpotifyClient = CLIENT_ID.length > 0;

const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:3000/api/spotify/callback';
const REDIRECT_ORIGIN_SETTING = 'spotify_redirect_origin';
const CALLBACK_PATH = '/api/spotify/callback';
const SCOPES = 'user-top-read user-library-read playlist-read-private playlist-read-collaborative';

export type SpotifyRedirectSource = 'setting' | 'environment' | 'default';

export interface SpotifyRedirectConfig {
  /** Saved Settings-page override. Empty when no UI override is stored. */
  customOrigin: string;
  /** Origin actually used for login/callback redirects. */
  origin: string;
  /** Exact URI sent to Spotify's authorize and token endpoints. */
  redirectUri: string;
  source: SpotifyRedirectSource;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function assertSpotifyTransport(url: URL): void {
  if (url.hostname.toLowerCase() === 'localhost') {
    throw new Error('Spotify does not allow localhost. Use 127.0.0.1 for local use or an HTTPS domain.');
  }
  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:' && isLoopbackHostname(url.hostname)) return;
  throw new Error('Spotify requires HTTPS for non-loopback redirect URIs.');
}

/**
 * Normalize the Settings-page value. Users enter only an origin/domain, for
 * example music.example.com or https://music.example.com.
 */
export function normalizeSpotifyOrigin(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('Enter a valid domain, for example music.example.com');
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Enter only the public domain/origin — no credentials, query string or fragment.');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('Enter only the public domain, not /api/spotify/callback. Spotless adds that path automatically.');
  }

  assertSpotifyTransport(url);
  return url.origin;
}

/** Validate a full callback URI, used for SPOTIFY_REDIRECT_URI and the OAuth cookie. */
export function normalizeSpotifyRedirectUri(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('SPOTIFY_REDIRECT_URI must be a valid absolute URL.');
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error('SPOTIFY_REDIRECT_URI must not contain credentials, a query string or a fragment.');
  }
  if (url.pathname !== CALLBACK_PATH) {
    throw new Error(`SPOTIFY_REDIRECT_URI must end exactly with ${CALLBACK_PATH}`);
  }

  assertSpotifyTransport(url);
  return `${url.origin}${CALLBACK_PATH}`;
}

function envRedirectUri(): string | null {
  const raw = process.env.SPOTIFY_REDIRECT_URI?.trim();
  if (!raw) return null;
  try {
    return normalizeSpotifyRedirectUri(raw);
  } catch (err) {
    console.warn(`spotify: ignoring invalid SPOTIFY_REDIRECT_URI: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Redirect precedence:
 * 1) Settings-page override
 * 2) SPOTIFY_REDIRECT_URI environment variable
 * 3) built-in loopback default
 */
export function getSpotifyRedirectConfig(): SpotifyRedirectConfig {
  const stored = getSetting(REDIRECT_ORIGIN_SETTING);
  if (stored) {
    try {
      const origin = normalizeSpotifyOrigin(stored);
      return {
        customOrigin: origin,
        origin,
        redirectUri: `${origin}${CALLBACK_PATH}`,
        source: 'setting',
      };
    } catch (err) {
      console.warn(`spotify: ignoring invalid saved redirect origin: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const envUri = envRedirectUri();
  if (envUri) {
    return {
      customOrigin: '',
      origin: new URL(envUri).origin,
      redirectUri: envUri,
      source: 'environment',
    };
  }

  return {
    customOrigin: '',
    origin: new URL(DEFAULT_REDIRECT_URI).origin,
    redirectUri: DEFAULT_REDIRECT_URI,
    source: 'default',
  };
}

/** Save or clear the Settings-page override and return the resulting effective config. */
export function saveSpotifyRedirectOrigin(input: string): SpotifyRedirectConfig {
  const origin = normalizeSpotifyOrigin(input);
  if (origin) setSetting(REDIRECT_ORIGIN_SETTING, origin);
  else delSetting(REDIRECT_ORIGIN_SETTING);
  return getSpotifyRedirectConfig();
}

const tokensKey = (u: number) => `spotify_tokens:${u}`;
const tasteKey = (u: number) => `spotify_taste:${u}`;
const NOT_CONNECTED = 'Spotify not connected';

/** A non-2xx answer from Spotify's token or Web API. 401 means the stored grant is unusable. */
export class SpotifyApiError extends Error {
  readonly status: number;
  /** Seconds to wait, from Spotify's Retry-After header on 429. */
  readonly retryAfter?: number;

  constructor(message: string, status: number, retryAfter?: number) {
    super(message);
    this.name = 'SpotifyApiError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** Translate a failure from this module into the JSON error a route should return. */
export function spotifyErrorResponse(err: unknown): NextResponse {
  if (err instanceof SpotifyApiError) {
    if (err.status === 401) return NextResponse.json({ error: 'Spotify reconnect required' }, { status: 401 });
    if (err.status === 429) {
      const retryAfter = err.retryAfter ?? 30;
      return NextResponse.json(
        { error: `Spotify rate limit reached; retry in ${retryAfter}s`, retryAfter },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }
    console.error('spotify request failed:', err.message);
    return NextResponse.json({ error: `Spotify request failed (HTTP ${err.status})` }, { status: 502 });
  }
  const message = err instanceof Error ? err.message : String(err);
  if (message === NOT_CONNECTED) return NextResponse.json({ error: message }, { status: 400 });
  console.error('spotify request failed:', err);
  return NextResponse.json({ error: 'Spotify is unreachable right now; try again later' }, { status: 502 });
}

function retryAfterFrom(res: Response): number | undefined {
  const raw = res.headers.get('retry-after');
  if (raw === null) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : undefined;
}

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
  const state = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge, state };
}

// OAuth bookkeeping lives server-side so the browser can't choose which profile a
// Spotify account lands on. Both maps are single-use and short-lived.
interface PendingOAuth {
  userId: number;
  verifier: string;
  redirectUri: string;
  expiresAt: number;
}
const oauthGlobal = globalThis as typeof globalThis & {
  __spotlessSpotifyOAuth?: { pending: Map<string, PendingOAuth>; handoffs: Map<string, { userId: number; expiresAt: number }> };
};
const oauth = (oauthGlobal.__spotlessSpotifyOAuth ??= { pending: new Map(), handoffs: new Map() });

function sweep<T extends { expiresAt: number }>(m: Map<string, T>): void {
  const now = Date.now();
  for (const [k, v] of m) if (v.expiresAt <= now) m.delete(k);
}

function take<T extends { expiresAt: number }>(m: Map<string, T>, key: string | null | undefined): T | null {
  if (!key) return null;
  const v = m.get(key);
  m.delete(key);
  return v && v.expiresAt > Date.now() ? v : null;
}

/**
 * One-time ticket carrying the signed-in profile across to the configured redirect
 * origin, where this browser may have no session cookie yet.
 */
export function createHandoff(userId: number): string {
  sweep(oauth.handoffs);
  const nonce = crypto.randomBytes(32).toString('base64url');
  oauth.handoffs.set(nonce, { userId, expiresAt: Date.now() + 2 * 60_000 });
  return nonce;
}

export function takeHandoff(nonce: string | null): number | null {
  return take(oauth.handoffs, nonce)?.userId ?? null;
}

/** Start an authorization for userId; returns the state and the Spotify URL to send the browser to. */
export function beginOAuth(userId: number, redirectUri: string): { state: string; url: string } {
  sweep(oauth.pending);
  const { verifier, challenge, state } = makePkce();
  oauth.pending.set(state, { userId, verifier, redirectUri, expiresAt: Date.now() + 10 * 60_000 });
  return { state, url: authUrl(challenge, redirectUri, state) };
}

export function takeOAuth(state: string | null): PendingOAuth | null {
  return take(oauth.pending, state);
}

export function authUrl(challenge: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

async function tokenRequest(userId: number, body: Record<string, string>): Promise<Tokens> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...body }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    // Spotify answers a revoked or already-used refresh token with 400 invalid_grant (or 401).
    // Those tokens are dead: drop them so spotifyStatus() reports disconnected and the UI
    // offers Connect again instead of failing every import until the user disconnects by hand.
    const revoked =
      body.grant_type === 'refresh_token' && (res.status === 401 || (res.status === 400 && detail.includes('invalid_grant')));
    if (revoked) {
      delSetting(tokensKey(userId));
      throw new SpotifyApiError('Spotify authorization is no longer valid; reconnect required', 401);
    }
    throw new SpotifyApiError(`Spotify token request failed (${res.status}): ${detail}`, res.status, retryAfterFrom(res));
  }
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

export async function exchangeCode(userId: number, code: string, verifier: string, redirectUri: string): Promise<void> {
  await tokenRequest(userId, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
}

// Refresh tokens are single-use: if autosync and a page load both refresh at once, the
// second request fails with invalid_grant and would wrongly disconnect the profile. One
// in-flight refresh per user is shared by every concurrent caller instead.
const refreshGlobal = globalThis as typeof globalThis & { __spotlessSpotifyRefresh?: Map<number, Promise<Tokens>> };
const refreshing = (refreshGlobal.__spotlessSpotifyRefresh ??= new Map());

async function accessToken(userId: number): Promise<string | null> {
  const tokens = loadTokens(userId);
  if (!tokens) return null;
  if (Date.now() < tokens.expires_at) return tokens.access_token;
  if (!tokens.refresh_token) return null;

  let inflight = refreshing.get(userId);
  if (!inflight) {
    inflight = tokenRequest(userId, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token }).finally(() =>
      refreshing.delete(userId)
    );
    refreshing.set(userId, inflight);
  }
  return (await inflight).access_token;
}

async function api<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new SpotifyApiError(`Spotify ${path.split('?')[0]} failed (${res.status})`, res.status, retryAfterFrom(res));
  }
  return (await res.json()) as T;
}

/**
 * Re-import the user's taste seeds. Every page must succeed before anything is written:
 * a partial import would replace a good taste profile with a thin one and throw away the
 * Discover cache built from it.
 */
export async function importTaste(userId: number): Promise<SpotifyTaste> {
  const token = await accessToken(userId);
  if (!token) throw new Error(NOT_CONNECTED);

  const top = new Set<string>();
  for (const range of ['medium_term', 'long_term']) {
    const page = await api<{ items: { name: string }[] }>(token, `/me/top/artists?limit=50&time_range=${range}`);
    for (const a of page.items ?? []) top.add(a.name);
  }

  const saved = new Set<string>();
  for (let offset = 0; offset < 200; offset += 50) {
    const page = await api<{ items: { track: { artists: { name: string }[] } }[]; next: string | null }>(
      token,
      `/me/tracks?limit=50&offset=${offset}`
    );
    for (const item of page.items ?? []) for (const a of item.track?.artists ?? []) saved.add(a.name);
    if (!page.next) break;
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
  if (!token) throw new Error(NOT_CONNECTED);
  const out: SpotifyPlaylistInfo[] = [];
  for (let offset = 0; offset < 250; offset += 50) {
    const page = await api<{ items: ({ id: string; name: string; tracks?: { total?: number } | null } | null)[]; next: string | null }>(
      token,
      `/me/playlists?limit=50&offset=${offset}`
    );
    for (const p of page.items ?? []) {
      if (!p?.id) continue; // Spotify returns null entries for deleted/inaccessible playlists
      out.push({ id: p.id, name: p.name ?? 'Untitled', trackCount: p.tracks?.total ?? 0 });
    }
    if (!page.next) break;
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
  if (!token) throw new Error(NOT_CONNECTED);
  const out: SpotifyPlaylistTrack[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await api<{
      items: { track: { name: string; duration_ms: number; artists: { name: string }[]; album: { name: string } } | null }[];
      next: string | null;
    }>(token, `/playlists/${encodeURIComponent(playlistId)}/tracks?limit=100&offset=${offset}&fields=next,items(track(name,duration_ms,artists(name),album(name)))`);
    for (const item of page.items ?? []) {
      const t = item?.track;
      if (!t?.name) continue; // deleted/local-only entries
      out.push({
        title: t.name,
        artist: t.artists?.[0]?.name ?? '',
        album: t.album?.name ?? '',
        durationSec: Math.round((t.duration_ms ?? 0) / 1000),
      });
    }
    if (!page.next) break;
  }
  return out;
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
  const index = buildLocalIndex(db);

  // keep Spotify's order: matched songs and placeholders (songs not in the
  // library) share one position space, so the playlist shows what's missing
  const entries: { position: number; trackId?: number; missing?: WantedTrack }[] = [];
  const missing: PlaylistImportResult['missing'] = [];
  const seenMissing = new Set<string>();
  wanted.forEach((w, i) => {
    const trackId = index.find(w);
    if (trackId !== undefined) {
      entries.push({ position: i, trackId });
      return;
    }
    const key = `${norm(w.artist)}|${norm(w.title)}`;
    if (seenMissing.has(key)) return;
    seenMissing.add(key);
    entries.push({ position: i, missing: w });
    missing.push({ title: w.title, artist: w.artist, album: w.album });
  });
  const matched = entries.filter((e) => e.trackId !== undefined).length;

  const insert = db.transaction(() => {
    const res = db
      .prepare('INSERT INTO playlists (name, description, user_id) VALUES (?, ?, ?)')
      .run(name, `Imported from Spotify (${matched}/${wanted.length} matched)`, userId);
    const playlistId = Number(res.lastInsertRowid);
    const addTrack = db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)');
    const addPlaceholder = db.prepare(
      'INSERT INTO playlist_placeholders (playlist_id, position, title, artist, album, duration) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const e of entries) {
      if (e.trackId !== undefined) addTrack.run(playlistId, e.trackId, e.position);
      else if (e.missing)
        addPlaceholder.run(playlistId, e.position, e.missing.title, e.missing.artist, e.missing.album, e.missing.durationSec);
    }
    return playlistId;
  });

  return { playlistId: insert(), name, matched, total: wanted.length, missing };
}
