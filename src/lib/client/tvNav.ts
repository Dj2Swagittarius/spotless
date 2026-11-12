'use client';

/**
 * D-pad navigation for the Android TV app. The WebView only scrolls on arrow keys, so on a TV (the app adds
 * "SpotlessTV" to its user agent) the arrows move focus to the nearest control in that direction instead.
 * Nothing here runs in a browser, the desktop app or the phone app.
 */

export type Dir = 'left' | 'right' | 'up' | 'down';

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const KEYS: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

export function isTv(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return ua.includes('SpotlessTV');
}

/**
 * Index of the best box to move to from [from] in [dir], or -1. A candidate must lie past [from]'s edge in that
 * direction; among those, sideways offset counts more than distance, so the move keeps to the same row or column.
 */
export function pickNext(from: Box, boxes: Box[], dir: Dir): number {
  let best = -1;
  let bestScore = Infinity;
  boxes.forEach((b, i) => {
    let along: number;
    let across: number;
    if (dir === 'right' || dir === 'left') {
      along = dir === 'right' ? b.left - from.right : from.left - b.right;
      // overlapping rows count as no sideways offset
      across = b.bottom <= from.top ? from.top - b.bottom : b.top >= from.bottom ? b.top - from.bottom : 0;
    } else {
      along = dir === 'down' ? b.top - from.bottom : from.top - b.bottom;
      across = b.right <= from.left ? from.left - b.right : b.left >= from.right ? b.left - from.right : 0;
    }
    if (along < -1) return;
    const score = Math.max(0, along) + across * 3;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

function visible(el: HTMLElement): boolean {
  if (el.closest('[inert], [aria-hidden="true"]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden';
}

/** The open overlay focus stays in: the one holding focus, else the newest in the page. */
function scope(active: Element | null): ParentNode {
  const own = active?.closest('[data-overlay]');
  if (own) return own;
  const all = document.querySelectorAll('[data-overlay]');
  return all.length ? all[all.length - 1] : document;
}

/**
 * The slider the remote is adjusting. A slider only takes Left/Right after OK is pressed on it; otherwise the
 * arrows move focus past it like any other control. Up/Down, OK again or leaving it lets go.
 */
let engaged: HTMLInputElement | null = null;

function setEngaged(el: HTMLInputElement | null) {
  engaged?.classList.remove('tv-engaged');
  engaged = el;
  el?.classList.add('tv-engaged');
}

/** Arrows that belong to the focused control itself: caret moves in text, value changes on an engaged slider. */
function keyIsLocal(el: Element | null, dir: Dir): boolean {
  if (el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.type === 'range') return el === engaged && (dir === 'left' || dir === 'right');
  if (dir === 'up' || dir === 'down') return false;
  // leave a text field once the caret is at that end
  const start = el.selectionStart;
  if (start === null) return false;
  return dir === 'left' ? start > 0 || el.selectionEnd !== start : start < el.value.length;
}

/** One remote press moves a slider 5% of its range (the slider's own step is far too fine from a sofa). */
export function stepValue(value: number, min: number, max: number, step: number, dir: 'left' | 'right'): number {
  const inc = Math.max(step || 0, (max - min) / 20);
  const next = dir === 'right' ? value + inc : value - inc;
  return Math.min(max, Math.max(min, next));
}

function stepRange(el: HTMLInputElement, dir: 'left' | 'right') {
  const value = stepValue(Number(el.value), Number(el.min || 0), Number(el.max || 100), Number(el.step), dir);
  // through the native setter, so React's onChange sees the input event
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, String(value));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** The page area a control belongs to: sidebar, main or player. Arrows stay in the area until it runs out. */
function zoneOf(el: Element): Element | null {
  return el.closest('[data-tv-zone]');
}

/** The control last focused in each area, so coming back to an area lands where you left it. */
const lastInZone = new WeakMap<Element, HTMLElement>();

/**
 * The page area past [zone]'s edge in [dir] (past [from]'s when it is in none), probed in line with [from]: the
 * player below the page, the sidebar to its left, the page or sidebar above the player depending on the column.
 */
function zoneBeside(from: DOMRect, zone: Element | null, dir: Dir): Element | null | 'edge' {
  const edge = zone ? zone.getBoundingClientRect() : from;
  const gap = 16; // clears the padding between areas
  const x = dir === 'left' ? edge.left - gap : dir === 'right' ? edge.right + gap : (from.left + from.right) / 2;
  const y = dir === 'up' ? edge.top - gap : dir === 'down' ? edge.bottom + gap : (from.top + from.bottom) / 2;
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return 'edge';
  const hit = document.elementFromPoint(x, y);
  return hit ? zoneOf(hit) : null;
}

/**
 * Where an arrow press goes: the nearest control that way in the same area. When the area runs out, into the area
 * next to it that way (sidebar beside the page, player below it), at the control last used there or the area's
 * default (Play), else the nearest one. At the screen's edge (Left on the player's first button) it stays put.
 */
function nextTarget(active: HTMLElement, items: HTMLElement[], dir: Dir): HTMLElement | undefined {
  const from = active.getBoundingClientRect();
  const zone = zoneOf(active);
  const nearest = (els: HTMLElement[]) => els[pickNext(from, els.map((el) => el.getBoundingClientRect()), dir)];
  const own = nearest(items.filter((el) => zoneOf(el) === zone));
  if (own) return own;

  const beside = zoneBeside(from, zone, dir);
  if (beside === 'edge') return undefined;
  if (beside && beside !== zone) {
    const inside = items.filter((el) => zoneOf(el) === beside);
    const last = lastInZone.get(beside);
    if (last && inside.includes(last)) return last;
    const pick = inside.find((el) => el.hasAttribute('data-tv-default')) ?? nearest(inside) ?? inside[0];
    if (pick) return pick;
  }
  return nearest(items.filter((el) => zoneOf(el) !== zone));
}

function onKey(e: KeyboardEvent) {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;

  // OK on a slider picks it up for adjusting, OK again puts it down
  if (e.key === 'Enter' && active instanceof HTMLInputElement && active.type === 'range') {
    e.preventDefault();
    setEngaged(engaged === active ? null : active);
    return;
  }

  const dir = KEYS[e.key];
  if (!dir) return;
  if (keyIsLocal(active, dir)) {
    if (engaged && active === engaged && (dir === 'left' || dir === 'right')) {
      // capture phase: this also keeps the player's own arrow-key seek from adding to it
      e.preventDefault();
      stepRange(engaged, dir);
    }
    return;
  }
  if (engaged) setEngaged(null);

  const root = scope(active);
  const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el !== active && visible(el));
  if (!items.length) return;

  let target: HTMLElement | undefined;
  if (!active || (root !== document && !root.contains(active))) {
    // nothing focused yet (or focus is behind an overlay): start at the first control in view
    target = items.find((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight;
    }) ?? items[0];
  } else {
    target = nextTarget(active, items, dir);
  }
  // no control that way: up/down still scroll the page, left/right do nothing (they would seek otherwise)
  if (!target) {
    if (dir === 'left' || dir === 'right') e.preventDefault();
    return;
  }
  e.preventDefault();
  remember(target); // focus events alone can be missed while the window is not focused
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function remember(el: HTMLElement) {
  const zone = zoneOf(el);
  if (zone) lastInZone.set(zone, el);
}

function onFocusIn(e: FocusEvent) {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return;
  if (engaged && el !== engaged) setEngaged(null);
  remember(el);
}

let installed = false;

/** Turns on D-pad navigation when running in the TV app. */
export function installTvNav() {
  if (installed || typeof window === 'undefined' || !isTv()) return;
  installed = true;
  document.documentElement.classList.add('tv');
  // capture: runs before the player's arrow-key seek shortcut, which skips prevented keys
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('focusin', onFocusIn, true);
}
