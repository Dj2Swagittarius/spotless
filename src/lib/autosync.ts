import { getDb } from './db';
import { importTaste, SpotifyApiError } from './spotify';

let scheduled = false;

function usersWithSpotify(): number[] {
  const rows = getDb()
    .prepare("SELECT key FROM settings WHERE key LIKE 'spotify_tokens:%'")
    .all() as { key: string }[];
  return rows.map((r) => Number(r.key.split(':')[1])).filter(Number.isInteger);
}

async function syncAll() {
  let users: number[];
  try {
    users = usersWithSpotify();
  } catch (err) {
    console.error('autosync: could not list Spotify-connected profiles:', err);
    return;
  }
  for (const uid of users) {
    try {
      const taste = await importTaste(uid);
      console.log(`autosync: refreshed Spotify taste for user ${uid} (${taste.topArtists.length} top artists)`);
    } catch (err) {
      // A revoked grant already dropped the stored tokens; the profile just needs to reconnect.
      if (err instanceof SpotifyApiError && err.status === 401) {
        console.warn(`autosync: Spotify authorization for user ${uid} is no longer valid; reconnect from Settings`);
      } else if (err instanceof SpotifyApiError) {
        console.warn(`autosync: Spotify refresh for user ${uid} failed (HTTP ${err.status}): ${err.message}`);
      } else {
        console.warn(`autosync: Spotify refresh for user ${uid} failed:`, err);
      }
    }
  }
}

/** Refresh every connected user's Spotify taste daily (keeps Discover seeds current). */
export function scheduleSpotifySync(): void {
  if (scheduled) return;
  scheduled = true;
  // first run 5 min after boot, then every 24h
  setTimeout(() => syncAll().catch((err) => console.error('autosync: initial sync crashed:', err)), 5 * 60 * 1000);
  setInterval(() => syncAll().catch((err) => console.error('autosync: daily sync crashed:', err)), 24 * 60 * 60 * 1000);
}
