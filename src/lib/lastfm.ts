import crypto from 'crypto';
import { getDb, getSetting, setSetting, delSetting } from './db';

const API_ROOT = 'https://ws.audioscrobbler.com/2.0/';

export interface LastfmSession {
  key: string;
  name: string;
}

export function lastfmApiKey(): string | null {
  return getSetting('lastfm_api_key');
}

export function lastfmConfigured(): boolean {
  return Boolean(getSetting('lastfm_api_key') && getSetting('lastfm_api_secret'));
}

export function lastfmSession(userId: number): LastfmSession | null {
  const raw = getSetting(`lastfm_session:${userId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LastfmSession;
  } catch {
    return null;
  }
}

export function saveLastfmSession(userId: number, session: LastfmSession): void {
  setSetting(`lastfm_session:${userId}`, JSON.stringify(session));
}

export function clearLastfmSession(userId: number): void {
  delSetting(`lastfm_session:${userId}`);
}

/** Last.fm request signature: params sorted by key, concatenated key+value, secret appended, md5 hex. */
function apiSig(params: Record<string, string>, secret: string): string {
  const base = Object.keys(params)
    .sort()
    .map((k) => k + params[k])
    .join('');
  return crypto.createHash('md5').update(base + secret, 'utf8').digest('hex');
}

/** Signed POST to the Last.fm API. Throws on Last.fm error responses. */
async function lastfmCall(method: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const apiKey = getSetting('lastfm_api_key');
  const secret = getSetting('lastfm_api_secret');
  if (!apiKey || !secret) throw new Error('Last.fm API key not configured');

  const signed: Record<string, string> = { ...params, method, api_key: apiKey };
  signed.api_sig = apiSig(signed, secret); // format is excluded from the signature
  const body = new URLSearchParams({ ...signed, format: 'json' });

  const res = await fetch(API_ROOT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.error) throw new Error(`Last.fm ${method} failed: ${data.message ?? res.status}`);
  return data;
}

/** Validates an API key + secret pair by requesting an auth token (signed call). */
export async function testLastfmKeys(apiKey: string, secret: string): Promise<void> {
  const params: Record<string, string> = { method: 'auth.getToken', api_key: apiKey };
  params.api_sig = apiSig(params, secret);
  const body = new URLSearchParams({ ...params, format: 'json' });
  const res = await fetch(API_ROOT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: number; message?: string };
  if (!res.ok || data.error) throw new Error(data.message ?? 'invalid API key or secret');
}

/** Exchanges the callback token for a permanent session key. */
export async function getLastfmSession(token: string): Promise<LastfmSession> {
  const data = (await lastfmCall('auth.getSession', { token })) as {
    session?: { name: string; key: string };
  };
  if (!data.session?.key) throw new Error('Last.fm returned no session');
  return { key: data.session.key, name: data.session.name };
}

interface ScrobbleMeta {
  title: string;
  artist: string;
  album: string;
  duration: number;
}

function trackMeta(trackId: number): ScrobbleMeta | null {
  return (
    (getDb()
      .prepare(
        `SELECT t.title, ar.name AS artist, al.name AS album, t.duration
         FROM tracks t JOIN artists ar ON ar.id = t.artist_id JOIN albums al ON al.id = t.album_id
         WHERE t.id = ?`
      )
      .get(trackId) as ScrobbleMeta | undefined) ?? null
  );
}

function metaParams(meta: ScrobbleMeta): Record<string, string> {
  const params: Record<string, string> = { artist: meta.artist, track: meta.title };
  if (meta.album && meta.album !== 'Unknown Album') params.album = meta.album;
  if (meta.duration > 0) params.duration = String(Math.round(meta.duration));
  return params;
}

/** Fire-and-forget scrobble for a played track. No-op when the user isn't connected. */
export function scrobbleTrack(userId: number, trackId: number, playedAtSec?: number): void {
  if (!lastfmConfigured()) return;
  const session = lastfmSession(userId);
  if (!session) return;
  const meta = trackMeta(trackId);
  if (!meta) return;
  lastfmCall('track.scrobble', {
    ...metaParams(meta),
    timestamp: String(playedAtSec ?? Math.floor(Date.now() / 1000)),
    sk: session.key,
  }).catch((err) => console.error('lastfm scrobble failed:', err));
}

/** Fire-and-forget "now playing" update. No-op when the user isn't connected. */
export function updateNowPlaying(userId: number, trackId: number): void {
  if (!lastfmConfigured()) return;
  const session = lastfmSession(userId);
  if (!session) return;
  const meta = trackMeta(trackId);
  if (!meta) return;
  lastfmCall('track.updateNowPlaying', { ...metaParams(meta), sk: session.key }).catch((err) =>
    console.error('lastfm now-playing failed:', err)
  );
}
