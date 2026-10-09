'use client';

import { useSyncExternalStore } from 'react';
import { THEMES, DEFAULT_THEME, saveTheme, type ThemeInfo } from '@/lib/themes';

// source of truth is <html data-theme> (set pre-paint by THEME_INIT_SCRIPT, then by saveTheme)
const subscribe = (onChange: () => void) => {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => obs.disconnect();
};
const readTheme = () => document.documentElement.dataset.theme ?? DEFAULT_THEME;

/**
 * Grid of live theme previews. Each card is wrapped in its own [data-theme], so it renders
 * with that theme's real tokens and @scope'd chrome instead of hand-copied swatch colors.
 */
export default function ThemePicker() {
  const current = useSyncExternalStore(subscribe, readTheme, () => null);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <ThemeCard key={t.id} theme={t} active={current === t.id} onPick={() => saveTheme(t.id)} />
      ))}
    </div>
  );
}

function ThemeCard({ theme, active, onPick }: { theme: ThemeInfo; active: boolean; onPick: () => void }) {
  return (
    // the ring sits outside the preview's [data-theme], so it uses the page theme's accent
    <div className={`rounded-lg p-0.5 ${active ? 'bg-accent' : 'bg-transparent'}`}>
      <div data-theme={theme.id} className="overflow-hidden rounded-md font-sans text-white">
        <button
          type="button"
          role="radio"
          aria-checked={active}
          onClick={onPick}
          className="block w-full text-left transition-transform hover:scale-[1.02]"
        >
          <div className="theme-swatch flex h-24 gap-1.5 bg-black p-1.5" aria-hidden>
            <div className="app-panel flex w-1/4 flex-col gap-1.5 rounded-sm bg-base p-1.5">
              <span className="h-1.5 w-3/4 rounded-full bg-white" />
              <span className="h-1.5 w-1/2 rounded-full bg-subdued/60" />
              <span className="h-1.5 w-2/3 rounded-full bg-subdued/60" />
            </div>
            <div className="app-main flex flex-1 flex-col gap-1.5 overflow-hidden rounded-sm bg-linear-to-b from-highlight to-base p-1.5">
              <span className="text-[11px] font-bold leading-none">Aa</span>
              <div className="flex gap-1">
                <span className="h-6 w-6 rounded-sm bg-card" />
                <span className="h-6 w-6 rounded-sm bg-card" />
                <span className="h-6 w-6 rounded-sm bg-card" />
              </div>
              <div className="mt-auto flex items-center gap-1.5">
                <span className="h-4 w-4 rounded-full bg-accent" />
                <span className="h-1 flex-1 rounded-full bg-border">
                  <span className="block h-full w-1/2 rounded-full bg-accent" />
                </span>
              </div>
            </div>
          </div>
          <div className="bg-elevated px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-bold">{theme.name}</span>
              {theme.remix && (
                <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold uppercase leading-4 text-black">
                  Remix
                </span>
              )}
            </div>
            <div className="truncate text-xs text-subdued">{theme.blurb}</div>
          </div>
        </button>
      </div>
    </div>
  );
}
