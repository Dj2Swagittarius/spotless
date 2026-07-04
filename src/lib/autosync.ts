import { getDb } from './db';
import { importTaste } from './spotify';

let scheduled = false;

function usersWithSpotify(): number[] {
  const rows = getDb()
    .prepare("SELECT key FROM settings WHERE key LIKE 'spotify_tokens:%'")
    .all() as { key: string }[];
  return rows.map((r) => Number(r.key.split(':')[1])).filter(Number.isInteger);
}

async function syncAll() {
  for (const uid of usersWithSpotify()) {
    try {
      const taste = await importTaste(uid);
      console.log(`autosync: refreshed Spotify taste for user ${uid} (${taste.topArtists.length} top artists)`);
    } catch (err) {
      console.warn(`autosync: user ${uid} failed:`, err);
    }
  }
}

/** Refresh every connected user's Spotify taste daily (keeps Discover seeds current). */
export function scheduleSpotifySync(): void {
  if (scheduled) return;
  scheduled = true;
  // first run 5 min after boot, then every 24h
  setTimeout(() => syncAll().catch(() => {}), 5 * 60 * 1000);
  setInterval(() => syncAll().catch(() => {}), 24 * 60 * 60 * 1000);
}
