import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileValidators, ifRangeMatches, isNotModified, parseRange, rawFile } from '@/lib/streaming';

// A fixed mtime on a whole second, as HTTP dates carry: Last-Modified round-trips exactly.
const MTIME_MS = Date.UTC(2026, 0, 2, 3, 4, 5);
const v = fileValidators({ size: 1000, mtimeMs: MTIME_MS });

describe('fileValidators', () => {
  it('derives a weak tag from size + mtime and a whole-second Last-Modified', () => {
    expect(v.etag).toBe(`W/"${(1000).toString(16)}-${Math.floor(MTIME_MS / 1000).toString(16)}"`);
    expect(v.lastModified).toBe('Fri, 02 Jan 2026 03:04:05 GMT');
    expect(v.mtimeSec).toBe(Math.floor(MTIME_MS / 1000));
    // sub-second mtimes floor to the second the HTTP date can express
    expect(fileValidators({ size: 1000, mtimeMs: MTIME_MS + 999 }).etag).toBe(v.etag);
  });
});

describe('parseRange', () => {
  it('ignores an absent, non-byte or malformed header', () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange('', 1000)).toBeNull();
    expect(parseRange('items=0-10', 1000)).toBeNull();
    expect(parseRange('bytes=', 1000)).toBeNull();
    expect(parseRange('bytes=-', 1000)).toBeNull();
    expect(parseRange('bytes=abc', 1000)).toBeNull();
  });

  it('parses closed, open-ended and suffix ranges, clamping to the file', () => {
    expect(parseRange('bytes=0-499', 1000)).toEqual({ start: 0, end: 499 });
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 });
    expect(parseRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange('Bytes = 10-19', 1000)).toEqual({ start: 10, end: 19 });
  });

  it('serves only the first of several ranges', () => {
    expect(parseRange('bytes=0-9, 20-29', 1000)).toEqual({ start: 0, end: 9 });
  });

  it('treats an inverted range as invalid (ignored, not 416) per RFC 9110 §14.1.1', () => {
    expect(parseRange('bytes=500-100', 1000)).toBeNull();
    expect(parseRange('bytes=5-2', 1)).toBeNull();
  });

  it('reports a range that starts past the end, or on an empty file, as unsatisfiable', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=1000-2000', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=99999999999999999999-', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable');
    expect(parseRange('bytes=-10', 0)).toBe('unsatisfiable');
  });
});

describe('ifRangeMatches', () => {
  it('matches only an exact Last-Modified date', () => {
    expect(ifRangeMatches(v.lastModified, v)).toBe(true);
    expect(ifRangeMatches(`  ${v.lastModified} `, v)).toBe(true);
    // a later date is not "still current": the client may hold a copy from before the change
    expect(ifRangeMatches(new Date(MTIME_MS + 1000).toUTCString(), v)).toBe(false);
    expect(ifRangeMatches(new Date(MTIME_MS - 1000).toUTCString(), v)).toBe(false);
    expect(ifRangeMatches('not a date', v)).toBe(false);
    expect(ifRangeMatches('', v)).toBe(false);
  });

  it('never matches a weak entity tag, including our own (strong comparison, RFC 9110 §13.1.5)', () => {
    expect(ifRangeMatches(v.etag, v)).toBe(false);
    expect(ifRangeMatches('W/"other"', v)).toBe(false);
    // the strong form of our weak tag is a different validator, not a match
    expect(ifRangeMatches(v.etag.slice(2), v)).toBe(false);
    expect(ifRangeMatches('"abc"', v)).toBe(false);
  });
});

describe('isNotModified', () => {
  const req = (headers: Record<string, string>) => new Request('http://x/', { headers });

  it('compares If-None-Match weakly, so our own tag and its strong form both match', () => {
    expect(isNotModified(req({ 'if-none-match': v.etag }), v)).toBe(true);
    expect(isNotModified(req({ 'if-none-match': v.etag.slice(2) }), v)).toBe(true);
    expect(isNotModified(req({ 'if-none-match': `"x", ${v.etag}` }), v)).toBe(true);
    expect(isNotModified(req({ 'if-none-match': '*' }), v)).toBe(true);
    expect(isNotModified(req({ 'if-none-match': '"x"' }), v)).toBe(false);
  });

  it('treats If-Modified-Since at or after the mtime as current, and lets If-None-Match win', () => {
    expect(isNotModified(req({ 'if-modified-since': v.lastModified }), v)).toBe(true);
    expect(isNotModified(req({ 'if-modified-since': new Date(MTIME_MS + 1000).toUTCString() }), v)).toBe(true);
    expect(isNotModified(req({ 'if-modified-since': new Date(MTIME_MS - 1000).toUTCString() }), v)).toBe(false);
    expect(isNotModified(req({ 'if-modified-since': 'junk' }), v)).toBe(false);
    expect(isNotModified(req({ 'if-none-match': '"x"', 'if-modified-since': v.lastModified }), v)).toBe(false);
    expect(isNotModified(req({}), v)).toBe(false);
  });
});

describe('rawFile', () => {
  let dir: string;
  let file: string;
  const SIZE = 1000;
  let validators: ReturnType<typeof fileValidators>;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotless-streaming-'));
    file = path.join(dir, 'song.mp3');
    fs.writeFileSync(file, Buffer.alloc(SIZE, 7));
    fs.utimesSync(file, new Date(MTIME_MS), new Date(MTIME_MS));
    validators = fileValidators(await fs.promises.stat(file));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const get = (headers: Record<string, string> = {}, method = 'GET') =>
    rawFile(new Request('http://x/stream', { method, headers }), file, 'audio/mpeg');

  it('serves the whole file with validators and Accept-Ranges', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(SIZE));
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('etag')).toBe(validators.etag);
    expect(res.headers.get('last-modified')).toBe(validators.lastModified);
    expect((await res.arrayBuffer()).byteLength).toBe(SIZE);
  });

  it('serves a 206 for a byte range, and a bodiless 206 for HEAD', async () => {
    const res = await get({ range: 'bytes=100-199' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 100-199/${SIZE}`);
    expect(res.headers.get('content-length')).toBe('100');
    expect((await res.arrayBuffer()).byteLength).toBe(100);

    const head = await get({ range: 'bytes=100-199' }, 'HEAD');
    expect(head.status).toBe(206);
    expect(head.body).toBeNull();
  });

  it('answers 416 with the file size for a range past the end', async () => {
    const res = await get({ range: `bytes=${SIZE}-` });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe(`bytes */${SIZE}`);
  });

  it('ignores an inverted range and serves the full 200', async () => {
    const res = await get({ range: 'bytes=500-100' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-range')).toBeNull();
    expect(res.headers.get('content-length')).toBe(String(SIZE));
  });

  it('honours the Range only when If-Range carries the exact Last-Modified', async () => {
    const hit = await get({ range: 'bytes=0-9', 'if-range': validators.lastModified });
    expect(hit.status).toBe(206);

    const later = new Date(MTIME_MS + 60_000).toUTCString();
    const miss = await get({ range: 'bytes=0-9', 'if-range': later });
    expect(miss.status).toBe(200);
    expect(miss.headers.get('content-length')).toBe(String(SIZE));
  });

  it('sends the full file when If-Range carries our weak ETag', async () => {
    const res = await get({ range: 'bytes=0-9', 'if-range': validators.etag });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(SIZE));
  });

  it('404s a missing file', async () => {
    const res = await rawFile(new Request('http://x/stream'), path.join(dir, 'nope.mp3'), 'audio/mpeg');
    expect(res.status).toBe(404);
  });
});
