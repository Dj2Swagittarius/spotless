import { getDb } from './db';
import type { RadioStation } from './types';

interface StationRow {
  id: number;
  name: string;
  stream_url: string;
  home_page_url: string | null;
}

const toStation = (r: StationRow): RadioStation => ({
  id: r.id,
  name: r.name,
  streamUrl: r.stream_url,
  homePageUrl: r.home_page_url,
});

export function listStations(): RadioStation[] {
  return (
    getDb()
      .prepare('SELECT id, name, stream_url, home_page_url FROM radio_stations ORDER BY name COLLATE NOCASE')
      .all() as StationRow[]
  ).map(toStation);
}

export function getStation(id: number): RadioStation | null {
  const row = getDb()
    .prepare('SELECT id, name, stream_url, home_page_url FROM radio_stations WHERE id = ?')
    .get(id) as StationRow | undefined;
  return row ? toStation(row) : null;
}

export function createStation(name: string, streamUrl: string, homePageUrl?: string | null): RadioStation {
  const res = getDb()
    .prepare('INSERT INTO radio_stations (name, stream_url, home_page_url) VALUES (?, ?, ?)')
    .run(name, streamUrl, homePageUrl || null);
  return { id: Number(res.lastInsertRowid), name, streamUrl, homePageUrl: homePageUrl || null };
}

export function updateStation(id: number, name: string, streamUrl: string, homePageUrl?: string | null): boolean {
  return (
    getDb()
      .prepare('UPDATE radio_stations SET name = ?, stream_url = ?, home_page_url = ? WHERE id = ?')
      .run(name, streamUrl, homePageUrl || null, id).changes > 0
  );
}

export function deleteStation(id: number): boolean {
  return getDb().prepare('DELETE FROM radio_stations WHERE id = ?').run(id).changes > 0;
}

// Loopback, RFC 1918, link-local and the unspecified address. The URL parser already folds
// decimal/octal/hex spellings (2130706433, 0x7f.1) into dotted quads, so matching the
// normalised hostname is enough.
const PRIVATE_V4 = /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** Literal IP addresses that point back at this host or the LAN (no DNS: hostnames pass). */
function isPrivateAddress(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (PRIVATE_V4.test(h)) return true;
  if (!h.startsWith('[')) return false;
  const v6 = h.slice(1, -1);
  if (v6 === '::' || v6 === '::1') return true;
  // fc00::/7 unique-local, fe80::/10 link-local
  if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)) return true;
  // IPv4-mapped: ::ffff:10.0.0.1 or ::ffff:a00:1
  const dotted = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return PRIVATE_V4.test(dotted[1]);
  const hex = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return PRIVATE_V4.test(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  return false;
}

/**
 * Station URLs must be http(s) — guards the stream proxy against file:/ etc. — and must not
 * point at private addresses, or the proxy becomes a way to read anything on the LAN.
 * ALLOW_PRIVATE_STREAM_URLS=1 opts back in for a local icecast box.
 */
export function validStreamUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (process.env.ALLOW_PRIVATE_STREAM_URLS === '1') return true;
    return !isPrivateAddress(u.hostname);
  } catch {
    return false;
  }
}
