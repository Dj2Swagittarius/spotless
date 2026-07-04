import { getSetting, setSetting, delSetting } from './db';

export interface LidarrConfig {
  url: string;
  apiKey: string;
}

export function getLidarrConfig(): LidarrConfig | null {
  const url = getSetting('lidarr_url');
  const apiKey = getSetting('lidarr_api_key');
  return url && apiKey ? { url, apiKey } : null;
}

export function saveLidarrConfig(url: string, apiKey: string): void {
  setSetting('lidarr_url', url.replace(/\/+$/, ''));
  setSetting('lidarr_api_key', apiKey);
}

export function clearLidarrConfig(): void {
  delSetting('lidarr_url');
  delSetting('lidarr_api_key');
}

async function lidarr<T>(cfg: LidarrConfig, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${cfg.url}/api/v1${path}`, {
    ...init,
    headers: { 'X-Api-Key': cfg.apiKey, 'Content-Type': 'application/json', ...init?.headers },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Lidarr ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export async function testLidarr(url: string, apiKey: string): Promise<{ version: string }> {
  const status = await lidarr<{ version: string }>({ url: url.replace(/\/+$/, ''), apiKey }, '/system/status');
  return { version: status.version };
}

export interface AddArtistResult {
  status: 'added' | 'searching';
  artistName: string;
}

const normTitle = (s: string) =>
  s.toLowerCase().replace(/\((deluxe|expanded|remaster|edition|bonus)[^)]*\)|\[[^\]]*\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Ensure the artist exists in Lidarr (without kicking off a full-discography search). Returns lidarr artist id. */
async function ensureArtist(cfg: LidarrConfig, name: string): Promise<number> {
  const candidates = await lidarr<{ foreignArtistId: string; artistName: string }[]>(
    cfg,
    `/artist/lookup?term=${encodeURIComponent(name)}`
  );
  const match = candidates[0];
  if (!match) throw new Error(`Lidarr couldn't find artist "${name}"`);

  const existing = await lidarr<{ id: number; foreignArtistId: string }[]>(cfg, '/artist');
  const already = existing.find((a) => a.foreignArtistId === match.foreignArtistId);
  if (already) return already.id;

  const [profiles, metaProfiles, roots] = await Promise.all([
    lidarr<{ id: number }[]>(cfg, '/qualityprofile'),
    lidarr<{ id: number }[]>(cfg, '/metadataprofile'),
    lidarr<{ path: string }[]>(cfg, '/rootfolder'),
  ]);
  if (!profiles[0] || !metaProfiles[0] || !roots[0]) {
    throw new Error('Lidarr has no quality profile, metadata profile, or root folder configured');
  }
  const created = await lidarr<{ id: number }>(cfg, '/artist', {
    method: 'POST',
    body: JSON.stringify({
      foreignArtistId: match.foreignArtistId,
      artistName: match.artistName,
      qualityProfileId: profiles[0].id,
      metadataProfileId: metaProfiles[0].id,
      rootFolderPath: roots[0].path,
      monitored: true,
      addOptions: { monitor: 'none', searchForMissingAlbums: false },
    }),
  });
  return created.id;
}

export interface QueueItem {
  title: string;
  artist: string | null;
  status: string;
  state: string | null;
  pct: number; // 0-100 download progress
}

export async function getQueue(): Promise<QueueItem[]> {
  const cfg = getLidarrConfig();
  if (!cfg) return [];
  const q = await lidarr<{ records: { title?: string; status?: string; trackedDownloadState?: string; size?: number; sizeleft?: number; artist?: { artistName?: string } }[] }>(
    cfg,
    '/queue?pageSize=30&includeArtist=true&includeUnknownArtistItems=true'
  );
  return (q.records ?? []).map((r) => ({
    title: r.title ?? '?',
    artist: r.artist?.artistName ?? null,
    status: r.status ?? 'unknown',
    state: r.trackedDownloadState ?? null,
    pct: r.size && r.size > 0 ? Math.round(((r.size - (r.sizeleft ?? 0)) / r.size) * 100) : 0,
  }));
}

export interface AddAlbumResult {
  status: 'searching';
  artistName: string;
  albumTitle: string;
}

/** Add/monitor one specific album and search for just that album. */
export async function addAlbumToLidarr(artistName: string, albumTitle: string): Promise<AddAlbumResult> {
  const cfg = getLidarrConfig();
  if (!cfg) throw new Error('Lidarr is not configured');

  const artistId = await ensureArtist(cfg, artistName);

  // albums list may lag right after adding a new artist; retry briefly
  const want = normTitle(albumTitle);
  let album: { id: number; title: string; monitored: boolean } | undefined;
  for (let attempt = 0; attempt < 6 && !album; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 5000));
    const albums = await lidarr<{ id: number; title: string; monitored: boolean }[]>(cfg, `/album?artistId=${artistId}`);
    album = albums.find((al) => normTitle(al.title) === want) ?? albums.find((al) => normTitle(al.title).includes(want) || want.includes(normTitle(al.title)));
  }
  if (!album) throw new Error(`Lidarr doesn't list "${albumTitle}" for this artist (metadata may still be syncing — retry in a minute)`);

  if (!album.monitored) {
    await lidarr(cfg, '/album/monitor', {
      method: 'PUT',
      body: JSON.stringify({ albumIds: [album.id], monitored: true }),
    });
  }
  await lidarr(cfg, '/command', {
    method: 'POST',
    body: JSON.stringify({ name: 'AlbumSearch', albumIds: [album.id] }),
  });
  return { status: 'searching', artistName, albumTitle: album.title };
}

/** Add an artist to Lidarr (monitored, search on add). If already present, trigger a search instead. */
export async function addArtistToLidarr(name: string): Promise<AddArtistResult> {
  const cfg = getLidarrConfig();
  if (!cfg) throw new Error('Lidarr is not configured');

  const candidates = await lidarr<{ foreignArtistId: string; artistName: string }[]>(
    cfg,
    `/artist/lookup?term=${encodeURIComponent(name)}`
  );
  const match = candidates[0];
  if (!match) throw new Error(`Lidarr couldn't find "${name}"`);

  const existing = await lidarr<{ id: number; foreignArtistId: string }[]>(cfg, '/artist');
  const already = existing.find((a) => a.foreignArtistId === match.foreignArtistId);
  if (already) {
    await lidarr(cfg, '/command', {
      method: 'POST',
      body: JSON.stringify({ name: 'ArtistSearch', artistId: already.id }),
    });
    return { status: 'searching', artistName: match.artistName };
  }

  const [profiles, metaProfiles, roots] = await Promise.all([
    lidarr<{ id: number }[]>(cfg, '/qualityprofile'),
    lidarr<{ id: number }[]>(cfg, '/metadataprofile'),
    lidarr<{ path: string }[]>(cfg, '/rootfolder'),
  ]);
  if (!profiles[0] || !metaProfiles[0] || !roots[0]) {
    throw new Error('Lidarr has no quality profile, metadata profile, or root folder configured');
  }

  await lidarr(cfg, '/artist', {
    method: 'POST',
    body: JSON.stringify({
      foreignArtistId: match.foreignArtistId,
      artistName: match.artistName,
      qualityProfileId: profiles[0].id,
      metadataProfileId: metaProfiles[0].id,
      rootFolderPath: roots[0].path,
      monitored: true,
      addOptions: { monitor: 'all', searchForMissingAlbums: true },
    }),
  });
  return { status: 'added', artistName: match.artistName };
}
