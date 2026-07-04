export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { scanLibrary } = await import('./lib/scanner');
    scanLibrary().catch((err) => console.error('startup scan failed:', err));
    const { scheduleBackups } = await import('./lib/backup');
    scheduleBackups();
    const { scheduleSpotifySync } = await import('./lib/autosync');
    scheduleSpotifySync();
  }
}
