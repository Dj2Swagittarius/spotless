# Changelog

All notable changes to Spotless are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

- Tailwind CSS 4 (migrated with the official upgrade tool; theme tokens now live in `globals.css`, the UI is unchanged), `@types/node` 26, `docker/login-action` 4 and `docker/setup-qemu-action` 4.
- README refreshed: formatting, 0.2.0 features and the release flow documented.

## [0.3.0] - 2026-10-09

- Security: the internet-radio proxy now validates every redirect hop against the private-address (SSRF) block instead of letting fetch follow redirects blindly; chains longer than 5 hops are refused.
- Streaming: byte-range handling follows RFC 9110 more closely — an inverted range (bytes=500-100) is ignored rather than answered 416, and If-Range only honours an exact Last-Modified or a strong ETag.
- Artwork: a cover or artist image removed by the scanner between the existence check and the read now falls back to the placeholder instead of a 500.
- Streaming: a transcode request with a start offset answers 503 instead of the raw file from the beginning when ffmpeg is not installed.
- Subsonic API: POST form bodies larger than 1 MiB are rejected (HTTP 413, error 0) before authentication; non-form bodies are never read
- Subsonic API: invalid paging offsets (fractional, huge or non-numeric) are treated as 0 instead of failing the request; LIMIT/OFFSET are now bound parameters
- Subsonic API: a missing required id/playlistId now returns error 10 (missing parameter) instead of 70 (not found)
- Subsonic API: scrobble times before 2000-01-01 (e.g. seconds instead of milliseconds) fall back to the current time for history and Last.fm
- Subsonic API: getAlbumList/getAlbumList2 type=recent|frequent only return albums the current profile has actually played
- Subsonic API: stream/download check the audio file asynchronously, as the web stream route does
- Trending: when a region's chart cannot be fetched the page now says so instead of showing an endless loading skeleton.
- Settings: 'Re-import taste' and 'Disconnect' now show Spotify errors (reconnect required, rate limited, upstream failure) instead of failing silently.
- Search: shows a loading skeleton for the first query, and no longer leaves a previous query's Deezer results on screen when the new Deezer lookup fails.
- Playlists: a drag-and-drop reorder that the server rejects is now reverted to the stored order instead of appearing to stick.
- Radio: 'Try again' after a load error now shows the loading state while refetching.
- Library: creating a playlist with an invalid name or while logged out now shows an error instead of navigating to a broken page; the sidebar updates after a successful create.
- Discover: Lidarr download buttons on New releases and Collection gaps now show 'Failed' when the request fails instead of staying on 'Sending…'.
- Graceful shutdown now lets Next finish in-flight requests before the database is checkpointed and closed; the container exits with the conventional 143/130 code on SIGTERM/SIGINT instead of 0.
- Docker: a BACKUP_DIR that points at its own mount is made writable by PUID/PGID at start-up, the same way as /data (music mounts are never touched).
- README: TRUST_PROXY also controls X-Forwarded-Host/Proto for OAuth callbacks, the Lidarr webhook secret can be sent as an X-Webhook-Token header, DJ_PROVIDER defaults to lmstudio, and the AI DJ suggestion-verification and CI descriptions match the code.
- Player session is now saved at most twice a second (and on tab hide/close) instead of on every change, so dragging the volume slider no longer re-serialises the whole queue
- Store changes made before the saved session has been restored can no longer overwrite it
- A track that never starts producing audio is now treated as a stall after 12 s: Auto quality steps down and a hung transcode is reloaded instead of buffering forever
- Scrubbing the seek bar no longer counts toward a track's play/scrobble threshold
- Repeat-one on a transcoded track now restarts from the beginning instead of from the last seek point
- DJ voice ducking no longer changes (or persists) the volume setting; the slider keeps showing the real volume and a reload mid-segue comes back at full volume
- AI DJ: chat, speak, segue and transcribe are rate-limited per profile (defaults 20/60/30/30 per minute; `DJ_RATE_LIMIT_PER_MIN` overrides, 0 disables) and answer 429 with Retry-After when exceeded.
- AI DJ: the DJ no longer creates playlists on its own; it proposes one and you confirm (or dismiss) it from the chat before anything is saved.
- AI DJ: library tags (titles, artists, genres) are treated as untrusted data in the model prompt.
- AI DJ: the Anthropic provider now uses the configured Server URL, so gateways and proxies work.
- AI DJ: faster replies on large libraries; the library index is cached between messages and tracks are fetched in one query.
- AI DJ: voice uploads over the 10 MB limit are rejected before being read; non-admin profiles no longer see provider hostnames in error messages (the admin still does).
- AI DJ: Ollama now receives the reply JSON schema for more reliable structured answers.
- AI DJ: leaving the DJ page while recording releases the microphone immediately; a failed 'Get this artist' request no longer stays on 'Adding…'.
- Malformed LMSTUDIO_URL / OLLAMA_URL / TTS_URL / STT_URL values are ignored with a startup warning instead of breaking DJ error handling.
- Spotify: connecting now succeeds even when the first taste import fails (e.g. rate limit or dev-mode allowlist); the callback redirects with spotify=connected&spotify_warning=... instead of reporting a failed connection, and Re-import in Settings retries the import.
- Spotify: a 401 from the Spotify Web API now disconnects the profile (drops the stored tokens) so Settings offers Connect again instead of showing Connected while every import fails.
- Radio: a fractional ?limit (e.g. 1.5) no longer causes a 500; it is floored to an integer before the query.
- Security: the CSRF origin check matches a browser Origin against the Host header or X-Forwarded-Host, so reverse proxies that rewrite Host keep working; building OAuth callback URLs from X-Forwarded-* still requires TRUST_PROXY.
- Fonts are self-hosted (Figtree, Bricolage Grotesque; OFL) so builds no longer download from Google Fonts.

## [0.2.0] - 2026-10-08

- The app version comes from package.json alone and is shown in Settings → About, in `/api/health` (with the build commit) and as the Subsonic `serverVersion`. `npm run release -- <major|minor|patch>` bumps it, dates this changelog and tags the commit; CI turns the tag into versioned image tags and a GitHub Release.

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
