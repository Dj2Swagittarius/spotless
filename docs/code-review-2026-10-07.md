# Spotless code review — 2026-10-07

Scope: full repository at commit 7005edb (main). ~14k lines of TypeScript under src/.

Method: ten independent reviewers (security, backend API, data layer, scanner/streaming,
player engine, UI, integrations, Subsonic, engineering practices, product gaps) each read the
code and produced findings with file:line evidence. Every finding was then re-read by a
separate skeptic agent instructed to refute it; 173 survived (17 high, 47 medium, 109 low),
2 were rejected. The eight "Fix now" items were additionally verified by hand before this
report was written. `npx tsc --noEmit` passes clean on the current tree.

Severity key: high = real bug users will hit or serious security weakness; medium = correctness
gap in edge cases or clear maintainability problem; low = polish.

---

## Verdict

Spotless is in better shape than most AI-assisted hobby projects: the authentication core (scrypt with a concurrency cap, hashed session tokens with rotation and expiry, login throttling, CSRF checks in the proxy, PKCE Spotify flow), the dual-element gapless/crossfade player with adaptive quality, the online-backup SQLite layer, and the Docker/README surface are all genuinely well done, and the Subsonic envelope, lyrics and Lidarr/Deezer integrations show real care. Nothing is critical, but there are eleven high-severity items that will bite real users. The three to fix first: (1) the web playlist routes have no ownership check, so any profile can rename, delete or edit any other profile's playlists; (2) track identity is the absolute file path, so a Lidarr rename or a music-folder change silently deletes likes, history, playlist entries and lyrics for every affected song; (3) the Subsonic layer is broken for the clients the README names (no `getMusicDirectory`, no `openSubsonic: true`, POST form bodies ignored), and the Docker image is dead on arrival on a fresh Linux host because `./data` is created root-owned. Beyond those, the player scores every cold track start as a stall and downshifts quality, scrobbles fire at track start instead of after listening, and detail pages crash on a 404. The engineering-practice layer is the real long-term risk: zero tests, no lint/typecheck, and no PR gate.

## Fix now (critical / high)

1. **Playlist routes never check ownership (IDOR across profiles)**
   src/app/api/playlists/[id]/route.ts:9,17-19,27-31; src/app/api/playlists/[id]/tracks/route.ts:17-21,38-48,58-62; src/app/api/playlists/[id]/resolve/route.ts:10; src/lib/data.ts:168
   Every handler operates on `Number(id)` alone; `getPlaylist` filters only by `p.id`, and `proxy.ts` only checks that *some* session exists. Playlist ids are sequential, so any signed-in profile can read, rename, reorder, delete or resolve any other profile's playlist. The Subsonic path already enforces this via `ownPlaylist()` (src/app/rest/[...view]/route.ts:216-225), so the web API is the one inconsistent path.
   Fix: add `ownedPlaylistId(req, raw)` in src/lib/data.ts that validates `Number.isInteger(id) && id > 0`, runs `SELECT id FROM playlists WHERE id = ? AND user_id = ?` with `userIdFrom(req)`, and returns 404 on miss; call it first in all seven handlers. Add `AND user_id = ?` to the UPDATE/DELETE statements as defence in depth. While there, delete the stale comment at [id]/route.ts:26 (foreign_keys *is* ON, db.ts:14) and the redundant manual child deletes.

2. **Track identity is the absolute path; renames cascade away all user data**
   src/lib/scanner.ts:321-326,346-353; src/lib/db.ts:47-48,58,70
   The removal phase deletes any track row whose exact path is not in the readdir set, and `ON DELETE CASCADE` takes likes, history, playlist_tracks and lyrics with it; the file is then re-inserted under a new AUTOINCREMENT id. A Lidarr rename-on-upgrade, a folder reorganisation, a mount-path change, or using the supported "Change folder" in Settings all trigger this in normal use, and Subsonic clients' offline caches lose the ids too.
   Fix: defer deletions to the end of the scan; before deleting a vanished row, look for a newly discovered file with a matching stable key (size + duration + normalised artist/title/album, or a MusicBrainz tag when present) and `UPDATE tracks SET path = ?, mtime = ?` instead of delete+insert. Store paths relative to `music_dir` so folder/mount changes become no-ops. Wrap the reconcile in one transaction.

3. **Docker image is dead on arrival with the documented bind mount**
   Dockerfile:29-30; docker-compose.yml:22; src/lib/db.ts:8-12
   `chown -R node:node /data` only affects the image layer; the README's `./data:/data` bind mount hides it, and Docker creates a missing `./data` as root:root 755. Under `USER node`, `mkdirSync(DATA_DIR/'art')` throws EACCES on every `getDb()` call, so every API route (including the setup wizard) 500s. Nothing in the README mentions chown.
   Fix: add an entrypoint that runs as root, chowns `/data` when needed, then drops to `node` via `gosu`/`su-exec` (or support `PUID`/`PGID`); make `getDb()` fail with a clear "DATA_DIR is not writable by uid 1000" message; add `mkdir -p data && sudo chown 1000:1000 data` to Quick start as a minimum.

4. **Subsonic folder-mode browsing is a dead end: `getMusicDirectory` not implemented**
   src/app/rest/[...view]/route.ts:240-590,602
   `getIndexes` returns `ar-N` ids, `albumJson` sets `isDir: true, parent: ar-N` and `songJson` sets `parent: al-N`, but there is no `getMusicDirectory` handler, so DSub, Substreamer, Ultrasonic and play:Sub (all named in the README) get `error 0 "not implemented"` the moment the user taps an artist.
   Fix: add a `getMusicDirectory` handler: for `ar-N` return `{ directory: { id, name, child: albums.map(albumJson) } }`; for `al-N` return `{ directory: { id, parent, name, child: songs.map(songJson) } }` via `tracksBy('t.album_id = @al', ...)`; return error 70 for anything else.

5. **Envelope never sets `openSubsonic: true`, so clients never discover the lyrics extension**
   src/lib/subsonic.ts:104
   The payload carries `type` and `serverVersion` (so OpenSubsonic was intended) but not the spec-mandated `openSubsonic: true` flag that Symfonium, Feishin, Tempo and Supersonic gate `getOpenSubsonicExtensions`/`getLyricsBySongId` on. The advertised synced-lyrics support is therefore never used.
   Fix: add `openSubsonic: true` to the payload object on every response.

6. **Subsonic auth and handlers ignore POST form bodies**
   src/lib/subsonic.ts:53; src/app/rest/[...view]/route.ts:608,615
   `handle` is exported as POST but both `authenticate` and every handler read only `req.nextUrl.searchParams`. Clients that POST `u/t/s` or large `songId` arrays as `application/x-www-form-urlencoded` get error 40 or silently empty playlists.
   Fix: in `handle`, when the method is POST and content-type is form-urlencoded, build `new URLSearchParams(await req.text())`, merge it with the query params, and pass the merged params to both `authenticate` and the handler.

7. **Auto quality downshifts on every cold track start**
   src/components/Player.tsx:152-154,305-318; src/lib/adaptive.ts:160-163
   `setSrc` then `play()` on a fresh element fires the spec-mandated initial `waiting` event. `onWaiting` calls `noteStall()` *before* computing `want = currentRung()`, so `want` is already one rung lower than `have`, the `at <= 0 && !isLower(want, have)` guard never fires, and `restream()` reloads at a lower rung. Every non-preloaded track start in Auto mode costs a downshift, a second fetch and a restart.
   Fix: move the start-of-track return (`a.currentTime === 0 || a.played.length === 0`) above `noteStall()`, compute `want` before penalising, and require `!a.paused && a.readyState < HAVE_FUTURE_DATA` before scoring a stall. Also drop `onStalled: onWaiting` (line 454) or add the same guard.

8. **History rows and Last.fm scrobbles are recorded at track start**
   src/components/Player.tsx:157-162; src/app/api/history/route.ts:13-15; src/lib/lastfm.ts:124
   The effect keyed on `[track?.id]` POSTs `/api/history` on load; the route inserts the history row and calls `updateNowPlaying` and `scrobbleTrack` with `timestamp = now`. Skipping through ten tracks produces ten plays (inflating Home, Stats, Discover, Trending and Subsonic `playCount`) and ten permanent Last.fm scrobbles for songs never heard. Last.fm's rules require 50% of the track or 4 minutes.
   Fix: split the contract: `{trackId, event:'start'}` only calls `updateNowPlaying`; `{trackId, event:'played', startedAt}` inserts the history row and scrobbles with `playedAtSec = startedAt`. In the Player, accumulate played seconds from `timeupdate` (reset on track change, not on seek) and POST once when `played >= min(duration/2, 240)`. Reject unknown events with 400.

9. **Seeking during a crossfade leaves two tracks playing**
   src/components/Player.tsx:123-127,234-237,428-443
   `cancelFade()` only clears the interval and resets `fadingRef`; the incoming element `b` was started with `b.play()` in `startFade` and nothing pauses it. Its `ended`/`pause` events are dropped because it is not the active element, so after a backward seek both tracks are audible until `b` finishes. (Needs crossfade > 0; off by default.)
   Fix: make `cancelFade()` also stop the idle element: `b.pause(); b.currentTime = 0; b.volume = 0` (keep its src so the preload is not wasted). Apply the same to the pause-during-fade case (item under Player below).

10. **Detail pages crash on 404; failed fetches leave skeletons forever**
    src/app/artist/[id]/page.tsx:20-23,90; src/app/album/[id]/page.tsx:19-22; src/app/playlist/[id]/page.tsx:27-30,43; src/app/stats/page.tsx:31-34; src/app/trending/page.tsx:45-48; src/app/liked/page.tsx:18-21
    Every page does `fetch().then(r => r.json()).then(setX).catch(() => {})` with no `r.ok` check. A 404 body `{error:'not found'}` (or the proxy's 401 JSON) becomes the entity, `artist.albums.map` throws, and there is no `error.tsx`/`not-found.tsx`, so Next's default error screen appears. A rejected fetch is swallowed and the skeleton gate stays true forever. A stale bookmark or an album removed by a rescan reproduces it.
    Fix: add `src/lib/client.ts` with `getJson<T>(url, signal?)` that throws on `!res.ok`; give each page a `status: 'loading' | 'error' | 'notfound' | 'ready'` with a visible retry/not-found state; add `src/app/error.tsx` and `not-found.tsx` as a safety net.

11. **Compilation / Various Artists albums lose per-track artist or fracture into many albums**
    src/lib/scanner.ts:145-151,381,397-400; src/lib/db.ts:28-39
    One `artist_id` derived from ALBUMARTIST (falling back to ARTIST) is used for both the album key and the track row; there is no album_artist or track_artist column and `compilation` is never read. A soundtrack tagged ALBUMARTIST=Various Artists shows "Various Artists" on every row; without the tag it splits into one album per track artist.
    Fix: add `album_artist_id` on albums (key albums by albumartist, falling back to "Various Artists" when `c.compilation` is set or a folder's tracks disagree) while storing each track's own `c.artist`; update `TRACK_SELECT` (data.ts:5) and `TRACK_SQL` (subsonic.ts:171) to return both.

## Fix soon (medium)

### Backend

1. **Radio stream proxy relays upstream Content-Type onto the app origin**
   src/app/api/stations/[id]/stream/route.ts:21-35; src/lib/stations.ts:53-60
   The body and `content-type` of any station (after `redirect: 'follow'`) are forwarded verbatim; `validStreamUrl` checks only the scheme and there is no CSP, so a compromised or MITM'd plain-http station can serve `text/html` that runs as the Spotless origin and read `/api/users/app-password`. Station URLs are admin-only, which is why this is medium not high.
   Fix: forward the upstream type only when it matches `/^(audio\/|application\/ogg|application\/octet-stream)/i`, otherwise `audio/mpeg` or 502; reject loopback/RFC1918/link-local targets in `validStreamUrl` unless an env opt-in is set.

2. **Last.fm callback has no state binding (login CSRF / account linking)**
   src/app/api/lastfm/login/route.ts:10-11; src/app/api/lastfm/callback/route.ts:9-13
   A crafted GET link to `/api/lastfm/callback?token=<attacker token>` carries the victim's SameSite=Lax cookie and binds the attacker's Last.fm session to the victim's profile, scrobbling their listening to the attacker's account. The Spotify flow already does this correctly (spotify/login/route.ts:37-43).
   Fix: in login, set an httpOnly `lastfm_oauth_state` cookie (random 32 bytes, maxAge 600) and append `?state=` to the `cb` URL (Last.fm preserves cb query params); in callback require `state === cookie` before `saveLastfmSession`, then clear the cookie.

3. **Last.fm login/callback hard-code `http://` from the Host header**
   src/app/api/lastfm/login/route.ts:10; src/app/api/lastfm/callback/route.ts:8
   Behind the HTTPS reverse proxy the README recommends, Last.fm sends the user back to a plain-http URL; unless the proxy upgrades the hop, the Secure cookie is not sent and the callback returns 401 JSON. `secureCookieFor` (src/lib/auth.ts:165-171) already has the detection logic.
   Fix: factor a `requestOrigin(req)` helper in src/lib/auth.ts honouring `x-forwarded-proto`/`x-forwarded-host` (falling back to `req.nextUrl`) and use it for both the `cb` URL and the post-callback redirects.

4. **Radio route hand-rolls the track SELECT and omits `gain`**
   src/app/api/radio/route.ts:30-31; src/lib/data.ts:5
   Radio-queued tracks lack the `gain` field every other endpoint returns, so `gainMult` returns 1 and volume jumps between radio and normal playback.
   Fix: export `TRACK_SELECT` (or a `trackSelect(where, params)` helper) from data.ts and use it here. Also clamp `limit` (`Number.isFinite(n) && n > 0 ? Math.min(n, 30) : 15`, line 16) since a negative value is passed to SQLite as unlimited.

5. **Proxy's `Cache-Control: private, no-store` overrides artwork caching**
   src/proxy.ts:37-41; src/app/api/artwork/[albumId]/route.ts:47; src/app/api/artwork/artist/[artistId]/route.ts:32
   Next applies middleware headers before the handler and does not let the handler replace `cache-control`, so the routes' `public, max-age=86400` never reaches the browser and every cover render re-hits `fs.readFileSync`.
   Fix: skip the override for `/api/artwork/` (and `/api/stream/`, which sets its own) in `proxy()`, or move the no-store header into a shared `json()` helper used by the JSON routes.

### Data

6. **No index on `albums(artist_id)`; artist listing cross-joins albums x tracks**
   src/lib/db.ts:20-27,75-78; src/lib/data.ts:46-57,62-67; src/app/rest/[...view]/route.ts:61-69
   `UNIQUE(name, artist_id)` is unusable for `artist_id = ?`, and getArtists/`allArtists()` LEFT JOIN albums and tracks on the same artist then `COUNT(DISTINCT)` the product (30 albums x 400 tracks = 12,000 intermediate rows per artist).
   Fix: `CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist_id)`; rewrite the aggregates as correlated scalar subqueries (`(SELECT COUNT(*) FROM albums WHERE artist_id = ar.id) AS albumCount`, same for tracks). While adding indexes, also add `idx_history_user_played ON history(user_id, played_at)`, `idx_tracks_genre`, `idx_albums_year`, `idx_likes_track`, `idx_playlist_tracks_track` (all cited as missing in the low-severity findings).

7. **Search runs nested REPLACE()+LOWER() chains over every row in three full scans**
   src/lib/data.ts:103-135
   Up to 6 terms x 3 columns of `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(...)))) LIKE ?` across tracks, albums and artists on every (300 ms-debounced) query; no index or FTS can help. This is the slowest interactive path on a large library.
   Fix: maintain a pre-folded `search_key` column (or an FTS5 table over title/artist/album populated during scan with the existing `foldText`) and query with `MATCH`, keeping LIKE as a fallback.

### Media / Streaming

8. **Scanner walks, stats and upserts synchronously with no transaction batching**
   src/lib/scanner.ts:267-282,321-326,357-366,397
   `readdirSync` recursion, per-file `statSync` + `getMtime.get`, and one autocommit (with fsync, `synchronous` left at FULL) per deleted and per changed track all run on the event loop; on a re-scan of a large unchanged NAS library the loop never yields, stalling all HTTP serving during every auto-scan.
   Fix: use `fs.promises.readdir`/`stat` with bounded concurrency (4-8 in flight), apply upserts in batched `db.transaction` chunks of a few hundred rows, wrap the delete loop in a transaction, and set `db.pragma('synchronous = NORMAL')` (durable under WAL).

9. **HTTP Range handling mis-serves suffix ranges, throws on inverted ranges, never 416s, no validators**
   src/lib/streaming.ts:25-52
   `bytes=-500` is served as `bytes=0-500` (breaks m4a with trailing moov atom); `bytes=500-100` reaches `fs.createReadStream` and throws ERR_OUT_OF_RANGE as an uncaught 500; `start >= size` is rewritten to 0 instead of 416; no ETag/Last-Modified, so a file re-tagged mid-playback gets spliced.
   Fix: implement RFC 9110 semantics (suffix → `start = size - N`; `start > end || start >= size` → 416 with `Content-Range: bytes */size`), emit `Last-Modified` and a weak ETag from mtime+size, honour `If-Range`, and use `fs.promises.stat` (also replaces the blocking `existsSync`/`statSync` pair at src/app/api/stream/[id]/route.ts:13 and streaming.ts:25).

10. **No cap on concurrent ffmpeg transcodes, no watchdog, no transcode cache**
    src/lib/streaming.ts:88,106,111; src/components/Player.tsx:182; src/lib/adaptive.ts:39
    Every transcode request spawns its own ffmpeg with only the request-abort listener as teardown; the web player preloads the next track at the same rung (and Safari/Firefox default to a transcode rung), so each session runs two processes. The output is `no-store` and unseekable, so the same FLAC is re-encoded for every play and every seek restarts ffmpeg at an offset.
    Fix: add a module-level semaphore (`TRANSCODE_MAX_ACTIVE = os.cpus().length`, env-overridable) that falls back to `raw()` or returns 503 with Retry-After; pass `-threads 1`; kill the child if stdout is idle ~30 s. Then tee completed encodes to `DATA_DIR/transcode/<trackId>-<fmt>-<kbps>-<mtime>.<ext>` (rename on close), serve hits through `rawFile()` with ranges, and prune by LRU to a configurable size.

11. **Any `maxBitRate` forces a transcode even when the source already fits**
    src/lib/streaming.ts:69-70; src/lib/adaptive.ts:217-219
    The raw path is reachable only when `maxBitRate === 0`, so a 128 kbps MP3 asked for "at most 320" is re-encoded (quality loss, CPU, lost seeking). The web player's "Data saver 128" rung does the same to a 96 kbps source.
    Fix: store `meta.format.bitrate` at scan time (or derive `size*8/duration`) and serve raw when the requested format is empty or equals the suffix and `sourceKbps <= maxBitRate`, as Navidrome/gonic do.

12. **SHOUTcast v1 stations answering `ICY 200 OK` always return 502**
    src/app/api/stations/[id]/stream/route.ts:21-27
    Node's fetch rejects the non-HTTP status line (verified on Node 24: "Response does not match the HTTP/1.1 protocol"), so every legacy SHOUTcast station hits the catch, contradicting the radios page copy promising "any direct icecast/shoutcast URL works". Note: `http.request` with `insecureHTTPParser: true` was tested and also fails (llhttp accepts `ICE/` but not `ICY`).
    Fix: on a parse failure, retry over a raw `net` socket that rewrites the `ICY 200 OK` status line to `HTTP/1.0 200 OK` before handing it to a parser (or a minimal hand parser), pipe the body into the Response, and never send `Icy-MetaData: 1`.

### Player

13. **Pausing during a crossfade does not stop the incoming track and auto-resumes when the ramp ends**
    src/components/Player.tsx:206-212,239-253,400; src/store/player.ts:74-75
    The isPlaying effect only pauses the active element and the fade interval never checks `isPlaying`; at `k >= 1` it calls `next()`, which sets `isPlaying: true`.
    Fix: when `fadingRef.current` is true, pause/resume both elements in the isPlaying effect; bail out of the fade interval if `!usePlayer.getState().isPlaying`.

14. **Raw-rung restream records a phantom offset, doubling progress and breaking seek**
    src/components/Player.tsx:103-107,273-284,349,440; src/lib/adaptive.ts:215-224
    `setSrc` always writes `a.dataset.offset = at` but `streamQuery` omits `?offset=` for bitrate-0 rungs and seeks on `loadedmetadata` instead, so `offsetOf(a) + a.currentTime` reads 2x and `seek()` subtracts a phantom offset for the rest of the track. Reachable via `onError` on the (default) raw rung.
    Fix: `a.dataset.offset = rung.bitrate ? String(offset) : '0'`.

15. **Pending `loadedmetadata` resume listener fires on the next track**
    src/components/Player.tsx:277-283
    The `{ once: true }` listener added for a raw-rung restream is never removed; if the reload errors (server still unreachable) and the user skips, it seeks the next track to the old offset. `currentTime =` does not throw, so the catch is not a guard.
    Fix: keep the handler in a ref and remove it in the track-change effect, or guard inside it with `hasSrc(a, track) && a.dataset.rung === rung.id`.

16. **AudioContext is created at mount and never resumed inside a user gesture**
    src/lib/eq.ts:58,92; src/components/Player.tsx:131-136,206-212
    With EQ enabled in localStorage, the mount effect builds the context with no activation; neither the play button nor the isPlaying effect calls `ctx.resume()`, so on Safari/iOS (and Chrome without sticky activation) an EQ session can start silent while `currentTime` advances.
    Fix: export `resumeEq()` and call it from the play handler, the isPlaying effect and the MediaSession `play` handler; or defer building the chain until the first `play()`.

17. **Turning shuffle off keeps the shuffled order; repeat-all replays the same shuffle**
    src/store/player.ts:75,109-114
    `toggleShuffle` shuffles upcoming tracks in place and discards the original order; the repeat-all wrap sets `index: 0` without re-shuffling.
    Fix: keep `originalQueue` when enabling shuffle and restore it (re-locating the current index) on disable; re-run `shuffleUpcoming` from index -1 on wrap when shuffle is on.

18. **Lyrics fetch has no cancellation, so a slow earlier response overwrites the current track**
    src/components/Lyrics.tsx:25-37; src/components/Player.tsx:475
    The effect keyed on `trackId` applies whatever lands last; the component is not keyed and stays mounted across skips, and a cache miss goes to lrclib.net.
    Fix: AbortController per effect run, abort in cleanup, ignore AbortError (or a `let alive = true` flag).

19. **Queue, index, position and volume are lost on reload**
    src/store/player.ts:41-48
    Only `radio` is persisted. A refresh or PWA relaunch drops the whole session; Subsonic `savePlayQueue`/`getPlayQueue` (rest route:584-585) are no-op stubs too. See the feature table for the cross-device half.
    Fix: wrap the store with zustand `persist` (partialize to queue ids, index, repeat, shuffle, volume; `isPlaying: false` on rehydrate; cap queue size), store `progress` periodically, and resolve ids via a `/api/tracks?ids=` endpoint on rehydrate.

### UI

20. **Settings is a 1000-line god component (43 `useState`, 11 mount-time fetches, 5 s poll)**
    src/app/settings/page.tsx:88-152,192-234,502-1006
    Nine unrelated concerns in one function; every change is risky and nothing is testable.
    Fix: split into one component per Section under `src/app/settings/_components/` (Profile, MobileApps, Library, Playback, Equalizer, Spotify, Lastfm, Lidarr, Duplicates, HiddenArtists), each owning its own state and fetches; keep page.tsx as a thin layout gated on `isAdmin`.

21. **No shared data layer: `/api/users` fetched by ten components, playlists and Lidarr config refetched per page**
    src/components/Shell.tsx:19; TopBar.tsx:28; MobileNav.tsx:13; AddToPlaylist.tsx:58; Sidebar.tsx:23; plus settings/library/discover/search/radios/users pages
    A cold `/discover` load issues four identical `/api/users` requests; AddToPlaylist refetches playlists on every menu open; rename does not update the sidebar (playlist/[id]/page.tsx:46-54 only dispatches on create).
    Fix: add a zustand `useSession` store (user, isAdmin, lidarrConfigured) hydrated once by Shell, and a `usePlaylists` store shared by Sidebar/Library/AddToPlaylist that mutations update directly (replacing the `playlists-changed` window event). SWR would also work.

22. **Components declared inside render bodies remount every row on each state change**
    src/app/trending/page.tsx:84,144,162; src/app/search/page.tsx:116,214,235,267
    `TrackRow` and `DlButton` are closures recreated per render, so React unmounts/remounts every row on each `playingKey`/`dlState` change, destroying the just-clicked button and dropping focus to body.
    Fix: hoist both to module scope and pass what they need as props.

23. **Search results race: a slower earlier query can overwrite newer results**
    src/app/search/page.tsx:74-84
    Two fetches per debounce tick with no abort or stale guard; the Deezer proxy has variable latency.
    Fix: AbortController per effect run passed to both fetches, aborted in cleanup; or a local token checked before `setResults`/`setDz`.

24. **TopBar pushes a history entry per debounced keystroke**
    src/components/TopBar.tsx:41-44
    Back walks through every partial query.
    Fix: `router.push` only when `pathname !== '/search'`, `router.replace` otherwise (`usePathname` is already imported at line 17).

25. **Home track tiles: Enter on the nested "..." button also starts playback; Space does nothing**
    src/app/page.tsx:67-82,103-118; src/components/AddToPlaylist.tsx:125-130
    A real `<button>` nested in a `role=button` div is invalid ARIA; the inner button's Enter keydown bubbles to the row handler. Only `'Enter'` is tested.
    Fix: use the `closest('a, button')` guard TrackList already uses (TrackList.tsx:72-75), handle `' '` as well, or render an explicit play `<button>` and keep AddToPlaylist outside it.

26. **Modals lack dialog semantics, focus management and (mostly) Escape handling**
    src/app/playlist/[id]/page.tsx:120-136; trending/page.tsx:223-242; radios/page.tsx:91-93; FolderPicker.tsx:68; SpotifyImport.tsx:77; PromptModal.tsx:34; AddToPlaylist.tsx:164-172
    No `role=dialog`/`aria-modal` anywhere, no focus move or trap, Escape only in PromptModal and AddToPlaylist; the menu has `role=menu` but no arrow keys or initial focus.
    Fix: one `Dialog` component (role, aria-modal, aria-labelledby, Escape, focus in on open and restored on close, Tab trap or native `<dialog>`) used by all six overlays; arrow-key navigation and initial focus for the AddToPlaylist menu.

27. **Form inputs rely on placeholders; no `htmlFor` anywhere**
    src/app/settings/page.tsx:612,681,713,840,899-900,944-945; users/page.tsx:56-81,164-187; radios/page.tsx:92-94; SetupWizard.tsx:199-225
    Screen readers announce unnamed password/API-key/URL fields; labels that exist are siblings, not associated.
    Fix: id + `<label htmlFor>` (or wrap input in label) on every input; `aria-label` where a visible label is undesirable; `role=radiogroup`/fieldset for the quality button row.

28. **Glyph-only Lidarr download buttons have no accessible name**
    src/app/trending/page.tsx:117-122,202-207
    `<button>⤓</button>` with no aria-label or title, while the sibling preview button has one.
    Fix: `aria-label={isAdmin ? \`Download ${t.title} via Lidarr\` : \`Request ${t.title}\`}` plus `title`.

29. **Multi-disc albums render as one flat list numbered by array index**
    src/components/TrackList.tsx:147; src/app/album/[id]/page.tsx:61
    Disc 2 track 1 is labelled "13"; `discNo`/`trackNo` are in the Track type and the SQL already sorts by them, but nothing renders them.
    Fix: group by `discNo` on the album page when more than one disc exists, render a "Disc N" subheader per group, and add a `numberFrom: 'index' | 'trackNo'` prop to TrackList.

### Integrations

30. **Spotify API errors are swallowed as null, wiping stored taste with empty lists**
    src/lib/spotify.ts:285,296,305,314-315; src/lib/autosync.ts:14-21
    `api()` returns null on any non-2xx; `importTaste` iterates `page?.items ?? []` then unconditionally writes the taste and deletes the Discover cache. The daily autosync makes any Spotify outage or revoked token a recurring data-loss path; revoked tokens are never cleared so `spotifyStatus().connected` stays true.
    Fix: make `api()` throw (or return a discriminated result); surface 401 as "reconnect required" and 429 with Retry-After; only write the taste when every page succeeded; delete stored tokens on `invalid_grant` so the UI can prompt a reconnect.

31. **Deezer outage caches an empty "New releases"/"Collection gaps" result for 24 h**
    src/lib/releases.ts:17-25,72-78,137,202
    When Deezer is unreachable or returns its HTTP-200 error envelope, every artist resolves to null, `groups.length === 0` fires, and the empty result is cached for `CACHE_TTL_MS`.
    Fix: check `artists.length === 0` before any network call to distinguish "no library artists" from "lookups failed"; only cache when at least one Deezer call succeeded; store failures with a short TTL (~10 min).

32. **Lidarr adds blindly use the first quality profile, metadata profile and root folder**
    src/lib/lidarr.ts:60-75,165-181; src/app/api/settings/lidarr/route.ts:15-17
    Any Lidarr with more than one root folder or a non-default profile gets artists placed in the wrong library at the wrong quality.
    Fix: have `PUT /api/settings/lidarr` return the available profiles/root folders from `testLidarr`, store the admin's choices as `lidarr_quality_profile_id`, `lidarr_metadata_profile_id`, `lidarr_root_folder`, and fall back to `[0]` only when unset (say so in the UI).

### Subsonic

33. **`recent`/`frequent` album lists and `playCount` are global, not per user**
    src/app/rest/[...view]/route.ts:158,160,174-176; src/lib/subsonic.ts:175
    Both subqueries on `history` lack `h.user_id`, leaking one profile's listening into another's "Recently played"/"Most played", contradicting the README's per-profile promise (the web app's own equivalents filter by user).
    Fix: add `AND h.user_id = @uid` to both subqueries and bind `uid: ctx.user.id` into the albumList params and `TRACK_SQL` (which already receives `@uid` for `starred`).

34. **`getArtistInfo` returns `biography: {}`, which strict JSON clients reject**
    src/app/rest/[...view]/route.ts:333-334
    The schema defines a string; `toXml` renders `{}` as `<biography/>` but JSON emits an object, so Gson/Moshi-based clients (Tempo, Ultrasonic) throw on the artist page.
    Fix: omit `biography` (or return `''`), e.g. `{ artistInfo2: { similarArtist: [] } }`; consider populating it from Last.fm later.

## Missing engineering practices

- **No automated tests at all** (package.json:7-11 has only dev/build/start; no `*.test.*`, no vitest/jest/playwright config). ~14k lines of auth, Subsonic auth, migrations and path-safety logic are checked by hand. First step: `npm i -D vitest`, add `"test": "vitest run"`, and write tests for the pure-logic hot spots that need no server: `clientIp` hop selection and session hashing in src/lib/auth.ts, `resolveMusicRoots`/`sidecarWritePath` traversal guards in src/lib/lyrics.ts, `foldText`/`artistKey`/`stripFeat` in src/lib/scanner.ts, `authenticate` token/salt and `enc:` forms in src/lib/subsonic.ts, and `migrateMultiUser` against a temp SQLite file. Add a Playwright smoke test (setup → login → play) later.
- **No PR gate; the only workflow builds and ships `:latest` from main** (.github/workflows/docker.yml:6-9). A compiling-but-broken change is discovered only after merge and auto-pulled by Watchtower users. First step: add `ci.yml` on `pull_request` + `push: main` running `npm ci`, `npx tsc --noEmit`, `npm run build` (and `npm test`); make the publish job `needs: ci`; enable branch protection requiring it.
- **No lint, format or standalone typecheck; tsconfig omits the stricter flags** (tsconfig.json:11 has `strict: true` only; no eslint/prettier config or scripts). First step: add `eslint` + `eslint-config-next` + `prettier`, scripts `lint`/`typecheck`/`format`, enable `noUncheckedIndexedAccess` and `noUnusedLocals`, fix the fallout once, run all three in the CI job above.
- **The published GHCR image is never referenced by docker-compose.yml or the README** (docker-compose.yml:3 is `build: .`; `grep -i ghcr README.md` is empty), so the pull-based update story in docker.yml:3-5 is unreachable. First step: set `image: ghcr.io/dj2swagittarius/spotless:latest` in compose (keep `build:` in a `docker-compose.dev.yml` override) and add a "Run the prebuilt image" README section with `docker compose pull && docker compose up -d`.
- **No release versioning or CHANGELOG** (package.json frozen at 0.1.0; `serverVersion` hard-coded to '0.2.0' at src/lib/subsonic.ts:104; LRCLIB UA says 0.1.0 at lyrics.ts:70; the `type=ref,event=tag` rule at docker.yml:47 is dormant because there is no `tags:` trigger). First step: add `tags: ['v*']` to `on.push`, use `type=semver` metadata, bump package.json per release, import the version into subsonic.ts and lyrics.ts, and move the README's "Upgrading an existing passwordless installation" section into `CHANGELOG.md`.
- **No health endpoint or Docker HEALTHCHECK** (Dockerfile has none; every DB-touching GET except `/api/setup` is behind auth). First step: add `src/app/api/health/route.ts` returning `{ ok, scanning, lastScanAt }` after `PRAGMA quick_check`, list it in `PUBLIC_API` in src/proxy.ts:5, and add a `HEALTHCHECK` using `node -e "fetch(...)"`.
- **No graceful shutdown** (no `SIGTERM`/`SIGINT` handler, no `db.close()`, no WAL checkpoint anywhere in src/). Low actual data risk thanks to WAL and atomic sidecar writes, but first step: in `register()` stop the scheduler, wait up to 5 s for a running scan, `wal_checkpoint(TRUNCATE)`, `close()`.
- **Backups are non-atomic, unverified and have no documented restore** (src/lib/backup.ts:12-13 writes to the final filename; a kill mid-copy leaves a partial file that suppresses the same-day retry; no `quick_check`; `BACKUP_DIR` is hard-coded under DATA_DIR; README has no restore steps). First step: back up to `.tmp` then rename, run `PRAGMA quick_check` on the result, allow `BACKUP_DIR` override, and document "stop container, copy backup over library.db, delete -wal/-shm, start".
- **Environment is parsed ad hoc with silent fallbacks across 8 modules** (`TRUST_PROXY=true` becomes NaN → 'direct' at src/lib/auth.ts:205-206; `AUTH_MIN_PASSWORD_LENGTH=12chars` → 4; `DATA_DIR` default duplicated in db.ts:5 and backup.ts:5). First step: `src/lib/config.ts` that reads and validates every env var once, logs and exits on a malformed value, and exports typed constants.
- **Logging is bare `console.*` with no levels or timestamps, and the Spotify autosync swallows errors** (39 calls across 16 files; src/lib/autosync.ts:29-30 `.catch(() => {})`). First step: a 20-line `src/lib/log.ts` honouring `LOG_LEVEL`, and `.catch((e) => log.error('autosync', e))`.
- **Floating base image, no Dependabot/Renovate, no `engines`/`.nvmrc`** (Dockerfile:2,12 `node:22-bookworm-slim` without digest; unpinned `apt-get install ffmpeg`). First step: `.github/dependabot.yml` for npm, github-actions and docker weekly; pin the base image by digest; add `"engines": { "node": ">=22" }` and `.nvmrc`.
- **No `.env.example`, and `.env` is not gitignored** (.gitignore:6 is `.env*.local` only; Next auto-loads `.env`). First step: add `.env` and `.env.*` (with `!.env.example`) to .gitignore and commit a `.env.example` listing all 11 documented variables.
- **`.dockerignore` omits `test-env`, `.claude`, `docs`, `.github`** (.dockerignore:1-8; `COPY . .` at Dockerfile:8). Only bloats the local builder context (~15 MB), but first step: switch to an allow-list (`*` then `!package.json !package-lock.json !src !public !next.config.mjs !tsconfig.json !tailwind.config.ts !postcss.config.mjs`).
- **README opens by calling the canonical repo a fork of itself; no CONTRIBUTING or SECURITY** (README.md:3,9; docker-compose.test.yml is undocumented and binds the same host port 3000 as the main compose). First step: rewrite the first ten lines as a neutral description with an Acknowledgements section; add a short CONTRIBUTING.md (branch, PR, CI must pass, how to use the test compose on port 3300) and a SECURITY.md contact.

## Missing features (vs Navidrome / Jellyfin / Plexamp)

| Feature | Status | Where it would live | Effort | Why users want it |
|---|---|---|---|---|
| Subsonic folder browsing (`getMusicDirectory`) | absent (see Fix now #4) | src/app/rest/[...view]/route.ts HANDLERS | S | DSub/Substreamer/Ultrasonic default to folder mode; today the artist list is a dead end |
| Genre / year / decade browse pages | absent | new `/api/genres`, `/api/albums?genre=&yearFrom=&yearTo=`, a Genres tab in src/app/library/page.tsx, `/genre/[name]` | M | Data exists (Subsonic `getGenres`, home decade mixes) but the web UI has no way to browse by it |
| Library sort / filter / pagination / multi-select | absent | `?sort=name\|artist\|year\|added\|plays` on `/api/albums` and `/api/artists` (src/lib/data.ts:24,54), sort pills + A-Z bar in library/page.tsx, shift/ctrl-click in TrackList | M | Entire library renders in one hardcoded order; no "recently added" view, no bulk add-to-playlist |
| Multi-disc headers and tag-based track numbers | absent | src/app/album/[id]/page.tsx, src/components/TrackList.tsx:147 | S | Disc 2 track 1 shows as "13" with no boundary |
| Persistent / cross-device play queue | absent (web) + stub (Subsonic `savePlayQueue`/`getPlayQueue`, rest route:584-585) | zustand `persist` in src/store/player.ts; new `play_queue` table keyed by user_id | M | Reload or PWA relaunch loses the session; Symfonium/DSub queue sync silently no-ops |
| Global keyboard shortcuts (Space, arrows, M, L, `/`) | absent | one `document.addEventListener('keydown')` effect in src/components/Player.tsx that ignores input targets | S | Daily annoyance for anyone coming from Spotify/Plexamp/Navidrome |
| M3U / M3U8 playlist import & export | absent | `GET /api/playlists/[id]/export`, `POST /api/playlists/import` reusing src/lib/playlistMatch.ts | M | Migration from Navidrome/foobar/Plex and backup; Subsonic API is the only export path today |
| ListenBrainz scrobbling | absent | new `src/lib/scrobble.ts` fanning out to Last.fm + ListenBrainz; per-profile token in Settings | M | Token-only, open data, default for Navidrome/Jellyfin users; Last.fm needs an admin-registered API key |
| Reverse-proxy header auth / OIDC | absent | opt-in `AUTH_PROXY_HEADER` honoured only when `TRUST_PROXY` is set, in src/proxy.ts:35-47 + a session-minting helper in src/lib/auth.ts | M | Authelia/Authentik/Cloudflare Access users log in twice |
| Transcode cache | absent | `DATA_DIR/transcode/` tee + LRU prune in src/lib/streaming.ts (see Fix soon #10) | M | Same FLAC re-encoded for every play; transcodes unseekable |
| Album / artist stars | absent (star/unstar silently drop `albumId`/`artistId`; `getStarred` hard-codes empty arrays; `getAlbumList type=starred` is `0=1`) | `album_likes`/`artist_likes` tables, rest route:318,323,418-434, `albumJson`/`artistJson` | M | Clients show a star that vanishes on refresh |
| Artist biography / similar artists | absent (`getArtistInfo` returns empty; artist page shows counts only) | Last.fm `artist.getInfo`/`getSimilar` cached in settings with 30-day TTL; src/app/artist/[id]/page.tsx; rest route:333-336 | M | Artist pages are bare; mobile apps' "Similar artists" sections are empty even with a Last.fm key configured |
| `getSimilarSongs`/`getSimilarSongs2` | absent | rest route HANDLERS; random tracks sharing artist/genre | S | "Instant mix"/"Artist radio" in DSub/Symfonium/Ultrasonic show an error toast |
| Multiple library roots | absent (single `music_dir`, Subsonic hardcodes one folder) | `music_dirs` JSON array in src/lib/scanner.ts:41-50, per-root walk, FolderPicker, lyrics write-root mapping | L | Libraries split across drives/shares need mount gymnastics |
| ReplayGain album mode / preamp / off switch | partial (track gain only, applied unconditionally) | store `replaygain_album_gain` in scanner.ts:407; Playback setting Off/Track/Album/Auto in settings/page.tsx | S | Album playback is levelled per track; no way to disable normalisation |
| Admin library statistics and actionable duplicate finder | partial (duplicates is report-only; no size/bitrate/codec stored) | record `size`/`bitrate`/`codec` at scan; Library card in Settings; `tracks.hidden` soft-exclude | M | Admin must delete files by hand; no overview of formats/lossless share |
| Offline PWA shell / download for offline | absent (manifest only, no service worker; README defers offline to Subsonic apps) | service worker registered in Shell.tsx; Cache API for `/api/stream/:id` | L | Installed app cannot render without connectivity; deliberate scope decision today |
| Sleep timer fade-out | partial (hard pause at 5 s granularity, src/components/Player.tsx:405-415) | reuse the `startFade` ramp | S | Abrupt cut is the one thing people do not want from a sleep timer |

## Suggested order of work

**Week 1 (correctness and "it works for the clients you advertise")**
1. Playlist ownership guard across all seven web handlers (Fix now #1).
2. Docker entrypoint/chown fix plus a clear EACCES message and README note (#3).
3. Subsonic trio: `openSubsonic: true`, `getMusicDirectory`, form-body merging (#4-#6); `biography: {}` and per-user recent/frequent while in that file (#33-#34).
4. `getJson` helper + `error.tsx`/`not-found.tsx` and `r.ok` checks on the six detail pages (#10).
5. Player: cold-start stall guard (#7), scrobble/history threshold with the start/played contract (#8), `cancelFade` stopping the idle element (#9, #13), raw-rung offset fix (#14-#15).
6. Last.fm state cookie and `requestOrigin` helper (Fix soon #2-#3); `TRACK_SELECT` reuse and `limit` clamp in radio (#4); proxy Cache-Control exemption for artwork (#5).

**Month 1 (data integrity, performance, engineering baseline)**
1. Stable track identity with relink-before-delete and relative paths (#2), then the compilation/album-artist model (#11); both change the scanner, so do them together behind a versioned migration (`PRAGMA user_version`).
2. CI: `ci.yml` with `tsc --noEmit`, eslint, `next build`, vitest; branch protection; `image:` in compose pointing at GHCR; first tests on auth/subsonic/lyrics/scanner pure functions.
3. Scanner async walk + batched transactions + `synchronous = NORMAL` (#8); missing indexes (#6); search FTS/`search_key` (#7).
4. Streaming: Range/416/ETag (#9), ffmpeg semaphore and `maxBitRate` source check (#10-#11), ICY socket fallback (#12).
5. Integrations: Spotify `api()` throwing + token invalidation (#30), Deezer failure TTL (#31), Lidarr profile/root selection (#32); radio proxy content-type allow-list (#1).
6. UI: `useSession`/`usePlaylists` stores (#21), hoist `TrackRow`/`DlButton` (#22), search abort (#23), TopBar `replace` (#24), shared `Dialog` and label pass (#26-#28), split Settings (#20).

**Later (features and polish)**
1. Queue persistence + Subsonic play queue table; keyboard shortcuts; multi-disc headers; genre/year browse; library sort.
2. Transcode cache; album/artist stars; artist info from Last.fm; `getSimilarSongs`; M3U import/export; ListenBrainz; proxy-header auth.
3. Health endpoint + HEALTHCHECK, graceful shutdown, config module, logger, Dependabot, arm64 image, versioned releases with CHANGELOG, CONTRIBUTING/SECURITY.
4. Low-priority notes below as time allows.

## Low-priority notes

**Security / backend**
- Fresh-install/upgrade admin claim window (src/app/api/users/select/route.ts:63-70, users/route.ts:19-37) is open to anyone on the port until first use; documented in README:339-341. Consider a one-time `ADMIN_BOOTSTRAP_TOKEN` printed to the log.
- `req.json()` has no size guard on public routes (users/select:40, users/route.ts:25, lidarr/webhook:28); add a `readJson(req, 64KB)` helper returning 413, and make it reject non-object/`null` bodies (7 handlers also call `await req.json()` with no catch: history:9, likes:17, playlists:13, playlists/[id]:16, stations:14/26/41, lastfm/config:11).
- Lidarr webhook: secret compared with `!==` from `?token=` (route.ts:23-26; reuse `safeEqual` from subsonic.ts:44-49, accept an `X-Webhook-Token` header), literal `null` body throws a 500 at line 29, and `scheduleScan()` re-arms the 8 s timer on every call so a steady stream of POSTs postpones the rescan; cap the debounce.
- Integration secrets (Lidarr key, Last.fm secret/session keys, Spotify tokens, Subsonic app passwords) sit in plaintext in library.db and all 7 backups (lidarr.ts:16, lastfm.ts:30, spotify.ts:247, subsonic.ts:33, backup.ts:13). Standard for self-hosted, but an AES-GCM `seal/open` wrapper keyed from `SPOTLESS_SECRET_KEY` is cheap; note the app password must stay decryptable.
- Subsonic `authenticate()` (subsonic.ts:52-73) has no failure throttling; reuse `auth_login_attempts` keyed on `sha256(username|ip)`. 72-bit random app passwords keep this low.
- No CSP or HSTS (next.config.mjs:9-15). Add a CSP (`default-src 'self'`, allow dzcdn.net for img/media) and emit HSTS when `x-forwarded-proto` is https.
- Non-admin profiles can read Lidarr URL, absolute music dir, Spotify origin and scan/art error messages with paths (settings/lidarr:7-10, settings/music-dir:7-9, settings/spotify:7-9, scan:7-9, art/fetch:7-9). Keep `configured` booleans public (discover/search/trending need them), gate the rest.
- Scanner follows symlinked files without a containment check (scanner.ts:277-279; stream routes serve `tracks.path` verbatim) and silently skips symlinked/junction directories. Decide one policy: `realpathSync` + require the result under `realpath(musicDir)`, and recurse into link targets with a cycle guard.
- `recordLoginFailure` inserts one row per `sha256(userId|ip)` for any positive integer id (users/select:43,57); purge runs only at startup (db.ts:140). Record unknown ids under a sentinel key.
- FK-constrained writes (history:13, likes:20, my-artists:18, playlists/[id]/tracks:21) 500 on stale ids; map `SQLITE_CONSTRAINT_FOREIGNKEY` to 404.
- `resolve` with a non-numeric id resolves placeholders for every playlist (resolve/route.ts:10, playlistMatch.ts:81-83); validate the id and test `playlistId === undefined` explicitly.
- `/api/search/deezer` loads all artists/albums/tracks per query (route.ts:24-38); check only the returned Deezer names, or cache the sets keyed on last scan.
- `?refresh=1` on collection/releases/discover runs a multi-second Deezer crawl for any profile with no in-flight dedupe (collection/route.ts:7-8, releases.ts:35-42); keep a `Map<key, Promise>` and gate refresh behind admin or a cooldown.
- Home feed runs ~8 `ORDER BY RANDOM() LIMIT 25` statements per load with no genre/year index (data.ts:261-305); add the indexes above and sample ids first, or memoise per user for a few minutes.
- Stats: `PERIODS[period]` walks `Object.prototype` (`?period=constructor` yields empty stats, stats/route.ts:7-16) and `uid`/`userId` are string-interpolated into SQL (stats:19-20,59; data.ts:231,241,252,300-301). Use `Object.hasOwn` and bind parameters.
- Daily activity buckets by UTC day (stats/route.ts:58); accept a validated `?tz=` minutes offset.
- Playlist PATCH/POST accept untyped `name`/`description` (`''` wipes the name; objects 500) ([id]/route.ts:16-19, playlists/route.ts:18); coerce to trimmed strings with a length cap and 400 on empty.
- `/api/requests` and `/api/discover/dislike` return raw snake_case; `/api/likes` returns `number[]` or `Track[]` from the same URL (requests.ts:16-19, dislike/route.ts:9, likes/route.ts:10-13). Alias columns; split likes into `/api/likes` and `/api/likes/ids`.
- Admin request queue is capped at 50 with no pagination or status filter (requests.ts:42-46).
- Lidarr/Spotify upstream failures return 400 (lidarr/add:25, settings/lidarr:26, spotify/*) and `/api/lidarr/queue` hides failures behind an empty 200; introduce typed errors mapped to 409/502/404.

**Database**
- Subsonic `createPlaylist`/`updatePlaylist` delete and re-insert `playlist_tracks` without a transaction and renumber from 0 ignoring `playlist_placeholders` (rest route:458-471,491-495); wrap in `db.transaction` and reuse `nextPosition` from playlistMatch.ts.
- Schema evolution is per-boot column probing with no version number; fresh installs build the single-user `likes` table then drop/rebuild it and log "migrated to multi-user" (db.ts:52-55,155-196). Introduce `PRAGMA user_version` before the identity migration.
- `db` is a module-level `let` while scanner/art/lyrics/spotify use `globalThis` slots (db.ts:7-12); dev HMR opens extra connections. Move it to `globalThis.__spotlessDbV1`.
- `user_id` columns have no FK to `users` and there is no `deleteUser()`; add one that runs in a transaction and cleans `settings` keys `LIKE '%:id'`.
- Subsonic empty-query `search3` paging sorts all tracks by `title COLLATE NOCASE` with OFFSET and no index (rest route:190-206); add `idx_tracks_title_nocase`/`idx_albums_name_nocase`, prefer keyset pagination.
- `getPlaylists` is 1+N for cover art ids (data.ts:164,139-149); fetch in one statement and hoist prepared statements.
- Session token validated twice per request (proxy.ts:35 and every `userIdFrom`); forward a stripped `x-spotless-uid` header or memoise per token briefly.
- Orphaned `<id>.img`/`artist-<id>.img` files are never removed when albums/artists are pruned or merged (scanner.ts:417-420,205,245); unlink before delete or sweep periodically.

**Media / scanner**
- Embedded art is written full-size, unvalidated and non-atomically from `c.picture[0]` (scanner.ts:390-394); reuse `writeImage()` from art.ts, prefer `Cover (front)`, apply `MAX_IMAGE_BYTES`.
- `parseFile(file, { duration: true })` never sets `skipCovers` (scanner.ts:369); pass `skipCovers: album.has_art !== 0`.
- Artwork responses carry no ETag/Last-Modified and are never resized; Subsonic `getCoverArt` ignores `size` and hard-codes `image/jpeg` (artwork/[albumId]/route.ts:41-49, rest route:134-142). Use `imageContentType(buf)` in the Subsonic route now; add thumbnails with sharp later.
- Lyrics sidecar job stats every track with sync `existsSync` after each scan when enabled (lyrics.ts:544-574); gate on `changed > 0` and yield every N tracks.
- `?offset=Infinity` yields `-ss Infinity` and an empty 200 (stream/[id]/route.ts:20, streaming.ts:78-80); require `Number.isFinite`, clamp to duration.
- Artist placeholder letter is interpolated unescaped into SVG; `&`/`<` break the image (artwork/artist/[artistId]/route.ts:14,24).

**Player**
- `onStalled: onWaiting` (Player.tsx:454) scores network hiccups with a full buffer as rebuffers; drop it or require `!a.paused && readyState < HAVE_FUTURE_DATA`.
- Skipping mid-fade and manual next/jumpTo never promote the preloaded element, so the next track is downloaded twice (Player.tsx:145-156 vs 388-395); factor the swap into a helper used by the track effect when `hasSrc(other, track)`.
- EQ routing is permanent for the session once enabled (eq.ts:83); documented trade-off, but consider re-mounting the `<audio>` elements on disable.
- ReplayGain is applied via `Math.min(1, volume * gainMult)` (Player.tsx:41), so positive gains are dropped near full volume; a fixed pre-amp headroom (-6 dB) fixes it.
- No `setPositionState`/`playbackState`/`seekto` Media Session handlers (Player.tsx:220-226); matters mainly because the `?offset=` transcode trick makes element-derived position wrong.
- `usePlayer()`/`useLikes()` without selectors in TrackList.tsx:58-59 and radios/page.tsx:20-21 re-render every row during volume drags; use selectors.

**UI**
- Shell renders a blank black div on the server (Shell.tsx:33); low value for a LAN app since page content is client-fetched anyway.
- Playlist reorder is HTML5 drag only (TrackList.tsx:80-95); add Move up/down buttons and an aria-live announcement.
- Rename does not dispatch `playlists-changed` (playlist/[id]/page.tsx:46-54); fixed by the shared store.
- Ad-hoc `setInterval` polls in rescan/fetchArt are not cleared on unmount (settings/page.tsx:295-315, library/page.tsx:39-46); they self-clear when the job ends, but store them in a ref.
- Global `:focus-visible { border-radius: 4px }` squares off `rounded-full` controls; range thumbs are `opacity: 0` unless hovered (globals.css:57-61,90-101).
- Tab rows and toggles have no `aria-pressed`/`aria-selected` (library/page.tsx:76-88, stats:57-58, settings:684-693,770-779).
- `<img>` grids on Home, Stats, Discover and Search lack `loading="lazy"` (page.tsx:112, stats:132/151, discover:292/386/448/494, search:206/229/250).
- `location.reload()` after scan kills in-progress playback (library/page.tsx:44, page.tsx:47); refetch instead. `discover/page.tsx:180` uses a raw `<a href="/trending">` instead of `<Link>`.
- All strings are inline English with hand-rolled plurals; fine for scope, but say so.

**Integrations**
- Spotify `accessToken()` has no in-flight refresh lock (spotify.ts:270-278); self-heals, but a per-user `Map<userId, Promise>` is trivial.
- Spotify token endpoint and both Last.fm POSTs have no `AbortSignal.timeout` (spotify.ts:233-237, lastfm.ts:56-60,71-75); every other outbound fetch has one.
- Trending has no negative caching; a partial Deezer outage can cost up to 7 serial 10 s timeouts and the page shows an empty spinner (trending.ts:92,124,182-185); fetch genre charts with `Promise.all`, store a short-TTL negative entry, return an `error` flag.
- Six copy-pasted Deezer clients with 8/10 s timeouts and no handling of the HTTP-200 `error` envelope (discover.ts:33-41, releases.ts:18-26, trending.ts:27-35, search/deezer:6-14, preview:14-21, art.ts:133-140); one `src/lib/deezer.ts` with backoff and a paced batch helper.
- Lyrics sidecar sleeps for Retry-After then `break`s anyway, and walks every remaining track on 5xx streaks at 350 ms (lyrics.ts:586-612); drop the sleep or `continue`, add a consecutive-failure bail-out. On-demand `resolveLyrics` forgets a 429 immediately (lyrics.ts:399-406); keep a module-level `lrclibBackoffUntil`.
- SpotifyImport reports "albums sent" for non-admins whose adds were only queued (202 `status:'requested'`) and leaves `busy` set on non-JSON errors (SpotifyImport.tsx:40,70-73).
- Spotify playlist import truncates at 1000 tracks / 250 playlists without a flag (spotify.ts:355,380); follow `page.next` or return `truncated: true`.
- `addAlbumToLidarr` refetches the whole `/artist` list per add and polls `/album` up to 6 x 5 s (lidarr.ts:56,123-127); use `/artist?mbId=`, cap polls, return a "pending metadata" status.
- Lidarr `AlbumImport` never marks a `requests` row fulfilled (webhook/route.ts:31-37); match artist/album against pending requests and set `status='available'`.

**Subsonic**
- `stream` ignores `timeOffset` (rest route:116-120); wire `offset` through *and* advertise the `transcodeOffset` extension.
- `num()` treats an explicit `0` as "use default" (route.ts:49-53), so `artistCount=0&albumCount=0` still returns 20 of each per page.
- `xmlEscape` passes control characters through (subsonic.ts:79-81); strip `[\x00-\x08\x0B\x0C\x0E-\x1F]`.
- `scrobble` stores `played_at = now` instead of the client's `time` (route.ts:408); offline-replayed scrobbles land at replay time locally.
- `getRandomSongs` ignores `genre`/`fromYear`/`toYear` (route.ts:303-307); the filters already exist for `albumList`.

**DevEx / ops**
- GHCR image is amd64-only (docker.yml:56); add `setup-qemu-action` and `linux/amd64,linux/arm64` (better-sqlite3 ships arm64 prebuilds).
- Spotless `serverVersion` '0.2.0' vs package.json 0.1.0 vs LRCLIB UA 0.1.0; one imported constant.

## Findings the verifier rejected

- Mobile bottom nav and full-screen player ignore iOS safe-area insets — refuted: the app never sets `viewport-fit=cover`, so iOS lays the page out inside the safe area; the overlap would only appear if the proposed fix were applied, and the nav sits in a non-fixed flex column over a black body.
- PWA claim is manifest-only, so the app is not offline-capable — refuted as a defect: README says "installable PWA manifest" (accurate) and explicitly defers offline download to Subsonic client apps (L138, L411); recorded as a feature wish in the table above instead.