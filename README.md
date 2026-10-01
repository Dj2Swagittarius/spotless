# Spotless v1.0

Fork of [spotless](https://github.com/Dj2Swagittarius/spotless). 

I created this fork because i want to create an app which I wanted to use  for an more seamless experience.
This fork aims for a more seamless self-hosted Spotify-style app. 

Disclaimer: I'm not a developer. Just a passionate guy who developed an APP with the help of AI.

Self-hosted, single-container music streamer with a Spotify-style interface.

Point it at a folder of music and it gives you a dark-themed player with profiles, discovery, a 10-band EQ, internet radio, and optional Lidarr, Spotify and Last.fm integrations.

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
- Netflix-style "Who's listening?" profile picker — no passwords, LAN-trust model
- Per-profile likes, history, playlists, stats, discovery taste, and hidden artists
- The first profile is the admin: server settings (music folder, scans, Lidarr) are hidden
  from and blocked (HTTP 403) for everyone else

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
  structured synchronized lyrics
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

3. Open `http://<server-ip>:3000` — a setup wizard walks you through creating your profile
   (the first one becomes the admin), scanning your library, and the optional Lidarr and
   Spotify hookups. Every step is skippable and lives in Settings afterwards.

   ![Setup wizard](docs/setup.png)

## Configuration

| Env var                 | Default                                                                   | Purpose                                                                        |
| ----------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `MUSIC_DIR`             | `/music`                                                                  | Read path scanned/streamed by Spotless                                         |
| `MUSIC_WRITE_DIR`       | same as `MUSIC_DIR` outside Docker; `/music-write` in supplied Dockerfile | Optional write mirror used only to create generated `.lrc` sidecars            |
| `DATA_DIR`              | `/data`                                                                   | SQLite DB, extracted album art, nightly backups                                |
| `PORT`                  | `3000`                                                                    | HTTP port                                                                      |
| `SPOTIFY_CLIENT_ID`     | _(none)_                                                                  | Optional; enables the Spotify taste/playlist import                            |
| `SPOTIFY_REDIRECT_URI`  | `http://127.0.0.1:3000/api/spotify/callback`                              | Optional deployment default for Spotify OAuth; Settings → Spotify overrides it |
| `FFMPEG_PATH`           | `ffmpeg`                                                                  | Path to ffmpeg (bundled in the Docker image)                                   |
| `LIDARR_WEBHOOK_SECRET` | _(none)_                                                                  | Optional; if set, the Lidarr webhook requires `?token=<secret>`                |

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
open (fine on a trusted LAN; the rescan it triggers is debounced to prevent flooding).

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
   public origin before starting OAuth so the PKCE flow and callback use the same origin.

6. While the Spotify app is in development mode, add each Spotify account that will connect
   under User Management in the Spotify developer dashboard.

### Last.fm setup (optional)

1. Create a free API account at <https://www.last.fm/api/account/create> (any name, callback URL can stay blank)
2. As the admin profile, paste the API key and shared secret into **Settings → Last.fm** and hit *Test & save*
3. Each profile then clicks **Connect Last.fm** on the same page to link its own account

## Local development

```bash
npm install
# put some audio files in ./music (or set MUSIC_DIR)
npm run dev
```

## Security model — read this

**There is no authentication.** Profiles are passwordless and switchable by anyone who can
reach the page; the admin gate protects against accidents, not attackers. Run it on a
trusted home LAN only. If you want remote access, put it behind your own auth layer
(Tailscale/WireGuard, or a reverse proxy with authentication) — do not port-forward it
to the internet as-is.

Other notes:

- Normal Spotless scanning/streaming access stays read-only at `/music`. If automatic synced sidecars are enabled, the optional `/music-write` mount allows Spotless to create new `.lrc` files only; existing lyric files are not overwritten
- `DATA_DIR/library.db` holds generated mobile app passwords in the clear (inherent to the
  Subsonic protocol) — protect it at rest and don't expose the DB file
- Nightly DB backups are kept in `DATA_DIR/backups` (last 7)
- FLAC/OGG/OPUS playback depends on browser codec support (fine in Chromium/Firefox; Safari lacks OGG/OPUS)

## License

MIT — see [LICENSE](LICENSE).