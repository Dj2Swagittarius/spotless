# Spotless Server Setup — YouTube Script

**Target length:** ~5 minutes  ·  **Tone:** relaxed, a friend walking you through it
Lines in *[brackets]* are what's on screen. Everything else is narration. Each numbered part is one narration clip.
Every screen uses a demo server with made-up artists and placeholder paths, so no real addresses or names appear.

---

## 01. Hook

*[Spotless home page full of album art, then title card]*

Want your own music streaming app, where every song is yours and nothing disappears when a license runs out?
In this video I'll set up a Spotless server from scratch. It takes about ten minutes, and you don't need to
write a single line of code.

## 02. What you need

*[Card: checklist]*

You need three things. A computer that stays on: a nass, an old PC, a mini PC, or a Raspberry Pi all work. A
folder of music on it, or on a drive it can reach. And Docker, which is what actually runs Spotless.

## 03. Install Docker

*[Card: Docker install options per system]*

If you don't have Docker yet: on Windows or a Mac, install Docker Desktop from docker.com and open it once. On
Linux, the one-line install script from Docker's site does the job. And most nass boxes have Docker built in,
usually called Container Manager or an app store. Find that and turn it on.

## 04. Get the compose file

*[Terminal card: mkdir, cd, curl the compose file]*

Make a folder for Spotless, then download one file into it: docker-compose.yml from the Spotless GitHub page.
Link's in the description. That file tells Docker everything it needs to know.

## 05. Point it at your music

*[Editor card: compose file, music lines highlighted]*

Open it in any text editor and find the two lines that say "path to your music". Replace that with the real
folder where your music lives, on both lines. The first one is read-only, so Spotless can never change your
files. The second is only used to save synced lyrics next to your songs, and you can delete it if you don't
want that.

## 06. Ownership

*[Editor card: PUID and PGID lines highlighted]*

On Linux or a nass, there's one more optional thing. P-U-I-D and P-G-I-D tell Spotless which user should own its
data folder. The defaults work for most people. If yours are different, the commands "id dash u" and "id dash g"
will tell you what to put.

## 07. Start it

*[Terminal card: docker compose pull, docker compose up -d, container started]*

Now save the file, open a terminal in that folder, and run "docker compose pull", then "docker compose up dash
d". The first one downloads Spotless, the second one starts it in the background. When it says "Started",
you're running.

## 08. Open it in a browser

*[Card: browser address bar, http://<server-ip>:3000, where to find the IP]*

Open a browser on any device on your network and go to your server's address, port three thousand. If it's the
same computer, localhost works. Otherwise, use the server's IP address. You'll find it in your router's device
list, or in your nass settings.

## 09. Welcome and admin profile

*[Screen: setup wizard welcome, then typing a name and password]*

The first time you open it, a setup wizard takes over. Hit "Get started" and create your admin profile. That's
you. Pick a name and a password. A PIN is fine on a home network, but use a long passphrase if Spotless will be
reachable from the internet.

## 10. Scan your library

*[Screen: music folder step, Scan now, Found 23 tracks]*

Next, your music folder. In Docker, it's always "slash music", which is the folder you set up earlier. Hit "Scan
now". It reads your tags and album art, and a big library takes a few minutes. Here, it found all of my demo
tracks.

## 11. Optional extras

*[Screen: Lidarr step, skip; Spotify step, skip; You're set]*

Lidarr and Spotify are optional, so I'll skip them for now. They're always in Settings later. And that's it.
You're set.

## 12. Your library

*[Screen: home page, then an album page, then playing a song]*

Hit "Start listening" and there's your library, ready to play. Albums, artists, playlists, the whole thing.

## 13. Family and apps

*[Card: profiles + desktop, Android, Subsonic apps]*

To add your family, open the profile menu and go to "Manage profiles". Each person gets their own likes,
playlists, and history. And you're not stuck in the browser: there's a desktop app, an Android app, and any
Subsonic app works too. Just give them the same address you used in the browser.

## 14. Updates and backups

*[Terminal card: docker compose pull && docker compose up -d; backups folder]*

Updating later is the same two commands: "docker compose pull", then "docker compose up dash d". Your data
stays put. And Spotless backs up its own database every night, into the data folder next to your compose file.

## 15. Outro

*[End card: GitHub link, subscribe]*

That's your own music server, up and running. Everything's free and open source, and the links are in the
description. If you get stuck, drop a comment. Thanks for watching, and go play something good.

---

## Description

Set up your own Spotless music server with Docker in about ten minutes: install Docker, download one compose
file, point it at your music, start it, and walk through the setup wizard.

- Spotless on GitHub: https://github.com/Dj2Swagittarius/spotless
- Docker Desktop: https://www.docker.com/products/docker-desktop/
- Docker on Linux: https://docs.docker.com/engine/install/

0:00 Intro
0:14 What you need
0:29 Install Docker
0:49 Get the compose file
1:02 Point it at your music
1:22 Folder ownership (Linux / NAS)
1:40 Start it
1:56 Open it in a browser
2:12 Setup wizard: admin profile
2:27 Scan your library
2:43 Optional extras
2:51 Your library
3:02 Family and apps
3:20 Updates and backups
3:35 Outro
