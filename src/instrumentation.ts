import os from 'os';

// Next.js can evaluate this file more than once per process (dev HMR, multiple server
// chunks); the flag on globalThis keeps the exit and signal handlers from stacking up.
const shutdownGlobal = globalThis as typeof globalThis & { __spotlessShutdownHookedV1?: boolean };

// Docker gives a container 10 s between SIGTERM and SIGKILL. A drain that is still waiting on a
// long-lived stream by then must give up a little earlier, so the WAL checkpoint below still runs.
const SHUTDOWN_DEADLINE_MS = 8_000;

/** Conventional exit code for a process that ended because of `signal`: 128 + signal number. */
function signalExitCode(signal: NodeJS.Signals): number {
  return 128 + os.constants.signals[signal];
}

async function registerGracefulShutdown(): Promise<void> {
  if (shutdownGlobal.__spotlessShutdownHookedV1) return;
  shutdownGlobal.__spotlessShutdownHookedV1 = true;

  const { log } = await import('./lib/log');
  // Importing the module does not open the database; getDb() is only called on exit.
  const { getDb } = await import('./lib/db');

  // Runs synchronously on every process.exit(), whoever calls it, so it cannot cut a request
  // short. Folding the WAL back into library.db leaves a stopped container with a single clean
  // file (backups and restores copy only library.db). better-sqlite3 is synchronous, so no
  // statement or transaction can be mid-flight by the time this runs.
  process.once('exit', () => {
    try {
      const db = getDb();
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    } catch {
      // nothing left to do: the process is exiting either way
    }
  });

  let shuttingDown = false;
  const onSignal = (signal: NodeJS.Signals) => {
    // Interactive shells send SIGINT to every child, so the same signal can arrive twice.
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`received ${signal}, shutting down`);
    if (process.listenerCount(signal) <= 1) {
      // Nobody else handles this signal (NEXT_MANUAL_SIG_HANDLE, a custom server): having a
      // listener at all cancels Node's default termination, so exit here with the usual code.
      process.exit(signalExitCode(signal));
    }
    // Next's start-server registered its own handler before loading this file: it stops
    // accepting connections, finishes in-flight requests, closes the Next server and exits with
    // 128 + signal. Pre-empting it would cut active streams, so this only backs it up with a
    // deadline, unref'd so it never keeps an otherwise finished process alive.
    setTimeout(() => {
      log.warn(`shutdown did not finish within ${SHUTDOWN_DEADLINE_MS} ms, exiting`);
      process.exit(signalExitCode(signal));
    }, SHUTDOWN_DEADLINE_MS).unref();
  };

  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
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
