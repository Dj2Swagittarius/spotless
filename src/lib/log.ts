/**
 * Minimal structured-ish logger: ISO timestamp, level, scope, message. No dependencies, so it
 * is safe to import from instrumentation and from modules that run before the DB is open.
 * LOG_LEVEL (debug | info | warn | error, default info) is read on every call so tests and
 * long-running processes can change it without re-importing.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && value in LEVELS;
}

/** Active threshold from LOG_LEVEL; unknown or missing values fall back to "info". */
export function currentLogLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? '').trim().toLowerCase();
  return isLogLevel(raw) ? raw : 'info';
}

export function formatLogLine(level: LogLevel, scope: string, message: string, at = new Date()): string {
  return `${at.toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
}

export interface Logger {
  debug(message: string, ...extra: unknown[]): void;
  info(message: string, ...extra: unknown[]): void;
  warn(message: string, ...extra: unknown[]): void;
  error(message: string, ...extra: unknown[]): void;
}

function emit(level: LogLevel, scope: string, message: string, extra: unknown[]): void {
  if (LEVELS[level] < LEVELS[currentLogLevel()]) return;
  // Keep warn/error on stderr so container log drivers and `docker logs` can separate them.
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(formatLogLine(level, scope, message), ...extra);
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, ...extra) => emit('debug', scope, message, extra),
    info: (message, ...extra) => emit('info', scope, message, extra),
    warn: (message, ...extra) => emit('warn', scope, message, extra),
    error: (message, ...extra) => emit('error', scope, message, extra),
  };
}

export const log = createLogger('spotless');
