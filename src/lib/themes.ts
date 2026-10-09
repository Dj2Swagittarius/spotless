// Client-side theme registry. The look itself lives in src/app/themes.css: each theme is a
// [data-theme] block that re-points the color tokens, and "remix" themes add @scope'd
// structural rules (fonts, corners, bevels, scanlines…). The choice is per device, like the
// other playback prefs, and is applied before first paint by THEME_INIT_SCRIPT.

export type ThemeMode = 'dark' | 'light';

export interface ThemeInfo {
  id: string;
  name: string;
  blurb: string;
  mode: ThemeMode;
  /** changes layout/typography/chrome, not just colors */
  remix?: boolean;
}

export const DEFAULT_THEME = 'spotless';
const KEY = 'theme';

export const THEMES: ThemeInfo[] = [
  { id: 'spotless', name: 'Spotless', blurb: 'The classic green on black', mode: 'dark' },
  { id: 'void', name: 'Void', blurb: 'True black for OLED, violet spark', mode: 'dark' },
  { id: 'midnight', name: 'Midnight', blurb: 'Deep navy, ice-blue accent', mode: 'dark' },
  { id: 'dracula', name: 'Dracula', blurb: 'The cult purple palette', mode: 'dark' },
  { id: 'nord', name: 'Nord', blurb: 'Arctic, calm, frosty', mode: 'dark' },
  { id: 'catppuccin', name: 'Catppuccin', blurb: 'Mocha pastels, mauve accent', mode: 'dark' },
  { id: 'gruvbox', name: 'Gruvbox', blurb: 'Warm retro earth tones', mode: 'dark' },
  { id: 'tokyo-night', name: 'Tokyo Night', blurb: 'Neon city after dark', mode: 'dark' },
  { id: 'rose-pine', name: 'Rosé Pine', blurb: 'Soho vibes, muted rose', mode: 'dark' },
  { id: 'forest', name: 'Forest', blurb: 'Moss green with amber light', mode: 'dark' },
  { id: 'coffee', name: 'Coffeehouse', blurb: 'Espresso, caramel and serif type', mode: 'dark', remix: true },
  { id: 'solarized', name: 'Solarized Light', blurb: 'Easy-on-the-eyes cream', mode: 'light' },
  { id: 'sakura', name: 'Sakura', blurb: 'Cherry blossom pink', mode: 'light' },
  { id: 'paper', name: 'Paper & Ink', blurb: 'Editorial print, serif headlines', mode: 'light', remix: true },
  { id: 'synthwave', name: "Synthwave '84", blurb: 'Neon sunset over the grid', mode: 'dark', remix: true },
  { id: 'vaporwave', name: 'Vaporwave', blurb: 'Ａｅｓｔｈｅｔｉｃ pastel haze', mode: 'dark', remix: true },
  { id: 'aurora', name: 'Aurora Glass', blurb: 'Frosted panels over drifting light', mode: 'dark', remix: true },
  { id: 'cyberpunk', name: 'Cyberpunk', blurb: 'Hazard yellow, cut corners, glitch', mode: 'dark', remix: true },
  { id: 'terminal', name: 'Terminal', blurb: 'Green phosphor CRT, monospace', mode: 'dark', remix: true },
  { id: 'retro98', name: 'Retro 98', blurb: 'Beveled grey windows on teal', mode: 'light', remix: true },
  { id: 'brutalist', name: 'Brutalist', blurb: 'Thick borders, hard shadows, loud', mode: 'light', remix: true },
];

const IDS = new Set(THEMES.map((t) => t.id));

export function loadTheme(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v && IDS.has(v)) return v;
  } catch {
    // ignore
  }
  return DEFAULT_THEME;
}

export function applyTheme(id: string) {
  const root = document.documentElement;
  root.dataset.theme = IDS.has(id) ? id : DEFAULT_THEME;
  // browser chrome (mobile address bar, PWA title bar) follows the app background
  const bg = getComputedStyle(root).getPropertyValue('--color-black').trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

export function saveTheme(id: string) {
  applyTheme(id);
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // ignore
  }
}

/** Inlined in <head> so the saved theme is set before first paint (no flash of the default). */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(KEY)});if(t)document.documentElement.dataset.theme=t}catch(e){}`;
