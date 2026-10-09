#!/usr/bin/env node
// Cut a Spotless release in one step:
//   npm run release -- <major|minor|patch|x.y.z> [--dry-run] [--any-branch] [--offline]
// bumps package.json (and the lockfile), moves the CHANGELOG "Unreleased" notes under the new
// version with today's date, commits "Release vX.Y.Z" and creates an annotated tag vX.Y.Z.
// Pushing that tag (`git push origin main --follow-tags`) makes CI test, publish the image tags
// (:X.Y.Z and :X.Y) and then create a GitHub Release whose notes are that CHANGELOG section.
//
//   node scripts/release.mjs --notes <x.y.z>
// prints the CHANGELOG section for a version (used by the release job in CI).

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Paths are anchored to the repo, not the caller's cwd, so the script works from anywhere.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');
const PACKAGE = path.join(ROOT, 'package.json');
const LOCKFILE = path.join(ROOT, 'package-lock.json');
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));

// No shell: every argument is passed as-is, so nothing in a version or branch name is interpreted.
function run(cmd, cmdArgs, extra = {}) {
  return execFileSync(cmd, cmdArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...extra }).trim();
}
const git = (...gitArgs) => run('git', gitArgs);

// `npm run release` sets npm_execpath to npm's own JS entry point, which node can run directly.
// That sidesteps the npm.cmd shim, which execFile refuses to spawn on Windows without a shell.
// Outside `npm run` fall back to the npm on PATH, with a shell only where the shim needs one.
function npm(...npmArgs) {
  const cli = process.env.npm_execpath;
  if (cli) return run(process.execPath, [cli, ...npmArgs]);
  return run('npm', npmArgs, { shell: process.platform === 'win32' });
}

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

/** Body of the "## [version]" section (text up to the next "## " heading), '' when absent. */
function changelogSection(text, version) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start === -1) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
}

if (flags.has('--notes')) {
  const version = positional[0];
  if (!version) fail('usage: node scripts/release.mjs --notes <x.y.z>');
  const body = changelogSection(readFileSync(CHANGELOG, 'utf8'), version);
  if (!body) fail(`CHANGELOG.md has no "## [${version}]" section`);
  process.stdout.write(body + '\n');
  process.exit(0);
}

const spec = positional[0];
if (!spec) fail('usage: npm run release -- <major|minor|patch|x.y.z> [--dry-run] [--any-branch] [--offline]');

const pkg = JSON.parse(readFileSync(PACKAGE, 'utf8'));
const current = pkg.version;
if (!SEMVER.test(current)) fail(`package.json version "${current}" is not semver`);

/** Next version, following `npm version`: bumping a prerelease (1.2.0-beta.1) finalises it first. */
function bump(from, how) {
  if (SEMVER.test(how)) return how;
  const [, majorStr, minorStr, patchStr, prerelease] = from.match(SEMVER);
  const [major, minor, patch] = [majorStr, minorStr, patchStr].map(Number);
  if (prerelease) {
    if (how === 'patch') return `${major}.${minor}.${patch}`;
    if (how === 'minor') return patch === 0 ? `${major}.${minor}.0` : `${major}.${minor + 1}.0`;
    if (how === 'major') return minor === 0 && patch === 0 ? `${major}.0.0` : `${major + 1}.0.0`;
  } else {
    if (how === 'major') return `${major + 1}.0.0`;
    if (how === 'minor') return `${major}.${minor + 1}.0`;
    if (how === 'patch') return `${major}.${minor}.${patch + 1}`;
  }
  return fail(`"${how}" is not major, minor, patch or a version like 1.2.3`);
}

const next = bump(current, spec);
const tag = `v${next}`;

// Preflight: releases come from a clean main checkout so the tag points at what CI tested.
const branch = git('branch', '--show-current');
if (branch !== 'main' && !flags.has('--any-branch')) fail(`on branch "${branch}", not main (pass --any-branch to override)`);
if (git('status', '--porcelain')) fail('working tree is not clean; commit or stash first');
if (git('tag', '-l', tag)) fail(`tag ${tag} already exists`);
if (!flags.has('--offline')) {
  // A tag that already exists on origin would make the push fail after the commit is made.
  let remote;
  try {
    remote = git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`);
  } catch {
    fail('could not reach origin to check for an existing tag (pass --offline to skip)');
  }
  if (remote) fail(`tag ${tag} already exists on origin`);
}

let changelog = readFileSync(CHANGELOG, 'utf8');
const nl = changelog.includes('\r\n') ? '\r\n' : '\n';
const alreadyListed = Boolean(changelogSection(changelog, next));
const unreleased = changelogSection(changelog, 'Unreleased');
if (!alreadyListed && !unreleased) fail('CHANGELOG.md "## [Unreleased]" is empty; write the release notes first');

const date = new Date().toISOString().slice(0, 10);
const plan = [
  `version   ${current} -> ${next}${current === next ? ' (unchanged)' : ''}`,
  `changelog ${alreadyListed ? `"## [${next}]" already present` : `move Unreleased notes under "## [${next}] - ${date}"`}`,
  `tag       ${tag}`,
];
console.log(plan.join('\n'));
if (flags.has('--dry-run')) {
  console.log('\n--dry-run: nothing written');
  process.exit(0);
}

// Everything below mutates the tree; any failure puts the files back so nothing is half-released.
const staged = [];
try {
  if (current !== next) {
    pkg.version = next;
    writeFileSync(PACKAGE, JSON.stringify(pkg, null, 2) + '\n');
    // package-lock.json carries the version twice; let npm rewrite it without touching node_modules.
    npm('install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund');
    staged.push(PACKAGE, LOCKFILE);
  }
  if (!alreadyListed) {
    // Keep a fresh, empty Unreleased heading on top; the old notes now sit under the version.
    changelog = changelog.replace(/^## \[Unreleased\][^\r\n]*\r?\n/m, `## [Unreleased]${nl}${nl}## [${next}] - ${date}${nl}`);
    writeFileSync(CHANGELOG, changelog);
    staged.push(CHANGELOG);
  }
  if (staged.length) {
    git('add', ...staged);
    git('commit', '-q', '-m', `Release ${tag}`);
  }
  git('tag', '-a', tag, '-m', `Spotless ${tag}`);
} catch (err) {
  try {
    git('checkout', '--', PACKAGE, LOCKFILE, CHANGELOG);
  } catch {
    // the restore is best effort; the error below tells the user what to check
  }
  fail(`${err instanceof Error ? err.message : String(err)}\nworking tree restored; nothing was committed or tagged`);
}

console.log(`\nTagged ${tag}. Publish it with:\n\n  git push origin ${branch} --follow-tags\n`);
