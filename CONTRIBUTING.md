# Contributing to Spotless

Thanks for helping out. This page covers the local setup, the scripts CI runs, and what a pull
request needs before it can be merged.

## Setup

Requirements: Node.js 22 or newer (see `engines` in `package.json`), npm, and `ffmpeg` on your
`PATH` if you want transcoding to work locally.

```bash
git clone https://github.com/Dj2Swagittarius/spotless.git
cd spotless
npm ci
cp .env.example .env   # optional; every variable has a sensible default
# put some audio files in ./music (or set MUSIC_DIR)
npm run dev
```

`npm run dev` serves the app on `http://localhost:3000`. The SQLite database, extracted album
art and backups land in `./data` (git-ignored).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | `tsc --noEmit` over the whole tree |
| `npm run lint` | ESLint (flat config in `eslint.config.mjs`, `eslint-config-next`) |
| `npm test` / `npm run test:watch` | Vitest unit tests in `src/**/__tests__/*.test.ts` |
| `npm run format` / `npm run format:check` | Prettier (`.prettierrc`) |

A repo-wide `npm run format` has not been run yet. Keep formatting changes to the files you touch,
or land a formatting-only commit on its own so reviews stay readable.

### Tests

Tests run in a plain Node environment. Anything that opens the database must set
`process.env.DATA_DIR` to a fresh temporary directory **before** importing a module that calls
`getDb()`; see `src/lib/__tests__/subsonic.test.ts` for the pattern. `better-sqlite3` is a native
module, so after switching Node versions run `npm rebuild better-sqlite3`.

## Docker test stack

`docker-compose.test.yml` is a throwaway stack that can run next to a production
`docker compose up` without touching it: it uses the container name `spotless-test`, host
port **3300** and the git-ignored `./test-env/music` and `./test-env/data` folders.

```bash
mkdir -p test-env/music test-env/data   # drop a few audio files into test-env/music
docker compose -f docker-compose.test.yml up --build
# open http://localhost:3300
docker compose -f docker-compose.test.yml down
```

`dj-test/` holds a similar stack for exercising the AI DJ against local LLM and voice servers;
copy `dj-test/docker-compose.override.example.yml` to `docker-compose.override.yml` for your
own (git-ignored) addresses.

## Pull requests

- Branch from `main`; keep each PR focused on one change.
- CI (`.github/workflows/ci.yml`) must pass: typecheck, lint, tests and a production build.
- Add or update unit tests for logic that can be exercised without a browser.
- Match the existing style: 2-space indent, single quotes, semicolons, ~120 columns, and
  comments that explain *why* rather than *what*.
- Never commit LAN addresses, hostnames, NAS paths or real credentials. `.env` files are
  git-ignored; only `.env.example` with placeholder values is committed.
- Keep the UI copy as it is unless the change is about the copy.

Security issues should not be filed as public issues; see [SECURITY.md](SECURITY.md).

## Releasing

Versions follow [SemVer](https://semver.org/): patch for fixes, minor for features, major for breaking changes.
`package.json` is the only place the number lives; everything else (Settings → About, `/api/health`, the Subsonic
`serverVersion`, image tags, GitHub Releases) reads it from there.

1. Make sure the `## [Unreleased]` section of `CHANGELOG.md` describes what is shipping.
2. On a clean `main` checkout run `npm run release -- minor` (or `patch`, `major`, or an explicit `1.2.3`).
   Add `--dry-run` to see what it would do. It bumps `package.json`, dates the changelog section, commits
   `Release vX.Y.Z` and creates the annotated tag `vX.Y.Z`.
3. Push with `git push origin main --follow-tags`. CI then builds the image tagged `:X.Y.Z`, `:X.Y` and `:latest`,
   and the release workflow creates a GitHub Release with that changelog section as its notes.
