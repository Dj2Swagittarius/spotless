import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, currentLogLevel, formatLogLine } from '@/lib/log';

afterEach(() => {
  delete process.env.LOG_LEVEL;
  vi.restoreAllMocks();
});

describe('log', () => {
  it('defaults to info and ignores unknown LOG_LEVEL values', () => {
    expect(currentLogLevel()).toBe('info');
    process.env.LOG_LEVEL = 'verbose';
    expect(currentLogLevel()).toBe('info');
    process.env.LOG_LEVEL = ' DEBUG ';
    expect(currentLogLevel()).toBe('debug');
  });

  it('prefixes lines with an ISO timestamp, level and scope', () => {
    const at = new Date('2026-01-02T03:04:05.000Z');
    expect(formatLogLine('warn', 'backup', 'hello', at)).toBe('2026-01-02T03:04:05.000Z WARN  [backup] hello');
  });

  it('drops messages below the threshold and routes warn/error to stderr sinks', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger('test');

    process.env.LOG_LEVEL = 'warn';
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e', { detail: 1 });
    expect(out).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0][0]).toMatch(/ERROR \[test\] e$/);
    expect(err.mock.calls[0][1]).toEqual({ detail: 1 });

    process.env.LOG_LEVEL = 'debug';
    logger.debug('d');
    expect(out).toHaveBeenCalledTimes(1);
  });
});
