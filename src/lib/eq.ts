'use client';

/**
 * 10-band graphic equalizer over Web Audio. Each <audio> element gets a
 * MediaElementSource -> biquad chain -> destination. Attaching is lazy and
 * one-way: an element is only ever routed through the graph after the user
 * enables the EQ (routing can't be undone per the Web Audio spec, so when
 * disabled we zero the filters instead — an exact bypass).
 */

export const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_MIN = -12;
export const EQ_MAX = 12;

export interface EqState {
  enabled: boolean;
  preset: string;
  gains: number[]; // dB per band
}

// standard preset curves (iTunes-style), dB per band low -> high
export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Acoustic: [5, 5, 4, 1, 2, 1.5, 3.5, 4, 3.5, 2],
  'Bass Boost': [5.5, 4.5, 3.5, 2.5, 1, 0, 0, 0, 0, 0],
  'Bass Reducer': [-5.5, -4.5, -3.5, -2.5, -1, 0, 0, 0, 0, 0],
  Classical: [4.5, 3.5, 3, 2.5, -1.5, -1.5, 0, 2, 3, 4],
  Dance: [3.5, 6, 5, 0, 2, 3.5, 5, 4.5, 3.5, 0],
  Electronic: [4, 3.5, 1, 0, -2, 2, 1, 1, 4, 5],
  'Hip-Hop': [5, 4, 1.5, 3, -1, -1, 1.5, -0.5, 2, 3],
  Jazz: [4, 3, 1, 2, -1.5, -1.5, 0, 1, 3, 4],
  Pop: [-1.5, -1, 0, 2, 4, 4, 2, 0, -1, -1.5],
  Rock: [5, 4, 3, 1, -0.5, -1, 0.5, 2.5, 3.5, 4.5],
  'Treble Boost': [0, 0, 0, 0, 0, 1, 2.5, 3.5, 4.5, 5.5],
  Vocal: [-1.5, -3, -3, 1.5, 4, 4, 3, 1.5, 0, -1.5],
};

const ZEROS = EQ_PRESETS.Flat;

export function loadEq(): EqState {
  try {
    const raw = localStorage.getItem('eq');
    if (raw) {
      const s = JSON.parse(raw) as EqState;
      if (Array.isArray(s.gains) && s.gains.length === EQ_FREQS.length)
        return { enabled: Boolean(s.enabled), preset: s.preset || 'Custom', gains: s.gains.map(Number) };
    }
  } catch {
    // private mode etc.
  }
  return { enabled: false, preset: 'Flat', gains: ZEROS.slice() };
}

let ctx: AudioContext | null = null;
const chains = new Map<HTMLAudioElement, BiquadFilterNode[]>();

function buildChain(el: HTMLAudioElement): BiquadFilterNode[] {
  if (!ctx) ctx = new AudioContext();
  const source = ctx.createMediaElementSource(el);
  const filters = EQ_FREQS.map((freq, i) => {
    const f = ctx!.createBiquadFilter();
    f.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
    f.frequency.value = freq;
    if (f.type === 'peaking') f.Q.value = 1.1;
    f.gain.value = 0;
    return f;
  });
  filters.reduce((prev: AudioNode, f) => (prev.connect(f), f), source).connect(ctx.destination);
  return filters;
}

function applyTo(filters: BiquadFilterNode[], state: EqState) {
  const gains = state.enabled ? state.gains : ZEROS;
  filters.forEach((f, i) => {
    f.gain.value = Math.max(EQ_MIN, Math.min(EQ_MAX, gains[i] ?? 0));
  });
}

/** Route an element through the EQ (no-op if EQ was never enabled, or already attached). */
export function attachEq(el: HTMLAudioElement | null) {
  if (!el) return;
  const state = loadEq();
  if (!state.enabled && !chains.has(el)) return; // never touch the audio path until EQ is first enabled
  if (!chains.has(el)) {
    try {
      chains.set(el, buildChain(el));
    } catch {
      return; // element already sourced elsewhere or Web Audio unavailable
    }
  }
  applyTo(chains.get(el)!, state);
  ctx?.resume().catch(() => {});
}

/** Persist + apply new EQ state to every attached element. */
export function saveEq(state: EqState) {
  try {
    localStorage.setItem('eq', JSON.stringify(state));
  } catch {
    // ignore
  }
  for (const filters of chains.values()) applyTo(filters, state);
  if (state.enabled) ctx?.resume().catch(() => {});
  // player listens so it can attach elements the first time EQ turns on mid-session
  window.dispatchEvent(new CustomEvent('eq-changed'));
}
