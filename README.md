# Spotless

Self-hosted, single-container music streamer with a Spotify-style interface.

Point it at a folder of music and it gives you a dark-themed player with profiles, discovery, a 10-band EQ,
internet radio, an optional AI DJ, and Lidarr, Spotify and Last.fm integrations. Everything runs from one Docker
image with an SQLite database; your audio files stay where they are and are only ever read.

Acknowledgements: Spotless builds on the original Spotless project by lateshift.tech (see [LICENSE](LICENSE));
thanks to its authors and contributors for the foundation this version grows from.


![Home](docs/home.png)

| Discover — suggestions, new releases, collection gaps | Artist pages |
| --- | --- |
| ![Discover](docs/discover.png) | ![Artist](docs/artist.png) |

| Trending charts | Listening stats |
| --- | --- |
| ![Trending](docs/trending.png) | ![Stats](docs/stats.png) |

Per-device streaming quality — original files, a fixed MP3 tier, or **Auto**, which follows your
connection and steps down when the network can't keep up:

![Streaming quality](docs/settings-playback.png)

<p align="center">
  <img src="docs/mobile-home.png" width="32%" alt="Mobile home" />
  &nbsp;
  <img src="docs/mobile-nowplaying.png" width="32%" alt="Mobile now playing" />
</p>

## Features

**Player**

- Gapless playback and configurable crossfade (0–12s), dual-audio-element engine

- Adaptive streaming quality (Auto): full quality on Wi-Fi, a lighter stream on mobile data,

  and a step down the moment playback starts to stutter — the song resumes from where it was,

  not from the top. Recovers a stream that dies mid-song instead of leaving it stalled

- Radio mode: any song seeds an endless queue of similar tracks from your own library

- Queue with drag-to-reorder, shuffle, repeat (off/all/one), sleep timer

- ReplayGain volume normalization (read from tags)

- 10-band graphic equalizer (31 Hz – 16 kHz, ±12 dB) with 13 presets or your own curve;

  per device, and switching it off is an exact bypass

- Internet radio: add any Icecast/Shoutcast stream by URL under **Radio** in the sidebar and it

  plays through the same player (stations are exposed to Subsonic apps too)

- Synced lyrics with **local sidecar `.lrc` files taking priority**, followed by cached/LRCLIB

  fallback when no matching local lyrics file is available

- Media Session API: lock-screen / media-key controls

- Full-screen mobile now-playing, mini-player, responsive layout, installable PWA manifest

**Library**

- Scans MP3, FLAC, M4A, AAC, OGG, OPUS, WAV; extracts tags + embedded album art

- Smart artist matching: feature credits ("A feat. B"), case, diacritics (Tiësto = Tiesto) and

  punctuation variants fold into one artist; self-healing dedupe runs on every scan

- Home feed: recently played, top tracks, artist/genre/decade mixes, forgotten favorites, recently added

- Search: fuzzy local search plus "not in your library" results from Deezer with 30-second previews

- Playlists with drag-reorder and mosaic covers; liked songs; listening stats (tops, activity, periods)

- Duplicate-file report (same song stored twice, e.g. MP3 + FLAC)

- Album/artist artwork repair: local `cover`/`folder`/`front` images first, then conservative exact-match Deezer backfill; nightly database backups

- Optional automatic library refresh from **Settings → Music library**: Off by default, or

  every 5 / 15 / 30 minutes, 1 / 3 / 6 / 12 / 24 hours. Scans never overlap, unchanged

  files are skipped using their modification time, and a manual rescan resets the next timer

- Same-basename local `.lrc` sidecar support — for example `Song.flac` + `Song.lrc`.

  Spotless reads local sidecars first; if none exists, playback/API lyrics fall back to the SQLite cache and LRCLIB

- Optional **automatic synced `.lrc` download** from **Settings → Music library**. After every successful

  library scan, Spotless checks tracks missing a sidecar, requests **synchronized lyrics only** from LRCLIB,

  and saves them beside the audio file. Existing `.lrc`/`.LRC` files are never overwritten

**Multi-user**

- Netflix-style "Who's listening?" profile picker with per-profile web authentication

- Each profile signs in with its own password; passwords are never stored in plaintext

- Opaque server-side sessions use an `HttpOnly`, `SameSite=Lax` cookie instead of trusting a profile ID from the browser

- Per-profile likes, history, playlists, stats, discovery taste, and hidden artists

- The first profile is the admin: server settings (music folder, scans, Lidarr) are hidden from and blocked (HTTP 403) for everyone else

- Admin-only profile management is available from **Manage profiles** (`/users`): create profiles, set/reset passwords, and revoke a user's existing web sessions

- Regular users can change only their own password and must provide their current password

- Existing passwordless installations have a one-time migration path: profile 1 can claim the first admin password only while no web password exists anywhere in the database

**AI DJ** (local by default; nothing leaves your server unless you pick a hosted provider)

- Chat with a music-nerd DJ that knows each profile's library, play history, likes, Spotify taste and Discover picks

- "Start my DJ" builds a set from your library and plays it; ask for a mood, an artist, a genre, or a playlist and it does it

- Creates playlists for you; songs you don't own are kept as placeholders that fill in after a future scan

- Suggests songs you don't have yet, with Deezer previews and a one-click Lidarr add

- Talks: speaks its replies and introduces songs between tracks (music ducks while it talks), like a radio host

- Push-to-talk voice input through a local Whisper server

- Brains: LM Studio (default) or Ollama, both local, any OpenAI-compatible server, or OpenAI, Anthropic, Gemini, Mistral, DeepSeek, xAI, Groq, OpenRouter

- Voice: a local speech server such as Kokoro-FastAPI (default), on-device browser voices, or OpenAI / ElevenLabs

**Discovery** (no API keys needed — Deezer + Apple RSS public endpoints)

- Per-profile artist suggestions based on listening history, with "not interested" dismissals

- New releases from artists you already have

- "Complete your collection": studio albums you're missing, repackage/remix noise filtered out

- Trending: country charts with region picker, genre rows, "trending for you" genre blend

**Mobile apps (Subsonic / OpenSubsonic API)**

- Spotless implements the Subsonic API, so mature native apps work out of the box:

  **Amperfy (iOS)**, **Symfonium**, **DSub**, **Substreamer**, **play:Sub** and friends — with

  the offline download/sync those apps provide

- Lyrics API support includes both the legacy Subsonic **`getLyrics`** endpoint for plain-text

  lyrics and OpenSubsonic **`getLyricsBySongId`** via the **`songLyrics` v1** extension for

  structured synchronised lyrics

- Compatible clients such as **Amperfy** can receive synced lyrics automatically through the

  Subsonic/OpenSubsonic API; local same-basename `.lrc` files are preferred over LRCLIB results

- On-the-fly **transcoding** via ffmpeg (mp3/ogg/opus/aac, client-requested bitrate) for

  streaming big FLAC libraries over mobile data

- Each profile gets its own generated app password (Settings → Mobile apps); stars,

  scrobbles and playlists from the app land on the right profile

**Integrations** (optional)

- **Lidarr**: one-click add + search for a whole artist or one specific album; live download

  queue widget; webhook triggers a library rescan when imports finish.

  Non-admin profiles don't download directly — they file requests, and the admin

  approves or denies them from a queue on the Discover page.

- **Spotify**: per-profile PKCE connect imports your taste (top + saved artists) to seed

  discovery, and can rebuild your Spotify playlists from matching local files. Requires

  creating a (free) Spotify app and setting `SPOTIFY_CLIENT_ID`.

  The OAuth callback supports both the default loopback URL and a configurable HTTPS

  reverse-proxy domain through **Settings → Spotify** or the `SPOTIFY_REDIRECT_URI`

  environment variable

- **Last.fm**: the admin pastes a Last.fm API key + shared secret once (Settings → Last.fm),

  then each profile connects its own account. Every play from the web player and from

  Subsonic apps is scrobbled, with now-playing updates, to whoever is listening.

## Quick start (Docker)

1. Edit `docker-compose.yml` — point the music volume at your library:

```yaml

environment:

 - MUSIC_WRITE_DIR=/music-write

volumes:

 # Normal scanning/streaming access remains read-only.

 - /path/to/your/music:/music:ro

 # Same library mounted separately for the optional generated .lrc writer.

 - /path/to/your/music:/music-write:rw

 - ./data:/data

```

2. Build and run:

```bash

docker compose up -d --build

```

3. Open `http://<server-ip>:3000` — a setup wizard walks you through creating the first profile

   (which becomes the admin) **and its web password**, scanning your library, and the optional

   Lidarr and Spotify hookups. Every step is skippable except establishing the initial admin

   authentication needed to protect the web UI.

   ![Setup wizard](docs/setup.png)

## Run the prebuilt image

CI publishes a multi-arch image (amd64 + arm64) to `ghcr.io/dj2swagittarius/spotless:latest`; tagged releases
also get `:<major>.<minor>` and `:<version>` tags. The supplied `docker-compose.yml` already references it, so
instead of building locally you can:

```bash
docker compose pull && docker compose up -d
```

On first start the container runs as root just long enough to make the bind-mounted `./data` folder writable
(Docker creates it root-owned), then drops to an unprivileged user. Set `PUID` / `PGID` in the `environment:`
block to the uid/gid that should own `./data` (the defaults are `1000` / `1000`; `id -u` and `id -g` print yours).
Only `/data` is ever chowned; your music mount is never touched.

The image includes a `HEALTHCHECK` against `GET /api/health`, which returns `200 { "ok": true }` while the
database is reachable and `503` otherwise, so `docker ps` and orchestrators can see when Spotless is actually up.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `MUSIC_DIR` | `/music` | Read path scanned/streamed by Spotless |
| `MUSIC_WRITE_DIR` | same as `MUSIC_DIR` outside Docker; `/music-write` in supplied Dockerfile | Optional write mirror used only to create generated `.lrc` sidecars |
| `DATA_DIR` | `/data` | SQLite DB, extracted album art, nightly backups |
| `PORT` | `3000` | HTTP port |
| `SPOTIFY_CLIENT_ID` | *(none)* | Optional; enables the Spotify taste/playlist import |
| `SPOTIFY_REDIRECT_URI` | `http://127.0.0.1:3000/api/spotify/callback` | Optional deployment default for Spotify OAuth; Settings → Spotify overrides it |
| `FFMPEG_PATH` | `ffmpeg` | Path to ffmpeg (bundled in the Docker image) |
| `TRANSCODE_MAX_ACTIVE` | number of CPU cores | Maximum concurrent ffmpeg transcodes; once reached, extra listeners get the raw file instead of a transcode (or `503` when they asked to start mid-track) |
| `ALLOW_PRIVATE_STREAM_URLS` | *(off)* | Set to `1` to let internet radio stations point at loopback, LAN (RFC 1918) or link-local IP addresses, e.g. an Icecast box on `192.168.x.x`. Off by default so the station proxy cannot be used to read other services on your network; stations addressed by hostname are unaffected |
| `LIDARR_WEBHOOK_SECRET` | *(none)* | Optional; if set, the Lidarr webhook requires `?token=<secret>` |
| `AUTH_SECURE_COOKIE` | *(auto)* | Force the web session cookie to `Secure`; use `true` behind HTTPS if proxy detection is unavailable |
| `OLLAMA_URL` / `LMSTUDIO_URL` | `http://localhost:11434` / `http://localhost:1234/v1` | AI DJ: default local LLM server URLs |
| `TTS_URL` / `STT_URL` | `http://localhost:8880/v1` / `http://localhost:8000/v1` | AI DJ: default local voice and speech recognition servers |
| `DJ_MODEL` | *(none)* | AI DJ: default model id |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `ELEVENLABS_API_KEY` | *(none)* | AI DJ: optional keys for hosted providers (keys saved in Settings take priority) |
| `AUTH_MIN_PASSWORD_LENGTH` | `4` | Minimum web password length. `4` allows a PIN on a home network; raise it (e.g. `12`) if Spotless is reachable from the internet |
| `TRUST_PROXY` | *(off)* | Number of reverse-proxy hops in front of Spotless (usually `1`). Lets login throttling read the client IP from `X-Forwarded-For`; leave unset when clients connect directly, because the header can be forged |
| `DJ_PROVIDER` | `ollama` | AI DJ: default LLM provider id (Settings → AI DJ overrides it) |
| `BACKUP_DIR` | `DATA_DIR/backups` | Where the daily database backups are written |
| `LOG_LEVEL` | `info` | Server log verbosity: `debug`, `info`, `warn` or `error` |
| `HOSTNAME` | `0.0.0.0` | Bind address of the production server |
| `PUID` / `PGID` | `1000` / `1000` | Docker only: uid/gid that owns `/data` and runs the app (see *Run the prebuilt image*) |

Automatic library refresh is configured inside **Settings → Music library** and is stored
in `DATA_DIR/library.db`; no environment variable is required. The default is **Off**.
Spotless still performs its existing startup scan and manual/Lidarr-triggered scans when
automatic refresh is disabled. Recurring intervals are measured from the completion of the
latest scan, so scans do not overlap.

Automatic synchronized sidecar download is also configured in **Settings → Music library** and
is **Off by default**. When enabled, every successful startup/manual/automatic/Lidarr-triggered
scan starts a background check for missing lyrics. Spotless talks directly to the LRCLIB API,
requests only synchronized lyrics, throttles batch requests, honors rate-limit responses, and
never overwrites an existing `.lrc` or `.LRC` file. LRCLIB misses/plain-only results are retried
later rather than queried on every short scan interval.

The supplied Docker configuration keeps the normal application library at `/music:ro` and mounts
the same host folder a second time at `/music-write:rw`. Only the sidecar downloader maps track
paths to that write mount. If your host permissions do not allow the container user to create
files there, the Settings page will report a lyrics write error and your music files remain untouched.

Lidarr is configured in the app (Settings → Lidarr: URL + API key). To get automatic
rescans after Lidarr imports, add a webhook in Lidarr → Settings → Connect →
Webhook pointing at `http://<spotless-host>:3000/api/lidarr/webhook`. If you set
`LIDARR_WEBHOOK_SECRET`, append `?token=<secret>` to that URL — otherwise the webhook is
unauthenticated. Keep that endpoint restricted to a trusted network or set a webhook secret.

### Web authentication and profile management

Spotless uses normal username/profile + password authentication for the web UI.

- The browser receives only an opaque random session cookie named `spotless_session`.

- The session cookie is `HttpOnly` and `SameSite=Lax`; it is also marked `Secure` when Spotless detects HTTPS.

- Authentication state is validated server-side against SQLite. The old plain `uid` cookie is not trusted as authentication.

- Web passwords are hashed with Node's memory-hard `scrypt`; plaintext web passwords are never stored.

- Login attempts are progressively rate-limited after repeated failures. Without `TRUST_PROXY` the limit is per profile (so failed guesses from anyone can briefly delay that profile's sign-in); with `TRUST_PROXY` set to your proxy hop count it is per profile and client IP.

- Password checks run off the main thread and at most two at a time; excess sign-in attempts get HTTP 429, so a login flood can't stall playback.

- Mutating `/api/*` requests are protected by same-origin checks in addition to the SameSite cookie policy.

- Password changes/resets revoke the affected user's existing web sessions.

- The Lidarr webhook and Subsonic/OpenSubsonic `/rest/*` authentication remain separate from browser-session authentication.

#### Creating and managing users

The first profile is the administrator.

Open the profile menu and choose **Manage profiles**, or go directly to:

```text

/users

```

The admin can:

- create new profiles and assign their initial passwords

- set or reset passwords for existing profiles

- revoke a user's existing browser sessions by resetting that user's password

Non-admin profiles can change only their own password, and must enter their current password.


#### Upgrading an existing passwordless installation

Back up the database before upgrading:

```bash

cp ./data/library.db ./data/library.db.pre-auth-backup

```

After rebuilding and starting the new version:

1. Open Spotless normally.

2. Select profile 1 (the existing admin).

3. If the database contains existing profiles but **no web password has ever been configured**, Spotless offers a one-time **Create admin password** flow.

4. Create an admin password or PIN (at least `AUTH_MIN_PASSWORD_LENGTH` characters, default 4).

5. Sign in and open **Manage profiles**.

6. Assign passwords to the other existing profiles.

Existing non-admin profiles remain locked until the admin assigns them a web password.

The one-time admin claim is available only while profile 1 has no password and there are no configured web passwords anywhere in the database. Once the first admin password has been created, that bootstrap path is closed.

Do this migration while the old passwordless installation is still restricted to a trusted network.

#### HTTPS and secure cookies

Authentication protects the application account boundary, but it does **not** replace transport encryption.

For remote access, use HTTPS through a reverse proxy or use a private network/VPN such as Tailscale or WireGuard. Do not expose plain HTTP directly to the public Internet.

If Spotless is behind an HTTPS reverse proxy, make sure the proxy forwards the original host/protocol, including:

```text

X-Forwarded-Proto: https

```

Spotless will then automatically use a `Secure` session cookie.

If your proxy setup prevents protocol detection, you can force secure cookies:

```yaml

environment:

  - AUTH_SECURE_COOKIE=true

```

Do **not** force `AUTH_SECURE_COOKIE=true` when accessing Spotless directly over plain HTTP, because browsers will not send a Secure cookie over HTTP.

### Connecting a mobile app

Open **Settings → Mobile apps** on the profile you want to use — it shows the server URL,

username and a generated app password. Add those as a Subsonic server in Amperfy, Symfonium,

DSub, Substreamer, play:Sub or any other compatible client.

Spotless supports both:

- Legacy Subsonic **`getLyrics`** for plain-text lyrics

- OpenSubsonic **`getLyricsBySongId`** through **`songLyrics` v1** for synchronized,

  timestamped lyrics

When synchronized lyrics are requested, Spotless first looks for a same-basename `.lrc`

file beside the audio file:

```text

/music/Artist/Album/Song.flac

/music/Artist/Album/Song.lrc

```

If a local `.lrc` exists, it takes priority. Otherwise Spotless uses its cached lyrics and

falls back to LRCLIB. Compatible apps such as **Amperfy** can therefore display synchronized

lyrics directly from your local music library.

If **Automatic synced lyrics sidecars** is enabled in Settings, Spotless also persists missing

synchronized LRCLIB results as same-basename `.lrc` files after each successful library scan.

Only `syncedLyrics` is written; plain-only results are not written as `.lrc`.

Downloads/offline mode and bitrate/transcoding options are handled by the client app.


### Spotify setup (optional)

1. Create an app at <https://developer.spotify.com/dashboard>.

2. Set `SPOTIFY_CLIENT_ID` to the app's client ID (no secret needed — Spotless uses PKCE).

3. Choose the callback you will use:

  - **Local/default:** `http://127.0.0.1:3000/api/spotify/callback`
  
  - **Reverse proxy:** open **Settings → Spotify** as the admin and enter your public domain,
  
       for example:
  
  ```text
  
   music.example.com
  
  ```
  
       Spotless will automatically use:
  
  ```text
  
   https://music.example.com/api/spotify/callback
  
  ```
  
  - Alternatively, set the deployment-level `SPOTIFY_REDIRECT_URI` environment variable to
  
       the complete callback URI:
  
  ```text
  
   SPOTIFY_REDIRECT_URI=https://music.example.com/api/spotify/callback
  
  ```
  
  - A domain saved in **Settings → Spotify** takes precedence over
  
       `SPOTIFY_REDIRECT_URI`. If neither is configured, Spotless falls back to
  
       `http://127.0.0.1:3000/api/spotify/callback`.

4. Add the **exact** callback URI shown in Settings to your Spotify app's Redirect URIs.

   For example:

```text

https://music.example.com/api/spotify/callback

```

   Spotify requires HTTPS for non-loopback web redirects. Plain HTTP is supported for

   loopback IP literals such as `127.0.0.1`.

5. Click **Connect Spotify**. If a public callback domain is configured and you opened

   Spotless through a LAN/IP address, Spotless redirects the browser to the configured

   public origin with a single-use, two-minute link that carries your signed-in profile, so

   you don't need to be signed in on that origin. The OAuth state and target profile are kept

   server-side; the browser can't choose which profile the Spotify account is attached to.

   You land on the public origin afterwards; sign in there once if you want to keep using it.

6. While the Spotify app is in development mode, add each Spotify account that will connect

   under User Management in the Spotify developer dashboard.


### Last.fm setup (optional)

1. Create a free API account at <https://www.last.fm/api/account/create> (any name, callback URL can stay blank)

2. As the admin profile, paste the API key and shared secret into **Settings → Last.fm** and hit **Test & save**

3. Each profile then clicks **Connect Last.fm** on the same page to link its own account


### AI DJ

Open **Settings → AI DJ** as the admin profile. Everything defaults to servers on your own machine:

1. **Brain:** in [LM Studio](https://lmstudio.ai) (the default) download a model such as `openai/gpt-oss-20b`, open the Developer tab and start the server (enable "Serve on Local Network" when Spotless runs in Docker or on another machine). [Ollama](https://ollama.com) (`ollama pull gpt-oss:20b`) works too. Pick the provider, hit **Load models**, choose one and **Test model**. gpt-oss reasons before answering, so it picks better sets but is slower; Qwen 3 or Gemma 3 answer faster on smaller GPUs. For Ollama, the context size field is sent as `num_ctx` (16k default) so the library summary fits.

2. **Voice:** run a local OpenAI-compatible speech server, for example [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI): `docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest` (GPU images exist). Model `kokoro`, voice e.g. `am_michael`. **Browser voice** uses only on-device voices; **Off** keeps the DJ text-only.

3. **Listening:** push-to-talk needs a local Whisper server with an OpenAI-style `/v1/audio/transcriptions` endpoint, such as [Speaches](https://github.com/speaches-ai/speaches) (`Systran/faster-whisper-small`). Some servers need the model downloaded first; see their docs. Browsers only allow the mic over HTTPS or on localhost. The browser's built-in speech recognition is not used because Chrome sends that audio to Google.

4. Hosted providers (OpenAI, Anthropic, Gemini, Mistral, DeepSeek, xAI, Groq, OpenRouter, ElevenLabs) are optional. The settings page warns when a choice sends data off your server. API keys are stored in the database and never sent back to the browser.

When Spotless runs in Docker, `localhost` is the container itself: use `http://host.docker.internal:PORT` (the supplied `docker-compose.yml` maps it to the host).

The DJ only plays songs it can match to your library. Picks it can't match are shown as suggestions only when Deezer confirms the song exists. Each profile's chat history is kept in that browser only.

## Backup and restore

Spotless copies the SQLite database to `DATA_DIR/backups/library-YYYY-MM-DD.db` (or `BACKUP_DIR` if set) on
startup and once every 24 hours, keeping the last 7. Each copy is written to a temporary file, integrity-checked
with `PRAGMA quick_check`, and only then renamed into place, so a half-written backup never replaces a good one.
With the default compose file that is `./data/backups` on the host.

To restore:

1. Stop the container: `docker compose down`.
2. Copy the backup over the live database: `cp data/backups/library-YYYY-MM-DD.db data/library.db`.
3. Delete the stale journal files if they exist: `rm -f data/library.db-wal data/library.db-shm`.
4. Start again: `docker compose up -d`.

Extracted album art lives in `DATA_DIR/art` and is rebuilt by the next library scan if it is missing.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full setup, the throwaway Docker test stack on port 3300, and
what a pull request needs. The short version:

```bash
npm ci
# put some audio files in ./music (or set MUSIC_DIR)
npm run dev
```

| Script | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint (`eslint-config-next`) |
| `npm test` | Vitest unit tests |
| `npm run format:check` | Prettier |
| `npm run build` | Production build |

CI runs all of these on every pull request. `GET /api/health` is handy while developing: it answers `200` once
the server and database are up.

## Security model — read this

Spotless now has web authentication, but secure deployment still matters.

**Web UI authentication**

- Every web profile has its own password.

- Web passwords are stored only as memory-hard `scrypt` hashes.

- Browser authentication uses an opaque server-side session cookie; the browser does not authenticate by supplying a profile ID.

- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS.

- Protected `/api/*` endpoints require a valid server-side session.

- Cross-site state-changing API requests are rejected.

- Repeated failed logins are progressively rate-limited (per profile, or per profile and IP with `TRUST_PROXY`).

- Password resets revoke the affected profile's active web sessions.

- Profile 1 is the admin; admin-only API operations are still checked server-side.

**Network security**

Web authentication does not make unencrypted HTTP safe on an untrusted network. For remote access, use HTTPS through a reverse proxy or a private VPN/network such as Tailscale or WireGuard.

Do not publicly expose Spotless over plain HTTP.

**Database and protocol notes**

- `DATA_DIR/library.db` contains authentication/session state and other private application data. Protect the database file, its backups, and the host filesystem from unauthorized access.

- Web password hashes are not plaintext passwords, and stored web-session values are not the raw browser session tokens.

- The Subsonic/OpenSubsonic mobile-app authentication mechanism is separate from web authentication. Generated mobile app passwords must remain usable by compatible clients, so continue to treat `library.db` as sensitive data.

- `/api/lidarr/webhook` remains callable by Lidarr without a browser session. If it is reachable outside a trusted network, configure `LIDARR_WEBHOOK_SECRET`.

- Nightly DB backups are kept in `DATA_DIR/backups` (last 7); protect those backups with the same care as the live database.

- Normal Spotless scanning/streaming access stays read-only at `/music`. If automatic synced sidecars are enabled, the optional `/music-write` mount allows Spotless to create new `.lrc` files only; existing lyric files are not overwritten.

- FLAC/OGG/OPUS playback depends on browser codec support (fine in Chromium/Firefox; Safari lacks OGG/OPUS).

**Password guidance**

A 4-digit PIN is accepted by default for convenience on a home network. Throttling slows guessing to roughly a hundred attempts per profile per day, which is enough on a LAN but not a real barrier for an internet-facing server. If Spotless is reachable from the internet, set `AUTH_MIN_PASSWORD_LENGTH=12` (or higher) and use long, unique passphrases.

**Upgrading from a passwordless version:** the first person to open the profile picker after the upgrade can claim the admin profile by setting its password. If your server was reachable by people you don't trust, do the upgrade and claim the admin password yourself immediately.

For Internet-facing access, authentication + HTTPS is the minimum recommended deployment. A VPN/private-network layer is still a useful additional boundary for a self-hosted personal server.

## About

Spotless is a personal project, built by a music fan rather than a professional developer, with a lot of help
from AI tooling. It is used daily on a home server, but expect rough edges; issues and pull requests are welcome.

## License

MIT — see [LICENSE](LICENSE).
