import crypto from 'crypto';
import { getSetting, setSetting } from '../db';
import {
  externalDevicesChanged,
  externalState,
  externalStopped,
  setExternalDevices,
  type ExternalDevice,
} from '../devices';
import { createLogger } from '../log';
import { similarTracks } from '../radio';
import { openCastSession } from './client';
import { CastController, type CastHost, type CastTarget } from './controller';
import { castLoad, castToken } from './media';
import { discover } from './mdns';

/**
 * The Chromecasts Spotless knows about: found on the LAN by mDNS every minute, plus any added by
 * address in Settings (needed when the server runs on Docker's default bridge network, which
 * multicast does not cross). Each one is a "Play on" device for every user.
 *
 * CAST_ENABLED=false turns the whole feature off. CAST_BASE_URL sets the address receivers use to
 * fetch music from this server, when the one the browser uses (localhost, say) won't do.
 */

const log = createLogger('cast');
const SCAN_EVERY_MS = 60_000;
// A receiver that stopped answering scans is dropped from the list after this long.
const FORGET_AFTER_MS = 5 * 60_000;
const SETTING_KEY = 'cast_devices';

export interface ManualCast {
  host: string;
  port: number;
  name: string;
}

interface Known {
  target: CastTarget;
  controller: CastController;
  model: string;
  lastSeen: number;
  manual: boolean;
}

interface CastRegistry {
  started: boolean;
  devices: Map<string, Known>;
  /** origin each user's pages reached the server at, for receivers to fetch from */
  origins: Map<number, string>;
  scanTimer: ReturnType<typeof setInterval> | null;
}

const g = globalThis as typeof globalThis & { __spotlessCastV1?: CastRegistry };
const reg = (g.__spotlessCastV1 ??= { started: false, devices: new Map(), origins: new Map(), scanTimer: null });

export function castEnabled(): boolean {
  return (process.env.CAST_ENABLED ?? '').toLowerCase() !== 'false';
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '::1' || hostname === '[::1]' || hostname.startsWith('127.');
}

/** Note the origin a user's page used; a receiver fetches music from the same place. */
export function rememberOrigin(userId: number, origin: string) {
  try {
    const u = new URL(origin);
    if ((u.protocol === 'http:' || u.protocol === 'https:') && !isLoopback(u.hostname))
      reg.origins.set(userId, u.origin);
  } catch {
    // not a URL: nothing to remember
  }
}

function baseUrl(userId: number): string | null {
  const env = process.env.CAST_BASE_URL?.trim().replace(/\/+$/, '');
  if (env) return env;
  return reg.origins.get(userId) ?? null;
}

const host: CastHost = {
  open: openCastSession,
  loadFor: (userId, base, track, opts) => castLoad(base, castToken(userId), track, opts),
  report: (userId, id, patch) => {
    externalState(userId, id, patch);
  },
  stopped: (userId, id) => externalStopped(userId, id),
  radioTracks: (seed, exclude) => similarTracks(seed.id, exclude, 15),
  baseUrl,
  log: (msg) => log.info(msg),
};

function idFor(raw: string): string {
  const clean = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `cast-${clean.length >= 8 ? clean.slice(0, 40) : crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16)}`;
}

function manualId(m: { host: string; port: number }): string {
  return `cast-m${crypto.createHash('sha1').update(`${m.host}:${m.port}`).digest('hex').slice(0, 16)}`;
}

function upsert(id: string, name: string, model: string, addr: string, port: number, manual: boolean): boolean {
  const known = reg.devices.get(id);
  if (known) {
    const changed = known.target.info.name !== name || known.target.host !== addr || known.target.port !== port;
    known.target.info.name = name;
    known.target.host = addr;
    known.target.port = port;
    known.model = model || known.model;
    known.lastSeen = Date.now();
    return changed;
  }
  const target: CastTarget = { info: { id, name, kind: 'cast' }, host: addr, port };
  reg.devices.set(id, { target, controller: new CastController(target, host), model, lastSeen: Date.now(), manual });
  return true;
}

export function manualCasts(): ManualCast[] {
  try {
    const raw = JSON.parse(getSetting(SETTING_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((r) => {
      const m = r as Partial<ManualCast>;
      if (typeof m.host !== 'string' || !m.host) return [];
      return [
        {
          host: m.host,
          port: Number.isInteger(m.port) ? (m.port as number) : 8009,
          name: typeof m.name === 'string' ? m.name : '',
        },
      ];
    });
  } catch {
    return [];
  }
}

function syncManual() {
  const manual = manualCasts();
  const wanted = new Set(manual.map(manualId));
  for (const [id, k] of reg.devices) {
    if (k.manual && !wanted.has(id)) {
      k.controller.shutdown();
      reg.devices.delete(id);
    }
  }
  for (const m of manual) upsert(manualId(m), m.name || `Chromecast (${m.host})`, '', m.host, m.port, true);
}

/** Address check for the Settings form: an IPv4 address or a plain host name, nothing else. */
export function cleanCastHost(raw: string): string | null {
  const h = raw.trim().toLowerCase();
  if (/^(\d{1,3})(\.\d{1,3}){3}$/.test(h)) return h.split('.').every((n) => Number(n) <= 255) ? h : null;
  if (/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?)*$/.test(h)) return h;
  return null;
}

export function addManualCast(m: ManualCast) {
  const list = manualCasts().filter((x) => !(x.host === m.host && x.port === m.port));
  list.push({ host: m.host, port: m.port, name: m.name.trim().slice(0, 60) });
  setSetting(SETTING_KEY, JSON.stringify(list));
  syncManual();
  externalDevicesChanged();
}

export function removeManualCast(hostAddr: string, port: number) {
  setSetting(SETTING_KEY, JSON.stringify(manualCasts().filter((x) => !(x.host === hostAddr && x.port === port))));
  syncManual();
  externalDevicesChanged();
}

function visible(): Known[] {
  const now = Date.now();
  const found = [...reg.devices.values()].filter((k) => !k.manual);
  // a receiver both found and added by hand shows once, under its own name
  const foundAt = new Set(found.map((k) => `${k.target.host}:${k.target.port}`));
  return [...reg.devices.values()].filter(
    (k) =>
      k.controller.owner !== null ||
      (k.manual ? !foundAt.has(`${k.target.host}:${k.target.port}`) : now - k.lastSeen < FORGET_AFTER_MS)
  );
}

function list(): ExternalDevice[] {
  return visible().map((k) => ({ info: k.target.info, deliver: (userId, e) => k.controller.deliver(userId, e) }));
}

/** For Settings: what is known, and how. */
export function castStatus() {
  return {
    enabled: castEnabled(),
    baseUrl: process.env.CAST_BASE_URL?.trim() || null,
    devices: visible().map((k) => ({
      id: k.target.info.id,
      name: k.target.info.name,
      host: k.target.host,
      port: k.target.port,
      model: k.model,
      manual: k.manual,
      playing: k.controller.owner !== null,
    })),
    manual: manualCasts(),
  };
}

async function scan() {
  const before = visible()
    .map((k) => k.target.info.id)
    .join();
  let changed = false;
  try {
    for (const c of await discover()) {
      changed = upsert(idFor(c.id), c.name, c.model, c.host, c.port, false) || changed;
    }
  } catch (err) {
    log.debug(`discovery failed: ${(err as Error).message}`);
  }
  if (
    changed ||
    visible()
      .map((k) => k.target.info.id)
      .join() !== before
  )
    externalDevicesChanged();
}

/** Start looking for receivers (once per process). */
export function startCast() {
  if (reg.started || !castEnabled()) return;
  reg.started = true;
  syncManual();
  setExternalDevices(list);
  void scan();
  reg.scanTimer = setInterval(() => void scan(), SCAN_EVERY_MS);
  reg.scanTimer.unref?.();
}

/** Look again now (the Settings "Search again" button). */
export async function rescan() {
  await scan();
}
