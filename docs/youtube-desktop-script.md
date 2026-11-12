# Spotless Desktop — YouTube Script

**Target length:** ~5–6 minutes  ·  **Tone:** relaxed, a friend showing off something they built
Lines in *[brackets]* are what's on screen. Everything else is what you say.

---

## 1. Hook (0:00–0:20)

*[Slow pan across the Spotless window: an album page with big cover art, then down to the player bar at the
bottom as a song starts, music fading in]*

What if your music player looked this good... but every song in it was yours? No subscription. No ads. No
album that disappears next month because a license ran out.

This is Spotless. And today I'm showing you the desktop app.

*[Title card: SPOTLESS — your music, your server, your app]*

---

## 2. What Spotless is (0:20–1:00)

*[Screen: browser tab with Spotless home page]*

Quick background if you're new. Spotless is a music server you run yourself. You point it at a folder of
music — on a NAS, an old PC, a Raspberry Pi, whatever — and it turns that folder into a full streaming app:
playlists, liked songs, lyrics, listening stats, discovery, even an AI DJ.

Until now, you used it in a browser tab. And that works. But a browser tab gets buried under forty other tabs,
your media keys fight with YouTube, and closing the wrong tab kills your music.

So now Spotless has its own app. Windows, Mac, and Linux.

---

## 3. Download and install (1:00–1:45)

*[Screen: GitHub releases page, cursor hovering the three installers]*

Head to the releases page — link's in the description. There's one file per system:

- **Windows:** the `Setup.exe`
- **Mac:** the `.dmg` — it runs on both Intel and Apple Silicon
- **Linux:** an AppImage, or a `.deb` if you're on Ubuntu or Debian

*[Screen: SmartScreen popup on Windows]*

Heads up — the installers aren't code-signed yet, so your computer will be a little suspicious the first time.
On Windows, click **More info**, then **Run anyway**. On a Mac, open the app once, then go to
**System Settings → Privacy & Security** and hit **Open Anyway**. You only do this once.

---

## 4. First launch: connecting to your server (1:45–2:45)

*[Screen: setup screen asking for the server address]*

First time you open it, it asks one question: where's your server?

You've got two options. If you know the address — the same one you type into your browser, something like
`http://192.168.1.10:3000` — just type it in.

*[Click "Scan network", results appear]*

Or hit **Scan network**. It checks your computer and your home network for Spotless and lists what it finds.
Click yours, and you're in.

*[Profile picker appears: "Who's listening?"]*

Pick your profile, sign in, done. And it remembers. Next time you open the app, you go straight to your music.

---

## 5. Tour: it's the full player (2:45–4:15)

*[Screen: home feed, slowly scrolling]*

Here's the thing — this isn't some stripped-down "lite" version. It's the exact same Spotless you get in the
browser. Every feature, every theme.

*[Show each as you mention it]*

- Your **home feed** — recently played, your top tracks, mixes built from your own library.
- **Gapless playback** and **crossfade**, so albums flow the way they're supposed to.
- The **10-band equalizer**, with presets or your own curve.
- **Synced lyrics** that scroll along with the song.
- **Radio mode** — pick any song and it builds an endless queue of similar stuff you already own.
- **Discover** — new releases from artists you follow, and albums you're missing from their catalog.
- And the **AI DJ**, which can build you a set, make playlists, and even talk between songs like a radio host.

*[Theme montage: the same page flipping through several themes]*

And my favorite part: **themes**. I like to customize things to my style, and Spotless has over twenty of them.
Everything from calm and dark, to Synthwave, Terminal, and even a Windows 98 look.

*[Close-up: pressing physical play/pause and next keys on keyboard]*

What the app adds on top: **media keys**. Play, pause, skip — right from your keyboard, even when Spotless is
in the background.

*[Screen: Windows media overlay / Mac Now Playing showing the current song]*

And it plugs into your system's media controls, so the song shows up in the volume popup on Windows or Now
Playing on the Mac, with the album art.

---

## 6. Switching servers (4:15–4:40)

*[Screen: press Alt, menu appears, click Spotless → Change server…]*

Got more than one server? Maybe one at home and one at a friend's place? On Windows and Linux, tap **Alt** to
show the menu, then **Spotless → Change server**. Pick a new one and you're switched.

---

## 7. Wrap-up (4:40–5:30)

*[Back to the album page from the intro, player bar at the bottom showing the song playing]*

So that's Spotless Desktop. Your own music, in its own window, with your media keys working the way they
should.

There's also an Android app now — I'll do a video on that next, so subscribe if you want to catch it.

*[Screen: GitHub page, Sponsors / Ko-fi links]*

Spotless is free and open source. If it's useful to you, there are GitHub Sponsors and Ko-fi links in the
description — that's what keeps this going.

Links to the download and setup guide are below. Drop a comment if you get stuck, and tell me what you want
to see added next.

Thanks for watching. Go play something good.

*[End screen]*

---

## Title

Spotless Desktop: Your Own Music Streaming App (Free & Self-Hosted)

## Description box (copy-paste)

> Spotless is a free, self-hosted music server — and now it has a desktop app for Windows, Mac and Linux.
>
> Download: https://github.com/Dj2Swagittarius/spotless/releases
> Setup guide: https://github.com/Dj2Swagittarius/spotless#desktop-app
> Support: https://github.com/sponsors/Dj2Swagittarius · https://ko-fi.com/dj2swagittarius
>
> 0:00 Intro
> 0:15 What is Spotless?
> 0:51 Download & install
> 1:26 Connecting to your server
> 1:50 Tour of the player
> 2:38 Themes
> 2:51 Media keys
> 3:08 Switching servers
> 3:21 Wrap-up

## Recording checklist

- Use a demo library with music you're allowed to show (Creative Commons or your own) — copyrighted songs can
  get the video claimed or muted.
- Blur or skip your real server address if it isn't a generic LAN one.
- Record the SmartScreen / Gatekeeper warning on a fresh machine or VM so viewers see exactly what to expect.
