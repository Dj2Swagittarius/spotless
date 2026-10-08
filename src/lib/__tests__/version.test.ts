import { execFileSync } from 'child_process';
import path from 'path';
import { describe, expect, it } from 'vitest';
import pkg from '../../../package.json';
import { APP_VERSION, REPO_URL, USER_AGENT, versionLabel } from '@/lib/version';

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

describe('version', () => {
  it('comes from package.json and is semver', () => {
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION).toMatch(SEMVER);
  });

  it('identifies itself to third-party APIs with the version and repo', () => {
    expect(USER_AGENT).toBe(`Spotless/${APP_VERSION} (${REPO_URL})`);
  });

  it('labels the build with the version first', () => {
    expect(versionLabel().startsWith(APP_VERSION)).toBe(true);
  });

  it('has a CHANGELOG section the release workflow can publish', () => {
    const script = path.resolve(__dirname, '../../../scripts/release.mjs');
    const notes = execFileSync(process.execPath, [script, '--notes', APP_VERSION], { encoding: 'utf8' });
    expect(notes.trim().length).toBeGreaterThan(0);
  });
});
