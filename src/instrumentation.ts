export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { scanLibrary, startLibraryScanScheduler } = await import('./lib/scanner');

    // Start the scheduler once for this server process. The startup scan below
    // resets the next-run timer when it completes.
    startLibraryScanScheduler();

    scanLibrary().catch((err) => console.error('startup scan failed:', err));

    const { scheduleBackups } = await import('./lib/backup');
    scheduleBackups();

    const { scheduleSpotifySync } = await import('./lib/autosync');
    scheduleSpotifySync();
  }
}
