import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// DATA_DIR is resolved when db.ts loads, so it must be set before the route is imported.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotless-health-'));
process.env.DATA_DIR = dataDir;
process.env.LOG_LEVEL = 'error';

type Route = typeof import('@/app/api/health/route');
type Db = typeof import('@/lib/db');
let route: Route;
let db: Db;

beforeAll(async () => {
  route = await import('@/app/api/health/route');
  db = await import('@/lib/db');
});

afterAll(() => {
  db.getDb().close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('GET /api/health', () => {
  it('answers 200 with ok:true while the database is reachable', async () => {
    const res = await route.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe('string');
  });

  it('answers 503 once the database connection is gone', async () => {
    // The route logs the failure; keep the test output clean.
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      db.getDb().close();
      const res = await route.GET();
      expect(res.status).toBe(503);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ ok: false });
      expect(errorLog).toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });
});
