import crypto from 'crypto';
import path from 'path';
import { getDb } from '../db';
import { RAW_MIME } from '../streaming';
import type { Track } from '../types';
import type { LoadRequest } from './client';

/**
 * A Chromecast fetches songs and cover art itself, without the user's session cookie. While a user
 * casts, their receiver gets URLs carrying a random token that unlocks exactly two things: the
 * audio of library tracks and album artwork (/api/cast/<token>/...). Tokens live in memory, last a
 * few hours past their last use, and die with the server.
 */

const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

interface TokenEntry {
  userId: number;
  expires: number;
}

const g = globalThis as typeof globalThis & { __spotlessCastTokensV1?: Map<string, TokenEntry> };
const tokens = (g.__spotlessCastTokensV1 ??= new Map());

function prune(now: number) {
  for (const [t, e] of tokens) if (e.expires <= now) tokens.delete(t);
}

/** The user's current cast token, made or extended as needed. */
export function castToken(userId: number): string {
  const now = Date.now();
  prune(now);
  for (const [t, e] of tokens) {
    if (e.userId === userId) {
      e.expires = now + TOKEN_TTL_MS;
      return t;
    }
  }
  const t = crypto.randomBytes(24).toString('base64url');
  tokens.set(t, { userId, expires: now + TOKEN_TTL_MS });
  return t;
}

/** The user a cast URL's token belongs to, or null when it is unknown or expired. */
export function checkCastToken(token: string): number | null {
  const e = tokens.get(token);
  if (!e) return null;
  if (e.expires <= Date.now()) {
    tokens.delete(token);
    return null;
  }
  return e.userId;
}

/** Formats a Chromecast plays natively; anything else (and an ALAC .m4a that fails) gets MP3. */
const CAST_NATIVE = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wav']);

function trackExt(id: number): string {
  const row = getDb().prepare('SELECT path FROM tracks WHERE id = ?').get(id) as { path: string } | undefined;
  return row ? path.extname(row.path).toLowerCase() : '';
}

function guessStationType(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('.m3u8')) return 'application/x-mpegurl';
  if (u.includes('.aac')) return 'audio/aac';
  if (u.includes('.ogg') || u.includes('.opus')) return 'audio/ogg';
  return 'audio/mpeg';
}

/**
 * The LOAD request for `track` on a receiver that reaches this server at `base` (an origin such as
 * http://192.168.0.10:4000). `transcode` forces an MP3 stream, for files the receiver can't decode.
 */
export function castLoad(
  base: string,
  token: string,
  track: Track,
  opts: { startAt: number; autoplay: boolean; transcode: boolean }
): LoadRequest & { transcoded: boolean } {
  const imageUrl = track.albumId > 0 ? `${base}/api/cast/${token}/art/${track.albumId}` : undefined;
  if (track.streamUrl) {
    return {
      url: track.streamUrl,
      contentType: guessStationType(track.streamUrl),
      live: true,
      title: track.title,
      artist: track.artist,
      album: track.album,
      imageUrl,
      startAt: 0,
      autoplay: opts.autoplay,
      transcoded: false,
    };
  }
  const ext = trackExt(track.id);
  const transcoded = opts.transcode || !CAST_NATIVE.has(ext);
  // a transcode has no byte ranges, so it starts where asked instead of seeking into the file
  const query = transcoded
    ? `?format=mp3&maxBitRate=320${opts.startAt > 0 ? `&offset=${opts.startAt.toFixed(1)}` : ''}`
    : '';
  return {
    url: `${base}/api/cast/${token}/stream/${track.id}${query}`,
    contentType: transcoded ? 'audio/mpeg' : (RAW_MIME[ext] ?? 'audio/mpeg'),
    live: false,
    title: track.title,
    artist: track.artist,
    album: track.album,
    imageUrl,
    duration: track.duration || undefined,
    startAt: transcoded ? 0 : opts.startAt,
    autoplay: opts.autoplay,
    transcoded,
  };
}

/** Test hook. */
export function resetCastTokens() {
  tokens.clear();
}
