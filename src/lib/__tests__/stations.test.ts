import dns from 'dns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PRIVATE_STREAM_HOST_ERROR,
  PRIVATE_STREAM_URL_ERROR,
  UNRESOLVED_STREAM_HOST_ERROR,
  assertPublicStreamUrl,
  streamUrlError,
  validStreamUrl,
} from '@/lib/stations';

const original = process.env.ALLOW_PRIVATE_STREAM_URLS;
afterEach(() => {
  if (original === undefined) delete process.env.ALLOW_PRIVATE_STREAM_URLS;
  else process.env.ALLOW_PRIVATE_STREAM_URLS = original;
  vi.restoreAllMocks();
});

/** Stub the resolver so the test never touches the network and can hand back any record set. */
function resolveTo(...addresses: string[]) {
  return vi
    .spyOn(dns.promises, 'lookup')
    .mockImplementation(
      async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })) as never
    );
}

describe('streamUrlError', () => {
  it('accepts public http(s) stream URLs', () => {
    delete process.env.ALLOW_PRIVATE_STREAM_URLS;
    expect(streamUrlError('https://ice.example.com/stream.mp3')).toBeNull();
    expect(streamUrlError('http://8.8.8.8:8000/live')).toBeNull();
    expect(validStreamUrl('https://ice.example.com/stream.mp3')).toBe(true);
  });

  it('rejects non-http schemes and junk with the generic message', () => {
    expect(streamUrlError('file:///etc/passwd')).toMatch(/http\(s\)/);
    expect(streamUrlError('not a url')).toMatch(/http\(s\)/);
    expect(validStreamUrl('ftp://host/x')).toBe(false);
  });

  it('names the private-address rule and the opt-in for LAN/loopback literals', () => {
    delete process.env.ALLOW_PRIVATE_STREAM_URLS;
    for (const url of [
      'http://192.168.0.50:8000/stream',
      'http://10.1.2.3/x',
      'http://172.20.0.1/x',
      'http://127.0.0.1:8000/x',
      'http://localhost:8000/x',
      'http://[::1]:8000/x',
      'http://[::ffff:10.0.0.1]/x',
    ]) {
      expect(streamUrlError(url), url).toBe(PRIVATE_STREAM_URL_ERROR);
    }
    expect(PRIVATE_STREAM_URL_ERROR).toContain('ALLOW_PRIVATE_STREAM_URLS=1');
    // the synchronous check never resolves names; assertPublicStreamUrl covers hostnames
    expect(streamUrlError('http://icecast.lan:8000/stream')).toBeNull();
  });

  it('allows private addresses when ALLOW_PRIVATE_STREAM_URLS=1', () => {
    process.env.ALLOW_PRIVATE_STREAM_URLS = '1';
    expect(streamUrlError('http://192.168.0.50:8000/stream')).toBeNull();
    expect(validStreamUrl('http://localhost:8000/x')).toBe(true);
    // the opt-in never loosens the scheme check
    expect(streamUrlError('file:///etc/passwd')).toMatch(/http\(s\)/);
  });
});

describe('assertPublicStreamUrl', () => {
  it('passes a hostname whose records are all public', async () => {
    delete process.env.ALLOW_PRIVATE_STREAM_URLS;
    const lookup = resolveTo('203.0.113.7', '2001:db8::7');
    await expect(assertPublicStreamUrl('https://ice.example.com/stream.mp3')).resolves.toBeUndefined();
    expect(lookup).toHaveBeenCalledWith('ice.example.com', { all: true });
  });

  it('rejects a hostname that resolves to loopback, LAN, link-local, ULA or mapped-v4 addresses', async () => {
    delete process.env.ALLOW_PRIVATE_STREAM_URLS;
    for (const address of [
      '127.0.0.1',
      '10.9.8.7',
      '192.168.0.50',
      '169.254.1.1',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
    ]) {
      resolveTo(address);
      await expect(assertPublicStreamUrl('http://rebind.example.net/x'), address).rejects.toThrow(
        PRIVATE_STREAM_HOST_ERROR
      );
      vi.restoreAllMocks();
    }
  });

  it('rejects when any one of several records is private (public + private split answers)', async () => {
    delete process.env.ALLOW_PRIVATE_STREAM_URLS;
    resolveTo('203.0.113.7', '127.0.0.1');
    await expect(assertPublicStreamUrl('http://rebind.example.net/x')).rejects.toThrow(PRIVATE_STREAM_HOST_ERROR);
  });

  it('rejects a hostname that does not resolve', async () => {
    delete process.env.ALLOW_PRIVATE_STREAM_URLS;
    vi.spyOn(dns.promises, 'lookup').mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertPublicStreamUrl('http://nowhere.invalid/x')).rejects.toThrow(UNRESOLVED_STREAM_HOST_ERROR);
  });

  it('still applies the literal rules before resolving', async () => {
    delete process.env.ALLOW_PRIVATE_STREAM_URLS;
    const lookup = resolveTo('203.0.113.7');
    await expect(assertPublicStreamUrl('http://192.168.0.50:8000/stream')).rejects.toThrow(PRIVATE_STREAM_URL_ERROR);
    await expect(assertPublicStreamUrl('file:///etc/passwd')).rejects.toThrow(/http\(s\)/);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('strips IPv6 brackets before looking up a public literal', async () => {
    delete process.env.ALLOW_PRIVATE_STREAM_URLS;
    const lookup = resolveTo('2001:db8::7');
    await expect(assertPublicStreamUrl('http://[2001:db8::7]:8000/x')).resolves.toBeUndefined();
    expect(lookup).toHaveBeenCalledWith('2001:db8::7', { all: true });
  });

  it('skips the lookup entirely when ALLOW_PRIVATE_STREAM_URLS=1', async () => {
    process.env.ALLOW_PRIVATE_STREAM_URLS = '1';
    const lookup = resolveTo('127.0.0.1');
    await expect(assertPublicStreamUrl('http://icecast.lan:8000/stream')).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });
});
