// Next.js can evaluate this file more than once per process (dev HMR, multiple server
// chunks); the flag on globalThis keeps the signal handlers from stacking up.
const shutdownGlobal = globalThis as typeof globalThis & { __spotlessShutdownHookedV1?: boolean };

async function registerGracefulShutdown(): Promise<void> {
  if (shutdownGlobal.__spotlessShutdownHookedV1) return;
  shutdownGlobal.__spotlessShutdownHookedV1 = true;

  const { log } = await import('./lib/log');
  // Importing the module does not open the database; getDb() is only called on shutdown.
  const { getDb } = await import('./lib/db');
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`received ${signal}, shutting down`);
    try {
      // Fold the WAL back into library.db so a stopped container leaves a single clean file
      // (backups and restores copy only library.db). Any failure here must not block exit.
      const db = getDb();
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    } catch {
      // nothing left to do: the process is exiting either way
    }
    process.exit(0);
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { log } = await import('./lib/log');
    await registerGracefulShutdown();
    const { versionLabel } = await import('./lib/version');
    log.info(`Spotless ${versionLabel()} starting`);

    const { scanLibrary, startLibraryScanScheduler } = await import('./lib/scanner');

    // Start the scheduler once for this server process. The startup scan below
    // resets the next-run timer when it completes.
    startLibraryScanScheduler();

    scanLibrary().catch((err) => log.error('startup scan failed:', err));

    const { scheduleBackups } = await import('./lib/backup');
    scheduleBackups();

    const { scheduleSpotifySync } = await import('./lib/autosync');
    scheduleSpotifySync();
  }
}
