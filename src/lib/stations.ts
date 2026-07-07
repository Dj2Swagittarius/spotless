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

/** Station URLs must be http(s) — guards the stream proxy against file:/ etc. */
export function validStreamUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
