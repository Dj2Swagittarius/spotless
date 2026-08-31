'use client';

/**
 * Streaming quality tiers and the "Auto" (adaptive) mode.
 *
 * Auto picks a rung on the quality ladder from two signals:
 *   1. Network hints — the Network Information API (`navigator.connection`) tells us
 *      wifi vs cellular, the effective connection class (4g/3g/2g) and a downlink
 *      estimate. Chromium-based browsers only; everything else reports nothing.
 *   2. Stalls — every rebuffer the player sees pushes the ceiling down one rung and
 *      decays back up after a stretch of clean playback. This works everywhere, and
 *      it is the signal that actually catches a weak LTE cell that still advertises
 *      itself as "4g".
 *
 * The player asks for the current rung when it loads a track, and downshifts
 * mid-track when a stall makes the ladder drop below what is already playing.
 */

export type QualityId = 'auto' | 'raw' | 'high' | 'normal' | 'saver';

export interface Rung {
  id: Exclude<QualityId, 'auto'>;
  label: string;
  bitrate: number; // kbps; 0 = original file, no transcode
}

/** Quality ladder, best first. Auto walks down this list; the ids double as the stored setting. */
export const RUNGS: Rung[] = [
  { id: 'raw', label: 'Original', bitrate: 0 },
  { id: 'high', label: 'High · 320', bitrate: 320 },
  { id: 'normal', label: 'Normal · 192', bitrate: 192 },
  { id: 'saver', label: 'Data saver · 128', bitrate: 128 },
];

const BOTTOM = RUNGS.length - 1;
const rungIndex = (id: string) => Math.max(0, RUNGS.findIndex((r) => r.id === id));

/** Rung Auto settles on when the browser tells us nothing about the connection. */
const UNKNOWN_NETWORK_RUNG = rungIndex('high');

// One stall = one rung down; a rung is handed back after this long without a stall.
const STALL_RECOVERY_MS = 90_000;

interface NetworkConnection extends EventTarget {
  effectiveType?: string; // 'slow-2g' | '2g' | '3g' | '4g'
  type?: string; // 'wifi' | 'cellular' | 'ethernet' | … (Android Chrome)
  downlink?: number; // Mbps estimate
  saveData?: boolean;
}

function connection(): NetworkConnection | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as Navigator & {
    connection?: NetworkConnection;
    mozConnection?: NetworkConnection;
    webkitConnection?: NetworkConnection;
  };
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection ?? null;
}

export interface NetworkInfo {
  supported: boolean; // false when the browser exposes no connection hints at all
  metered: boolean; // cellular (or explicitly not wifi/ethernet)
  effectiveType: string | null;
  downlink: number | null; // Mbps
  saveData: boolean;
  label: string; // short human description, e.g. "LTE · ~4 Mbps"
}

const CELLULAR_TYPES = ['cellular', 'wimax'];
const UNMETERED_TYPES = ['wifi', 'ethernet'];

export function readNetwork(): NetworkInfo {
  const c = connection();
  const effectiveType = c?.effectiveType ?? null;
  const type = c?.type ?? null;
  const downlink = typeof c?.downlink === 'number' ? c.downlink : null;
  const saveData = Boolean(c?.saveData);
  const supported = Boolean(c && (effectiveType || type || downlink != null));

  // `type` is the only honest wifi/cellular signal, and only Android Chrome sets it.
  // Everywhere else, treat a sub-4g effective type as metered — it is the same
  // conservative call, and a slow wifi link wants the lower bitrate anyway.
  const metered = type
    ? CELLULAR_TYPES.includes(type) || !UNMETERED_TYPES.includes(type)
    : Boolean(effectiveType && effectiveType !== '4g');

  const parts: string[] = [];
  if (type) parts.push(UNMETERED_TYPES.includes(type) ? (type === 'wifi' ? 'Wi-Fi' : 'Ethernet') : 'Cellular');
  if (effectiveType) parts.push(effectiveType === '4g' ? 'LTE-class' : effectiveType.toUpperCase());
  if (downlink != null) parts.push(`~${downlink} Mbps`);
  if (saveData) parts.push('Data Saver on');

  return {
    supported,
    metered,
    effectiveType,
    downlink,
    saveData,
    label: parts.length ? parts.join(' · ') : 'connection unknown',
  };
}

/** Best rung the raw network hints allow, before stall history is applied. */
function networkRung(net: NetworkInfo): number {
  if (net.saveData) return BOTTOM; // the user asked the OS for less data — respect it
  if (!net.supported) return UNKNOWN_NETWORK_RUNG;

  let rung = net.metered ? rungIndex('high') : rungIndex('raw');

  switch (net.effectiveType) {
    case 'slow-2g':
    case '2g':
      rung = BOTTOM;
      break;
    case '3g':
      rung = Math.max(rung, rungIndex('normal'));
      break;
    default:
      break;
  }

  // Downlink is a rolling estimate, so only let it pull the ceiling down.
  // Original files run ~1 Mbps for FLAC and need real headroom on top of that.
  if (net.downlink != null) {
    if (net.downlink < 1) rung = BOTTOM;
    else if (net.downlink < 2) rung = Math.max(rung, rungIndex('normal'));
    else if (net.downlink < 5) rung = Math.max(rung, rungIndex('high'));
  }

  return Math.min(rung, BOTTOM);
}

// --- stall history (per tab; adaptation restarts fresh on reload) ---

let stalls = 0;
let lastStallAt = 0;

/** Rungs currently forfeited by rebuffering, decaying one rung per recovery window. */
function stallPenalty(): number {
  if (stalls === 0) return 0;
  const recovered = Math.floor((Date.now() - lastStallAt) / STALL_RECOVERY_MS);
  return Math.max(0, stalls - recovered);
}

/** Player calls this when playback rebuffers; returns the penalty now in force. */
export function noteStall(): number {
  stalls = Math.min(BOTTOM, stallPenalty() + 1);
  lastStallAt = Date.now();
  return stalls;
}

/** Forget stall history — used when the user picks a fixed tier or the network changes. */
export function resetStalls(): void {
  stalls = 0;
  lastStallAt = 0;
}

/** The rung Auto wants right now: network ceiling, pushed down by recent stalls. */
export function autoRung(): Rung {
  const net = readNetwork();
  return RUNGS[Math.min(BOTTOM, networkRung(net) + stallPenalty())];
}

// --- stored setting ---

export function loadQuality(): QualityId {
  try {
    const v = localStorage.getItem('streamQuality');
    if (v === 'auto' || RUNGS.some((r) => r.id === v)) return v as QualityId;
  } catch {
    // private mode etc.
  }
  return 'raw';
}

export function saveQuality(v: QualityId): void {
  try {
    localStorage.setItem('streamQuality', v);
  } catch {
    // ignore
  }
  if (v !== 'auto') resetStalls();
  window.dispatchEvent(new CustomEvent('quality-changed'));
}

/** Rung to stream at right now, resolving 'auto' against the live connection. */
export function currentRung(): Rung {
  const q = loadQuality();
  return q === 'auto' ? autoRung() : RUNGS[rungIndex(q)];
}

/**
 * Whether to hold off preloading the next track until the current one is nearly over.
 * The player normally pulls the next track down as soon as it is queued, which on a
 * phone means two streams competing for one weak link — a common cause of the current
 * song stalling mid-play. On Auto over metered data (or after a stall) that preload
 * waits its turn; on Wi-Fi and on the fixed tiers nothing changes.
 */
export function deferPreload(): boolean {
  if (loadQuality() !== 'auto') return false;
  const net = readNetwork();
  return net.metered || net.saveData || stallPenalty() > 0;
}

/** True when `a` is a worse-sounding rung than `b` (i.e. further down the ladder). */
export function isLower(a: Rung, b: Rung): boolean {
  return rungIndex(a.id) > rungIndex(b.id);
}

/**
 * Query string for /api/stream/<id> at a given rung. `offset` resumes a transcode
 * partway in (seconds) so an adaptive downshift can pick up where playback stalled.
 */
export function streamQuery(rung: Rung, offset = 0): string {
  const p = new URLSearchParams();
  if (rung.bitrate) {
    p.set('format', 'mp3');
    p.set('maxBitRate', String(rung.bitrate));
    if (offset > 0) p.set('offset', offset.toFixed(3));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Subscribe to connection changes (and online/offline). Returns an unsubscribe. */
export function onNetworkChange(cb: () => void): () => void {
  const c = connection();
  c?.addEventListener('change', cb);
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    c?.removeEventListener('change', cb);
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}
