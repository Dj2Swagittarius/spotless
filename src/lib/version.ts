import pkg from '../../package.json';

/**
 * Single source of truth for the app version: package.json. Bump it with
 * `npm run release -- <major|minor|patch>` (scripts/release.mjs), which also moves the
 * CHANGELOG "Unreleased" notes under the new version and tags the commit as vX.Y.Z; CI then
 * publishes the matching image tags and a GitHub Release.
 */
export const APP_VERSION: string = pkg.version;

/**
 * Short commit the running build came from. Docker builds pass GIT_SHA (and keep it in the
 * runtime image); local builds pick it up from git via next.config.mjs. Null when unknown.
 */
export const APP_COMMIT: string | null =
  (process.env.GIT_SHA || process.env.NEXT_PUBLIC_APP_COMMIT || '').trim().slice(0, 7) || null;

export const REPO_URL = 'https://github.com/Dj2Swagittarius/spotless';

/** Identifies Spotless to third-party APIs (LRCLIB asks for a contactable User-Agent). */
export const USER_AGENT = `Spotless/${APP_VERSION} (${REPO_URL})`;

/** "0.2.0 (a1b2c3d)" or just "0.2.0" when the commit is unknown. */
export function versionLabel(): string {
  return APP_COMMIT ? `${APP_VERSION} (${APP_COMMIT})` : APP_VERSION;
}
