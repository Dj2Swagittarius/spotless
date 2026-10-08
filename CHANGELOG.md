# Changelog

All notable changes to Spotless are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

- Playlists are owned per profile; other profiles can no longer modify or delete them.
- Tracks keep their likes, history and playlist entries when a file is renamed or moved (relink instead of delete + re-add).
- Subsonic: `getMusicDirectory`, OpenSubsonic extension advertisement and POST request bodies are supported.
- Subsonic recently-played lists are per user instead of shared.
- Scrobbles are only sent after the track has played past the Last.fm threshold.
- Cold start no longer picks the wrong streaming quality before the connection has been measured.
- Crossfade, seek and pause interactions no longer desync the two audio elements.
- The play queue is persisted and restored across reloads.
- Keyboard shortcuts for play/pause, next, previous, seek and volume.
- Streaming honours `Range` requests and `ETag`/conditional headers correctly.
- Concurrent ffmpeg transcodes are capped.
- Files that already fit the requested quality are served raw instead of being transcoded.
- **Breaking:** internet radio stations whose stream URL is a loopback, LAN (RFC 1918) or link-local IP address are refused (saving returns a specific error; playing returns 403) so the station proxy cannot reach other services on the network. Set `ALLOW_PRIVATE_STREAM_URLS=1` to allow them; stations addressed by hostname are unaffected.
- Last.fm login uses a state cookie to protect the callback.
- Spotify API errors are reported to the UI instead of failing silently.
- Dedicated 404 and error pages.
- Multi-disc albums are ordered by disc, then track.
- Docker: entrypoint fixes `./data` ownership and drops to the `node` user; `PUID`/`PGID` are honoured.
- Docker: `HEALTHCHECK` against `GET /api/health`; the endpoint returns 503 when the database is unreachable.
- Docker: `docker-compose.yml` passes a host-side `.env` into the container, so `.env.example` configures both `next dev` and Docker.
- Docker: multi-arch (amd64 + arm64) image published to GHCR; semver tags on `v*` releases.
- CI: typecheck, lint, tests and build run on every pull request and push to `main`.
- Unit tests (Vitest) for scanner normalisation, Subsonic authentication, auth helpers and lyrics parsing.
- ESLint (flat config) and Prettier configuration; `npm run lint` is part of CI.
- AI DJ speak/transcribe routes require a signed-in session.
- Graceful shutdown on `SIGTERM`/`SIGINT` checkpoints and closes the database.
- Backups are written atomically, integrity-checked, and `BACKUP_DIR` can point them elsewhere.

## [0.1.0]

Initial public version.
