# Spotless 1.0 + Google Play launch checklist

Snapshot 2026-10-11, from `new-downloads` @ 2bd7bf8 (v0.3.1). Baseline: typecheck clean, 120/120 tests pass,
lint 0 errors / 32 warnings.

Spotless today ships as a Docker server, a PWA, and an Electron desktop shell. **There is no Android app yet**, so
"launch to Google Play" means building one, which is most of P0.

## P0 — Google Play blockers

- [ ] **Android client.** Recommended: a Capacitor shell built the same way as `desktop/` (ask for the server
      address or scan the LAN, remember it, keep navigation on the server). Two things the desktop shell gets
      for free from Chromium don't happen in an Android WebView, so they need native code:
  - [ ] Background playback: a Media3/ExoPlayer **foreground service** (`mediaPlayback` type). Without it Android
        stops audio soon after the app is backgrounded or the screen turns off.
  - [ ] Media notification + lock-screen controls. WebView ignores the Media Session API that `Player.tsx` drives,
        so the web player has to hand playback to the native player through a bridge.
  - [ ] Hardware back button (go back in history, exit at the root), safe-area insets, the "server unreachable"
        screen with retry, and cleartext HTTP for LAN servers (network security config).
  - Why not a TWA: a Trusted Web Activity needs Digital Asset Links on one fixed domain. Every user's server lives
    on a different origin, so it would fall back to a Custom Tab with a URL bar.
- [ ] **Brand / IP risk.** The icon is Spotify green (`#1ed760`) on near-black, the name is "Spotless", and the
      README tagline says "Spotify-style interface". That combination can get the app flagged under Play's
      impersonation and IP policies. Before submitting: change the icon and default accent color, and leave
      "Spotify" out of the store listing except for describing the import feature factually.
- [ ] **Lidarr / "Get this artist" download buttons.** Play's IP policy covers apps that help users download
      copyrighted content. Decide whether the Android build hides the Lidarr request and download UI (for
      example with a user-agent or `?app=android` flag the server checks) or ships it and accepts the review risk.
- [ ] **Reviewer access.** Play reviewers have to be able to sign in and play music. Stand up a public demo server
      with Creative Commons music and enter its address and demo credentials under *App access*.
- [ ] **Privacy policy URL + Data safety form.** Cover microphone use (AI DJ voice), the Spotify and Last.fm
      connections, the server address stored on the device, and the fact that the app only talks to the user's
      own server.
- [ ] **Permissions.** Ask for `RECORD_AUDIO` at the moment it's needed, with a rationale. Declare
      `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and `POST_NOTIFICATIONS` (Android 13+). Request nothing else.
- [ ] **Play Console setup.** Developer account and identity verification, Play App Signing, AAB builds in CI
      (next to `desktop.yml`), the target API level Play currently requires, the content-rating questionnaire, and
      store assets: a 512 px icon, a 1024×500 feature graphic, and at least 2 phone screenshots
      (`docs/mobile-*.png` are a starting point).
- [ ] **Closed test.** Personal developer accounts created after Nov 2023 must run a closed test with
      **12+ testers for 14 consecutive days** before production access. **This is the longest wait on the list,
      so start it as soon as a testable build exists.**

## P1 — Finish in-flight work

- [ ] **New downloads** (uncommitted on this branch): `added_at` column and migration, scanner stamping, the
      `/api/new-downloads` route, and the library page section. Add scanner tests (first import uses file mtime;
      later scans use scan time; retag and relink keep the original), then review, commit and open a PR.
- [ ] **Lint to zero**: 20× `react-hooks/set-state-in-effect`, 3× `static-components`, 3× unused vars, and 6
      one-offs. Then add `--max-warnings 0` to CI.
- [ ] Rename `vitest.config.ts` → `vitest.config.mts` to silence the Vite native-config warning.

## P1 — 1.0 quality bar

- [ ] Mobile UI pass at phone widths inside the WebView: 48 dp touch targets, the keyboard covering search,
      no accidental pull-to-refresh, and the now-playing sheet.
- [ ] Accessibility audit (Play's pre-launch report flags contrast, missing labels and small touch targets).
- [ ] E2E smoke tests (Playwright): log in, scan, play, queue, seek, playlist create and reorder. Today only
      `src/lib` has tests; the player has none.
- [ ] Decide on offline downloads for mobile. Users expect it from a phone music app; reasonable to defer to 1.1
      if the store listing says so.
- [ ] Station proxy: hostnames that resolve to private IPs still pass the SSRF check (a known limitation). Resolve
      them and check, or document the limitation for 1.0.
- [ ] Code-sign the desktop installers (they currently trigger SmartScreen and Gatekeeper warnings).

## P2 — Release

- [ ] Docs: README 1.0 refresh, an Android "connect to your server" guide, and the privacy policy page.
- [ ] `npm run release -- major` → v1.0.0. Pick an Android `versionCode` scheme tied to the server version.
- [ ] Production rollout: staged 10% → 50% → 100%, watching Android vitals and crash reports.
