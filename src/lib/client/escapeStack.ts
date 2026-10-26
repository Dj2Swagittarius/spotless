'use client';

import { useEffect, useRef } from 'react';

/**
 * Open overlays (menus, dialogs, panels) in the order they opened. Escape — and the Android back button, through
 * `window.__spotlessBack` — closes only the newest one, so a menu inside the queue panel goes before the panel.
 */
const stack: Array<{ close: () => void }> = [];
let listening = false;

/** Closes the newest open overlay; false when none is open. */
export function closeTopOverlay(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (closeTopOverlay()) e.preventDefault();
}

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  document.addEventListener('keydown', onKey);
  (window as unknown as { __spotlessBack?: () => boolean }).__spotlessBack = closeTopOverlay;
}

/**
 * While [open], Escape (or Android back) calls [close], newest overlay first. Focus that was left nowhere when the
 * overlay closes goes back to where it was when it opened, so a remote user is not dropped at the top of the page.
 */
export function useEscape(open: boolean, close: () => void) {
  const latest = useRef(close);
  useEffect(() => {
    latest.current = close;
  });
  useEffect(() => {
    if (!open) return;
    listen();
    const entry = { close: () => latest.current() };
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      const now = document.activeElement;
      if (opener && opener.isConnected && (!now || now === document.body || !now.isConnected)) opener.focus({ preventScroll: true });
    };
  }, [open]);
}
