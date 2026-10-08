import dns from 'dns';
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

/**
 * A bare IP (dotted quad, or IPv6 without brackets, as dns.lookup returns them) that points back
 * at this host or the LAN. Shared by the literal check and the resolved-address check so both
 * agree on what "private" means.
 */
function isPrivateIp(address: string): boolean {
  const a = address.toLowerCase();
  if (PRIVATE_V4.test(a)) return true;
  if (!a.includes(':')) return false;
  const v6 = a;
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

/** Literal IP addresses that point back at this host or the LAN (no DNS: hostnames pass). */
function isPrivateAddress(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  // the URL parser keeps IPv6 literals in brackets; strip them for the shared predicate
  return isPrivateIp(h.startsWith('[') ? h.slice(1, -1) : h);
}

export const PRIVATE_STREAM_URL_ERROR =
  'LAN/private stream addresses are blocked; set ALLOW_PRIVATE_STREAM_URLS=1 to allow them';

/**
 * Station URLs must be http(s) — guards the stream proxy against file:/ etc. — and must not
 * point at private addresses, or the proxy becomes a way to read anything on the LAN.
 * ALLOW_PRIVATE_STREAM_URLS=1 opts back in for a local icecast box.
 * Returns null when the URL is usable, otherwise a message that says which rule rejected it,
 * so an admin typing a 192.168.x.x box learns about the opt-in instead of "not a valid URL".
 */
export function streamUrlError(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'a valid http(s) stream URL is required';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'a valid http(s) stream URL is required';
  if (process.env.ALLOW_PRIVATE_STREAM_URLS === '1') return null;
  return isPrivateAddress(u.hostname) ? PRIVATE_STREAM_URL_ERROR : null;
}

export function validStreamUrl(url: string): boolean {
  return streamUrlError(url) === null;
}

export const PRIVATE_STREAM_HOST_ERROR =
  'stream hostname resolves to a LAN/private address and is blocked; set ALLOW_PRIVATE_STREAM_URLS=1 to allow it';
export const UNRESOLVED_STREAM_HOST_ERROR = 'stream hostname could not be resolved';

/**
 * The resolving half of the stream-URL check. streamUrlError() only sees literals, so a hostname
 * whose A/AAAA record points at 127.0.0.1 or the LAN would still make the proxy relay it. This
 * looks the name up and rejects (throws an Error whose message is safe to show the admin) when
 * ANY resolved address is private, so a name with one public and one private record cannot slip
 * through; a name that does not resolve at all is refused too, since it cannot stream anyway.
 * ALLOW_PRIVATE_STREAM_URLS=1 skips the lookup, matching the literal opt-in.
 *
 * Residual window: fetch() does its own lookup moments later, so a resolver that answers with a
 * public address here and a private one on the next query (DNS rebinding with a 0 TTL) is not
 * caught. Closing it needs the resolved address pinned into the connection, which fetch does not
 * expose; calling this again right before each fetch narrows the window to the connect itself.
 */
export async function assertPublicStreamUrl(url: string): Promise<void> {
  const literalError = streamUrlError(url);
  if (literalError) throw new Error(literalError);
  if (process.env.ALLOW_PRIVATE_STREAM_URLS === '1') return;
  // the scheme check above guarantees this parses; the parser keeps IPv6 literals in brackets
  const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '');
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch {
    throw new Error(UNRESOLVED_STREAM_HOST_ERROR);
  }
  if (addresses.length === 0) throw new Error(UNRESOLVED_STREAM_HOST_ERROR);
  if (addresses.some((a) => isPrivateIp(a.address))) throw new Error(PRIVATE_STREAM_HOST_ERROR);
}
