# Spotless for Android — design

Date: 2026-10-11
Status: approved for planning

## Goal

A native Android app for a self-hosted Spotless server that:

1. installs like any app (APK from the GitHub Release now; F-Droid / Play Store later),
2. shows the same Spotless UI as the browser and desktop app,
3. keeps music playing reliably with the screen off, with lock-screen, notification, Bluetooth and Wear OS
   controls, and
4. is built so Android Auto, Assistant/Gemini voice search and a home-screen widget plug into it later.

Offline downloads are out of scope.

## Phases

| Phase | Delivers | Depends on |
| --- | --- | --- |
| P1 | App shell, setup screen, WebView UI, native playback engine, notification / lock screen / Bluetooth / Wear, CI + signed APK on releases | — |
| P2 | Android Auto browse tree + voice search ("play X on Spotless") | P1 playback service |
| P3 | Home-screen now-playing widget | P1 playback service |

Each phase ships on its own. P1 is specified in full below; P2 and P3 at the level needed to keep P1's
design open for them.

## Architecture (P1)

```
┌──────────────── Android app (android/, Kotlin) ────────────────┐
│ MainActivity                                                   │
│   ├─ SetupScreen (Compose) — server address + /api/health      │
│   └─ WebView → Spotless UI (same pages as the browser)         │
│          ▲ web message bridge (origin-locked)  │               │
│          │ state events                        ▼ commands      │
│ PlaybackService (Media3 MediaSessionService, foreground)       │
│   ├─ ExoPlayer — playlist, gapless, audio focus, noisy, BT     │
│   ├─ MediaSession → notification, lock screen, Wear, (Auto P2) │
│   ├─ EqAudioProcessor (10-band) + ReplayGain volume            │
│   ├─ QualityPolicy (adaptive rungs)                            │
│   ├─ HistoryReporter → POST /api/history                       │
│   ├─ VoicePlayer (DJ talk-over) + Android TextToSpeech         │
│   └─ SessionStore (DataStore) — last queue + position          │
│ net/: ServerConfig, CookieJar (WebView cookies → OkHttp)       │
└────────────────────────────────────────────────────────────────┘
```

**Rule: in the app, native owns what is playing** (queue, index, position, play/pause). The web player
store becomes a projection: store actions are forwarded to native, native events update the store. Lock
screen, Bluetooth, Wear, and later Auto and the widget all control native directly, so one authority avoids
two players disagreeing.

Queue-shaping logic stays in JavaScript (shuffle order, radio-mode refill, DJ sets). JS computes the queue
and pushes it to native.

### Web side changes

`src/components/Player.tsx` (1228 lines) holds both the UI and the audio engine. Split the engine behind an
interface:

- `PlaybackEngine` — the operations the Player needs (load queue, play, pause, seek, next, prev, jump,
  volume, duck, EQ, quality, sleep timer, speak) plus a subscription for state.
- `WebAudioEngine` — today's two-`<audio>`-element engine moved out of `Player.tsx` unchanged in behavior
  (browser and desktop keep crossfade, EQ via Web Audio, adaptive quality, history posting).
- `NativeEngine` — sends bridge commands and turns bridge events into store updates.

The Player picks `NativeEngine` when the bridge handshake succeeds, otherwise `WebAudioEngine`. With
`NativeEngine`:

- history/scrobble posting is done by native (not JS),
- the sleep timer is native,
- DJ voice clips go through `speak` instead of `new Audio()` (`src/lib/client/djVoice.ts`),
- the crossfade setting shows "Not available in the Android app yet".

## Bridge protocol (P1)

**Transport.** `WebViewCompat.addWebMessageListener` (androidx.webkit) with `allowedOriginRules` set to the
configured server origin only. Other origins and iframes never see the bridge. `addJavascriptInterface` is
not used (it is exposed to every frame). Messages are JSON strings `{ "type": ..., ...payload }`.

The listener injects `window.SpotlessNative` with `postMessage(json)` and an `onmessage` handler; a small
web module (`src/lib/client/nativeBridge.ts`) wraps it in a typed API.

**Handshake.** On load the page sends `hello`; native answers
`{ type: "hello", bridgeVersion: 1, appVersion, caps: [...] }`. The web uses `NativeEngine` only for a
supported `bridgeVersion`; anything else falls back to `WebAudioEngine`. An older app with a newer server (or
the reverse) degrades to browser-style playback, never breaks.

**Commands (JS → native)**

| type | payload | notes |
| --- | --- | --- |
| `hello` | — | handshake |
| `getState` | — | on page load: native state replaces the localStorage-restored queue |
| `setQueue` | `tracks: Track[], index, positionMs, play` | new queue (playQueue, playDj, radio seed) |
| `syncQueue` | `tracks: Track[], index` | append / reorder / shuffle; current item keeps playing uninterrupted |
| `play`, `pause` | — | |
| `seek` | `positionMs` | |
| `next`, `prev` | — | |
| `jumpTo` | `index` | |
| `setRepeat` | `"off" \| "all" \| "one"` | |
| `setVolume` | `0..1` | |
| `setDuck` | `0..1` | DJ talk-over multiplier |
| `setEq` | `enabled, gains[10]` | same shape as `EqState` in `src/lib/eq.ts` |
| `setQuality` | `"auto" \| "raw" \| "high" \| "normal" \| "saver"` | same ids as `src/lib/adaptive.ts` |
| `setSleepTimer` | `minutes` or `0` to cancel | |
| `speak` | `url` (server clip) or `text` (device TTS) | DJ voice; native ducks music while it plays |
| `stopSpeaking` | — | |

**Events (native → JS)**

| type | payload | when |
| --- | --- | --- |
| `hello` | `bridgeVersion, appVersion, caps` | reply to `hello` |
| `state` | `isPlaying, index, positionMs, durationMs, buffering, queueVersion, sleepUntil` | every change, plus every 1 s while playing and the page is visible |
| `queue` | `tracks, index, queueVersion` | reply to `getState`, and whenever native changed the queue itself (e.g. resumed session) |
| `trackError` | `trackId, reason` | a track failed after retries and was skipped |
| `queueEnd` | — | last item finished with repeat off — JS may refill (radio) and `syncQueue` |
| `speaking` | `active: boolean` | DJ clip started / finished |
| `authLost` | — | a native request got 401 |

`queueVersion` increments on every queue change on either side; a `syncQueue` carrying a stale version is
ignored, so a late message from JS cannot undo a skip made on the lock screen.

**Track payload** is the existing `Track` type from `src/lib/types.ts`, unchanged. Native builds URLs itself:

- stream: `{origin}/api/stream/{id}{streamQuery(rung, offset)}` — same rules as `streamQuery` in
  `src/lib/adaptive.ts` (`format=mp3&maxBitRate=N[&offset=S]` for transcoded rungs, nothing for raw)
- art: `{origin}/api/artwork/{albumId}`
- stations (`streamUrl` set, negative id): play `streamUrl` directly; ICY metadata updates the title

Tracks with `missing: true` (playlist placeholders) are skipped by native.

## Playback behavior (P1)

| Feature | Native implementation |
| --- | --- |
| Gapless | ExoPlayer playlist |
| ReplayGain | per-item volume on media item transition: `min(1, volume × duck × min(1.4, 10^(gain/20)))` — same formula as `Player.tsx` |
| 10-band EQ | Media3 `AudioProcessor` with the `eq.ts` chain: lowshelf 31 Hz, peaking at 62 Hz–8 kHz with Q 1.1, highshelf 16 kHz; gains clamped to ±12 dB; disabled = exact bypass. Coefficients use the Web Audio biquad formulas (Audio EQ Cookbook) so the curve matches the browser. Not `android.media.audiofx.Equalizer` (band layout differs per device) |
| Quality | Port of the `adaptive.ts` ladder: raw / high 320 / normal 192 / saver 128. Auto: unmetered network → raw, metered → normal, unknown → high; each stall steps one rung down, a rung is handed back after 90 s without a stall. A downshift rebuilds the current item at the new rung with `offset` = current position |
| Preload | On Auto over metered data, the next item is not buffered until 45 s before the current one ends (matches `deferPreload`) |
| Recovery | ExoPlayer load-error retry; at most 4 restreams per track, then skip and emit `trackError` |
| Start stall | Nothing audible within 12 s of start → restream once at a lower rung, then skip |
| History / scrobble | `start` event when a library track begins; `played` (with `startedAt` unix seconds) once half the track or 240 s has actually been heard, counting only real listening (gaps > 2 s don't count). Stations and placeholders are never reported. Same rules as `Player.tsx` |
| Sleep timer | Native; pauses at the deadline; `sleepUntil` reported in `state` |
| Audio focus | Media3 `handleAudioFocus = true`: pause for calls, duck for navigation prompts; `handleAudioBecomingNoisy = true` pauses on headphone unplug |
| Notification, lock screen, Bluetooth, Wear | Media3 `MediaSession` default notification (prev / play-pause / next), artwork from the art URL |
| DJ voice | `VoicePlayer`: a second ExoPlayer with no audio-focus handling plays the `/api/dj/speak` clip; music is ducked to the web's `DUCK_GAIN` during the clip. "Browser voice" mode maps to Android `TextToSpeech` |
| Crossfade | Not in P1. Gapless only |

### Session persistence and resumption

`SessionStore` saves queue (capped at 500 tracks, current track and what follows, like the web persist),
index, position, repeat mode, and queue version to DataStore on every queue change and every 10 s while
playing. `MediaSession.Callback.onPlaybackResumption` restores it, so Bluetooth "play" after a reboot and the
Android media-resume card pick up where playback stopped.

## Shell (P1)

**Setup.** On first launch (or "Change server" in the app menu) a Compose screen asks for the server address.
Normalization matches `normalizeServer` in `desktop/main.js`: trim; add `http://` if there is no scheme; only
http/https; keep the origin only. Then `GET {origin}/api/health` with an 8 s timeout; a JSON body with
`ok: true` means a working Spotless server, `ok: false` means "Spotless is there but not healthy", non-JSON
means "some other web app lives at this address". The origin is saved to DataStore.

Cleartext HTTP is allowed (`network_security_config` with `cleartextTrafficPermitted="true"`), because LAN
servers rarely have TLS.

**Authentication.** Sign-in happens in the WebView exactly as in a browser. Native requests (streams, art,
history, health, P2 browse) use an OkHttp `CookieJar` that reads `CookieManager.getInstance().getCookie(origin)`
— this includes the HttpOnly `spotless_session` cookie. Native requests send no `Origin` header, which the
server's CSRF check accepts (`src/proxy.ts`). A 401 on any native request → pause, emit `authLost`, the
WebView reloads into the sign-in page. A 401 while the WebView is not alive shows a notification "Sign in to
Spotless again" that opens the app.

**Navigation.**

- Same-origin navigation stays in the WebView.
- Spotify and Last.fm sign-in pages (`*.spotify.com`, `last.fm`, `www.last.fm`) also stay in the WebView so
  the OAuth callback carries the session cookie (same allow-list as `desktop/main.js`).
- Any other site opens in the system browser.
- Back: WebView history back; at the root, `moveTaskToBack(true)` — the app goes to the background and music
  keeps playing.
- The WebView is not paused when the activity is backgrounded (no `onPause()`/`pauseTimers()`) so JS radio
  refill and DJ segues keep working while the screen is off; native is still the playback authority if
  the system throttles it.

**Permissions.** `RECORD_AUDIO` is requested at runtime only when the page asks for the microphone (DJ
push-to-talk) via `WebChromeClient.onPermissionRequest`. `FOREGROUND_SERVICE` and
`FOREGROUND_SERVICE_MEDIA_PLAYBACK` in the manifest. The media notification is exempt from the Android 13
notification permission. No other permissions.

**Errors.**

- Server unreachable at launch → native screen "Can't reach {server}" with Retry and Change server. Audio
  already buffered keeps playing.
- Page load fails mid-session → same screen over the WebView, Retry reloads.
- Playback errors → see Recovery above; the web shows a toast for `trackError`.

## P2 — Android Auto and voice search (outline)

- `PlaybackService` becomes a `MediaLibraryService`. Browse tree built natively from the server API with the
  session cookie: Home (`/api/home`), Playlists (`/api/playlists`, `/api/playlists/{id}`), Liked
  (`/api/likes`), Radio stations (`/api/stations`). Exact response shapes are read from the route handlers
  when P2 is planned.
- `onSetMediaItems` / `onAddMediaItems` resolve browse items into playable tracks; native builds and owns the
  queue with no WebView involved. Radio-mode refill and DJ sets are WebView features and are not available
  when playback is started from the car.
- Voice: the session handles play-from-search (Media3 `MediaSession.Callback.onSetMediaItems` with a search
  query in `RequestMetadata`) → `/api/search?q=` → play the best match. Assistant / Gemini support for
  third-party media apps varies by phone; best effort.
- Sideloaded apps only appear in Android Auto with Auto's developer setting "Unknown sources" turned on. Normal
  visibility needs Play Store distribution.

## P3 — Home-screen widget (outline)

- Jetpack Glance widget: art, title, artist, prev / play-pause / next.
- Reads state from the playback service through a `MediaController`; tapping the widget opens the app.
- Updates on media item and play-state changes only (no polling).

## Build and release

**Layout.** `android/` next to `desktop/`. Gradle with Kotlin DSL, one `app` module, packages:
`setup/`, `web/` (WebView + bridge), `playback/` (service, EQ processor, quality policy, history reporter,
voice player, session store), `net/` (server config, cookie jar, API client).

Package name `app.spotless.android` (not tied to a domain we'd need to own). minSdk 26, target/compile
latest stable. Libraries: Media3 (exoplayer, session, datasource-okhttp), androidx.webkit, Jetpack Compose
(setup and error screens only), DataStore, OkHttp, kotlinx.serialization. No Google Play Services or
Firebase, so the app stays F-Droid and Play compatible.

**Versioning.** `versionName` comes from the root `package.json` `version`; `versionCode` derived from it
(`major*10000 + minor*100 + patch`).

**CI.** `.github/workflows/android.yml`, modeled on `desktop.yml`:

- pull requests touching `android/**` or the workflow: unit tests + debug APK artifact;
- called by `docker.yml` on `v*` tags: signed release APK uploaded as `android-apk` artifact, and the
  release job attaches it to the GitHub Release next to the desktop installers.

The signing keystore is a base64 GitHub secret (`ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`); it is never committed. Without the secrets (forks) the release
build is skipped.

## Testing

**Web (vitest).**

- `NativeEngine` against a fake bridge: each store action sends the right command; `state` / `queue`
  events update the store; stale `queueVersion` is ignored.
- Handshake: no bridge or unsupported version → `WebAudioEngine`.
- `djVoice.ts` routes to `speak` when native is active.
- Existing tests stay green after `WebAudioEngine` is extracted.

**Android (JUnit on the JVM).** Pure logic only:

- server address normalization (same cases as the desktop),
- health response classification,
- quality ladder: network → rung, stall penalty, recovery after 90 s, stream URL query strings,
- played/scrobble tracker (half / 240 s / ignore gaps > 2 s / never stations),
- EQ biquad coefficients equal the Web Audio formulas for each band at 44.1 and 48 kHz,
- ReplayGain level formula,
- queue sync: stale version ignored; current item preserved on reorder,
- session store trimming (500 cap keeps current and following),
- bridge message parsing (unknown types ignored, bad JSON ignored).

**Manual checklist (real phone, before each release).**

1. 30 minutes of playback with the screen off.
2. Same on a Samsung (or other aggressive battery saver) phone.
3. Bluetooth headset play / pause / next.
4. Incoming call pauses, resumes after.
5. Headphone unplug pauses.
6. Lock-screen and notification controls; Wear OS watch controls.
7. AI DJ talk-over ducks music and restores it.
8. Sign-out on another device (session revoked) mid-play → sign-in prompt.
9. Server stopped mid-play → skip / error, no crash; server back → plays again.
10. Force-stop the app → Bluetooth play resumes the last queue.
11. Change server from the menu.
12. Spotify and Last.fm connect flows complete inside the app.

## Out of scope

Offline downloads, crossfade in the app, Play Store / F-Droid listing, a standalone Wear OS app,
tablet-specific layouts (the web UI is already responsive).
