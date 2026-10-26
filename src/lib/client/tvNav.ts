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

/** Arrows that belong to the focused control itself: caret moves in text, value changes on a slider. */
function keyIsLocal(el: Element | null, dir: Dir): boolean {
  if (el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.type === 'range') return dir === 'left' || dir === 'right';
  if (dir === 'up' || dir === 'down') return false;
  // leave a text field once the caret is at that end
  const start = el.selectionStart;
  if (start === null) return false;
  return dir === 'left' ? start > 0 || el.selectionEnd !== start : start < el.value.length;
}

function onKey(e: KeyboardEvent) {
  const dir = KEYS[e.key];
  if (!dir || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  if (keyIsLocal(active, dir)) return;

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
    const i = pickNext(active.getBoundingClientRect(), items.map((el) => el.getBoundingClientRect()), dir);
    if (i >= 0) target = items[i];
  }
  // no control that way: up/down still scroll the page, left/right do nothing (they would seek otherwise)
  if (!target) {
    if (dir === 'left' || dir === 'right') e.preventDefault();
    return;
  }
  e.preventDefault();
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

let installed = false;

/** Turns on D-pad navigation when running in the TV app. */
export function installTvNav() {
  if (installed || typeof window === 'undefined' || !isTv()) return;
  installed = true;
  document.documentElement.classList.add('tv');
  // capture: runs before the player's arrow-key seek shortcut, which skips prevented keys
  window.addEventListener('keydown', onKey, true);
}
