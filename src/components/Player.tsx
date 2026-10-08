'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePlayer } from '@/store/player';
import { useLikes } from '@/store/likes';
import { fmtDuration } from '@/lib/format';
import { attachEq, resumeEq } from '@/lib/eq';
import {
  RUNGS,
  currentRung,
  deferPreload,
  isLower,
  loadQuality,
  noteStall,
  onNetworkChange,
  streamQuery,
  type Rung,
} from '@/lib/adaptive';
import type { Track } from '@/lib/types';
import Lyrics from './Lyrics';
import AddToPlaylist from './AddToPlaylist';
import {
  PlayIcon,
  PauseIcon,
  NextIcon,
  PrevIcon,
  ShuffleIcon,
  RepeatIcon,
  VolumeIcon,
  QueueIcon,
  HeartIcon,
  MicIcon,
  RadioIcon,
  MoonIcon,
  ChevronDownIcon,
} from './Icons';

// ReplayGain: convert dB to a volume multiplier, clamped so we never exceed element max
const gainMult = (g?: number | null) => (g == null ? 1 : Math.min(1.4, Math.pow(10, g / 20)));

function crossfadeSec(): number {
  try {
    return Math.max(0, Math.min(12, Number(localStorage.getItem('crossfade') ?? 0) || 0));
  } catch {
    return 0;
  }
}

// Auto mode reloads the playing track at a lower rung when it rebuffers; this is the
// floor between two such switches, so a rough patch walks down the ladder instead of
// collapsing to Data saver on one bad moment.
const SWITCH_COOLDOWN_MS = 8000;
// Swapping the source (a downshift, or a seek on a transcode) makes the element buffer
// by definition — don't score that against the connection.
const STALL_GRACE_MS = 4000;
// Ceiling on reloads of one track, so bad tags or a dead server can't wedge the player
// in a retry loop — after this it gives up and moves on like any other failed track.
const MAX_RESTREAMS_PER_TRACK = 4;
// How far before the end of a track the next one is fetched when the preload is being
// held back — enough lead time for the gapless/crossfade handoff, without spending the
// whole song downloading two streams over one weak connection.
const PRELOAD_LEAD_S = 45;
// A track counts as played (history row + scrobble) once this much of it has actually
// been heard: half the song, or four minutes for long ones — the Last.fm rule.
const PLAYED_CAP_S = 240;
// A timeupdate gap larger than this is a seek or a source swap, not listening.
const MAX_LISTEN_DELTA_S = 2;
// Keyboard seek step for the arrow keys.
const KEY_SEEK_S = 5;

type HistoryEvent = 'start' | 'played';

/** Live stations and playlist placeholders never go to history or Last.fm. */
function isLibraryTrack(t: Track | null | undefined): t is Track {
  return !!t && t.id > 0 && !t.streamUrl;
}

function postHistory(t: Track, event: HistoryEvent, startedAt?: number) {
  if (!isLibraryTrack(t)) return;
  fetch('/api/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackId: t.id, event, startedAt: startedAt && startedAt > 0 ? startedAt : undefined }),
  }).catch(() => {});
}

/** True when a keydown happened in something that takes typing (or has its own key handling). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}

export default function Player() {
  const audioARef = useRef<HTMLAudioElement>(null);
  const audioBRef = useRef<HTMLAudioElement>(null);
  const [active, setActive] = useState(0);
  const fadingRef = useRef(false);
  const fadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const radioFetchingRef = useRef(false);
  const lastSwitchRef = useRef(0);
  const restreamsRef = useRef(0);
  // pending "seek once metadata is in" for a raw-rung restream, so it can be dropped when
  // the element moves on to another stream before the metadata ever arrives
  const resumeSeekRef = useRef<{ el: HTMLAudioElement; handler: () => void } | null>(null);
  // listening bookkeeping for the current play of the current track
  const listenedRef = useRef(0); // seconds actually heard (timeupdate deltas)
  const lastPosRef = useRef<number | null>(null); // position at the previous timeupdate
  const startPostedRef = useRef(false); // 'start' sent for this play
  const playedPostedRef = useRef(false); // 'played' sent for this play
  const startedAtRef = useRef(0); // unix seconds this play began
  const mutedFromRef = useRef(1); // volume to come back to after the M key mutes

  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const volume = usePlayer((s) => s.volume);
  const radio = usePlayer((s) => s.radio);
  const toggle = usePlayer((s) => s.toggle);
  const next = usePlayer((s) => s.next);
  const prev = usePlayer((s) => s.prev);
  const jumpTo = usePlayer((s) => s.jumpTo);
  const toggleShuffle = usePlayer((s) => s.toggleShuffle);
  const cycleRepeat = usePlayer((s) => s.cycleRepeat);
  const setVolume = usePlayer((s) => s.setVolume);
  const setPlaying = usePlayer((s) => s.setPlaying);
  const toggleRadio = usePlayer((s) => s.toggleRadio);
  const appendTracks = usePlayer((s) => s.appendTracks);
  const moveInQueue = usePlayer((s) => s.moveInQueue);
  const likedIds = useLikes((s) => s.ids);
  const toggleLike = useLikes((s) => s.toggle);
  const likes = { ids: likedIds, toggle: toggleLike };
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showQueue, setShowQueue] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [expanded, setExpanded] = useState(false); // mobile: mini vs full player
  const [sleepUntil, setSleepUntil] = useState<number | null>(null);
  const pathname = usePathname();
  const SLEEP_STEPS = [15, 30, 60, 90]; // minutes
  const dragFrom = useRef<number | null>(null);

  const track = index >= 0 ? queue[index] : null;
  const isStation = Boolean(track?.streamUrl); // live internet radio: no seek, no like, no scrobble
  // On a repeat-all wrap with shuffle on the store deals a new order, so the first track of
  // the next lap is unknown until then — nothing to preload or crossfade into.
  const wrapsToStart = repeat === 'all' && queue.length > 0 && !(shuffle && queue.length > 1);
  const nextIndex = index + 1 < queue.length ? index + 1 : wrapsToStart ? 0 : -1;
  const nextTrack = nextIndex >= 0 ? queue[nextIndex] : null;

  const els = () => [audioARef.current, audioBRef.current] as const;

  // restore the saved session once we are on the client (see skipHydration in the store):
  // the queue comes back paused at the saved index, nothing starts playing by itself.
  // With storage blocked (private mode) the middleware never attaches `persist` at all.
  useEffect(() => {
    usePlayer.persist?.rehydrate()?.catch(() => {});
  }, []);

  const clearResumeSeek = () => {
    const pending = resumeSeekRef.current;
    if (pending) pending.el.removeEventListener('loadedmetadata', pending.handler);
    resumeSeekRef.current = null;
  };

  // Each element remembers the rung and start offset of the stream it holds, so a
  // downshift can compare against what is actually playing (not what the ladder said
  // when the track loaded) and resume at the right second after the source swap.
  const rungOf = (a: HTMLAudioElement | null) =>
    RUNGS.find((r) => r.id === a?.dataset.rung) ?? currentRung();
  const offsetOf = (a: HTMLAudioElement | null) => Number(a?.dataset.offset ?? 0) || 0;
  const setSrc = (a: HTMLAudioElement, t: Track, rung: Rung, offset = 0) => {
    if (resumeSeekRef.current?.el === a) clearResumeSeek(); // whatever was pending is for a stream that is gone
    a.dataset.rung = rung.id;
    // only a transcode starts the stream at `offset` (?offset=), so only then does the
    // element's own clock need shifting; a raw file seeks instead and its clock is absolute
    a.dataset.offset = rung.bitrate > 0 ? String(offset) : '0';
    a.src = t.streamUrl ?? `/api/stream/${t.id}${streamQuery(rung, offset)}`;
  };
  // match on the base path (ignoring the quality query) so changing quality mid-session
  // doesn't force-reload the current track; anchor to avoid 12 matching 123
  const hasSrc = (a: HTMLAudioElement | null, t: Track) =>
    !!a &&
    (t.streamUrl
      ? a.src.includes(t.streamUrl)
      : a.src.includes(`/api/stream/${t.id}?`) || a.src.endsWith(`/api/stream/${t.id}`));

  // navigating anywhere closes the full-screen player and popups
  useEffect(() => {
    setExpanded(false);
    setShowLyrics(false);
    setShowQueue(false);
  }, [pathname]);

  /**
   * Abort a crossfade in progress. The incoming element is parked (paused, rewound,
   * silent) but keeps its src so the preload is not thrown away, and the active element
   * gets its full volume back — otherwise a seek or a downshift mid-fade would leave
   * both tracks audible, or the current one stuck half-faded.
   */
  const cancelFade = () => {
    if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
    fadeTimerRef.current = null;
    if (!fadingRef.current) return;
    fadingRef.current = false;
    const a = els()[active];
    const b = els()[1 - active];
    if (b) {
      b.pause();
      b.volume = 0;
      try {
        b.currentTime = 0;
        // a transcode pipe may not be seekable at all; reload it rather than start the
        // next song a few seconds in later on (src stays, so hasSrc still matches)
        if (b.currentTime > 1) b.load();
      } catch {
        // nothing loaded yet
      }
    }
    if (a) a.volume = Math.min(1, volume * gainMult(track?.gain));
  };

  // EQ: route both elements through the filter chain (no-op until the user enables it);
  // listens for settings changes so first-time enable attaches mid-session
  useEffect(() => {
    const attach = () => els().forEach((a) => attachEq(a));
    attach();
    window.addEventListener('eq-changed', attach);
    return () => window.removeEventListener('eq-changed', attach);
  }, []);

  // drop a pending raw-rung resume seek when the player unmounts
  useEffect(() => clearResumeSeek, []);

  /** Forget the listening bookkeeping: a new track, or a replay of this one. */
  const resetPlayTracking = () => {
    listenedRef.current = 0;
    lastPosRef.current = null;
    startPostedRef.current = false;
    playedPostedRef.current = false;
    startedAtRef.current = 0;
  };

  /** Playback of the current track has begun (once per play): Last.fm "now playing". */
  const markStarted = (t: Track) => {
    if (startPostedRef.current || !isLibraryTrack(t)) return;
    startPostedRef.current = true;
    startedAtRef.current = Math.floor(Date.now() / 1000);
    postHistory(t, 'start');
  };

  // load current track into the active element (skip when a fade already put it there)
  useEffect(() => {
    const a = els()[active];
    if (!a || !track) return;
    clearResumeSeek();
    resetPlayTracking();
    // seed from the tagged length: a transcoded pipe may never report a usable duration
    setDuration(track.streamUrl ? 0 : track.duration || 0);
    restreamsRef.current = 0;
    if (!hasSrc(a, track)) {
      cancelFade();
      const other = els()[1 - active];
      if (other) {
        other.pause();
        other.removeAttribute('src');
      }
      setSrc(a, track, currentRung());
      a.volume = Math.min(1, volume * gainMult(track.gain));
      // a restored session lands here paused: load the track, don't start it
      if (isPlaying) a.play().catch(() => {});
      setProgress(0);
    }
    if (isPlaying) markStarted(track);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album,
        artwork: [{ src: `/api/artwork/${track.albumId}`, sizes: '300x300' }],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id]);

  // preload the upcoming track into the idle element for gapless/crossfade starts
  // (skip live stations — nothing to preload, and buffering a live stream wastes bandwidth)
  useEffect(() => {
    const other = els()[1 - active];
    if (!other || fadingRef.current) return;
    if (deferPreload() && duration > 0 && duration - progress > Math.max(PRELOAD_LEAD_S, crossfadeSec())) return;
    if (nextTrack && !nextTrack.streamUrl && !hasSrc(other, nextTrack)) {
      other.preload = 'auto';
      setSrc(other, nextTrack, currentRung());
      other.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextTrack?.id, active, progress, duration]);

  // radio: when the last queued track starts, top the queue up in advance
  useEffect(() => {
    if (!radio || !track || track.streamUrl || index !== queue.length - 1 || radioFetchingRef.current) return;
    radioFetchingRef.current = true;
    const exclude = queue.slice(-200).map((t) => t.id).join(',');
    fetch(`/api/radio?seed=${track.id}&exclude=${exclude}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.tracks?.length) appendTracks(d.tracks);
      })
      .catch(() => {})
      .finally(() => {
        radioFetchingRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, radio]);

  // play/pause sync on the active element — and on the incoming one while a crossfade
  // is running, so pausing mid-fade silences both and resuming picks the fade back up
  useEffect(() => {
    const a = els()[active];
    if (!a || !track) return;
    const b = fadingRef.current ? els()[1 - active] : null;
    if (isPlaying) {
      resumeEq();
      a.play().catch(() => {});
      b?.play().catch(() => {});
    } else {
      a.pause();
      b?.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, active]);

  useEffect(() => {
    const a = els()[active];
    if (a && !fadingRef.current) a.volume = Math.min(1, volume * gainMult(track?.gain));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume, active]);

  // Per-render snapshot for listeners that are registered once (keyboard, media session
  // seekto): they read through this instead of closing over a stale render.
  const latest = useRef({ seek: (_v: number) => {}, progress, duration, volume, canSeek: false });

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => {
      resumeEq();
      setPlaying(true);
    });
    ms.setActionHandler('pause', () => setPlaying(false));
    ms.setActionHandler('nexttrack', next);
    ms.setActionHandler('previoustrack', prev);
    try {
      ms.setActionHandler('seekto', (d) => {
        if (d.seekTime != null && latest.current.canSeek) latest.current.seek(d.seekTime);
      });
    } catch {
      // older browsers reject actions they don't know
    }
    ms.playbackState = isPlaying ? 'playing' : 'paused';
  }, [next, prev, setPlaying, isPlaying]);

  /** Tell the OS media controls where we are (lock screen scrubber); duration must be known. */
  const updatePositionState = (pos: number, dur: number) => {
    if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
    if (!Number.isFinite(dur) || dur <= 0) return;
    try {
      navigator.mediaSession.setPositionState({ duration: dur, playbackRate: 1, position: Math.max(0, Math.min(dur, pos)) });
    } catch {
      // position outside duration, or no media session support for this
    }
  };

  const startFade = (cf: number) => {
    const a = els()[active];
    const b = els()[1 - active];
    if (!a || !b || !nextTrack) return;
    if (!hasSrc(b, nextTrack)) setSrc(b, nextTrack, currentRung());
    fadingRef.current = true;
    b.volume = 0;
    b.play().catch(() => {
      cancelFade();
    });
    let t = 0;
    fadeTimerRef.current = setInterval(() => {
      // paused mid-fade: hold the curve where it is until playback resumes
      if (!usePlayer.getState().isPlaying) return;
      t += 0.1;
      const k = Math.min(1, t / cf);
      const vol = usePlayer.getState().volume; // live, so a volume change mid-fade is honoured
      b.volume = Math.min(1, vol * gainMult(nextTrack?.gain)) * k;
      a.volume = Math.min(1, vol * gainMult(track?.gain)) * (1 - k);
      if (k >= 1) {
        if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
        fadeTimerRef.current = null;
        a.pause();
        a.removeAttribute('src');
        fadingRef.current = false;
        setActive(1 - active);
        next();
      }
    }, 100);
  };

  /**
   * Reload the active element at `rung`, resuming from wherever playback is now via
   * ?offset= instead of restarting the track. This is both halves of adaptive quality:
   * stepping down a rung when the connection can't keep up, and recovering a transcode
   * that died mid-song (a transcode is a one-shot pipe — once the browser loses it,
   * there are no byte ranges to range-request your way back with, so playback just
   * stops where the buffer ran out).
   * Returns false if it declined (cooldown, or too many retries on this track).
   */
  const restream = (a: HTMLAudioElement, rung: Rung): boolean => {
    if (!track || track.streamUrl) return false; // live stations have no rungs to pick from
    if (Date.now() - lastSwitchRef.current < SWITCH_COOLDOWN_MS) return false;
    if (restreamsRef.current >= MAX_RESTREAMS_PER_TRACK) return false;
    lastSwitchRef.current = Date.now();
    restreamsRef.current += 1;
    const at = offsetOf(a) + (Number.isFinite(a.currentTime) ? a.currentTime : 0);
    cancelFade();
    setSrc(a, track, rung, at);
    if (rung.bitrate === 0 && at > 0) {
      // the original file is byte-range seekable, so it resumes by seeking rather than
      // by asking the server to start the stream somewhere else
      const src = a.src;
      const handler = () => {
        resumeSeekRef.current = null;
        if (a.src !== src) return; // element was reused for another stream in the meantime
        try {
          a.currentTime = at;
        } catch {
          // not seekable after all
        }
      };
      resumeSeekRef.current = { el: a, handler };
      a.addEventListener('loadedmetadata', handler, { once: true });
    }
    a.volume = Math.min(1, volume * gainMult(track.gain));
    setProgress(at);
    if (isPlaying) a.play().catch(() => {});

    // bring the already-preloaded next track down too, so it doesn't hit the same wall
    const other = els()[1 - active];
    if (other && nextTrack && !nextTrack.streamUrl && hasSrc(other, nextTrack) && isLower(rung, rungOf(other))) {
      setSrc(other, nextTrack, rung);
      other.pause();
    }
    return true;
  };

  /** Rung we should be on right now: the ladder in Auto, otherwise the fixed choice. */
  const wantedRung = (a: HTMLAudioElement) => (loadQuality() === 'auto' ? currentRung() : rungOf(a));

  // rebuffering is the signal the network hints can't give us — a weak cell still
  // reports itself as "4g" right up until the music stops
  const onWaiting = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const a = e.currentTarget;
    if (a !== els()[active] || fadingRef.current) return;
    if (!track || track.streamUrl || a.seeking) return;
    if (Date.now() - lastSwitchRef.current < STALL_GRACE_MS) return; // our own source swap
    const auto = loadQuality() === 'auto';
    const have = rungOf(a);
    const want = auto ? currentRung() : have; // what the ladder says before this event is scored
    // At the very start of a track, buffering is just buffering — never a stall. The only
    // reason to act here is a ladder that already dropped below what we asked for.
    const hasPlayed = a.played.length > 0 || a.currentTime > 0.5;
    if (!hasPlayed) {
      if (isLower(want, have)) restream(a, want);
      return;
    }
    // Mid-track, only a genuine rebuffer counts: playing, and out of decoded audio.
    // 'waiting' and 'stalled' also fire for a seek that outran the buffer, for a paused
    // element the browser stopped fetching for, and for the fetch going quiet while
    // plenty is still buffered.
    if (a.paused || a.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;
    let target = want;
    if (auto) {
      noteStall();
      target = currentRung();
    }
    // a raw file re-buffers on its own via byte ranges; a transcode never will
    if (!isLower(target, have) && have.bitrate === 0) return;
    restream(a, target);
  };

  // a failed request used to end the song then and there — the element just sits at the
  // point the network dropped. Pick it back up from there instead.
  const onError = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const a = e.currentTarget;
    if (a !== els()[active] || fadingRef.current) return;
    if (!track || track.streamUrl) return;
    // 4 = source/codec not supported: retrying that is just a loop
    if (a.error && a.error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) return;
    if (loadQuality() === 'auto') noteStall();
    restream(a, wantedRung(a));
  };

  // connection changed (wifi dropped to LTE, LTE degraded): only ever act on it
  // mid-track to go down — an upgrade waits for the next track rather than
  // reloading a song that is playing fine
  useEffect(() => {
    return onNetworkChange(() => {
      const a = els()[active];
      if (!a || loadQuality() !== 'auto' || fadingRef.current) return;
      const want = currentRung();
      if (isLower(want, rungOf(a))) restream(a, want);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, track?.id, isPlaying, volume]);

  /** Enough of the track heard? Then it goes on the record — once per play. */
  const maybeMarkPlayed = (t: Track) => {
    if (playedPostedRef.current || !isLibraryTrack(t)) return;
    const threshold = duration > 0 ? Math.min(duration / 2, PLAYED_CAP_S) : PLAYED_CAP_S;
    if (listenedRef.current < threshold) return;
    playedPostedRef.current = true;
    postHistory(t, 'played', startedAtRef.current);
  };

  const onTime = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const a = e.currentTarget;
    if (a !== els()[active]) return;
    const pos = offsetOf(a) + a.currentTime;
    setProgress(pos);
    updatePositionState(pos, duration);
    // count only continuous playback: a seek or a source swap jumps the clock and is skipped
    const last = lastPosRef.current;
    lastPosRef.current = pos;
    if (last != null) {
      const delta = pos - last;
      if (delta > 0 && delta <= MAX_LISTEN_DELTA_S) listenedRef.current += delta;
    }
    if (track) maybeMarkPlayed(track);
    const cf = crossfadeSec();
    if (
      cf > 0 &&
      !fadingRef.current &&
      nextTrack &&
      repeat !== 'one' &&
      duration > cf &&
      duration - pos <= cf
    ) {
      startFade(cf);
    }
  };

  const onDuration = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const a = e.currentTarget;
    if (a !== els()[active]) return;
    const d = a.duration;
    // live streams report Infinity; a transcode started at an offset reports only the
    // remainder (or nothing at all), so prefer the tagged length for library tracks
    const dur = track && !track.streamUrl && track.duration > 0 ? track.duration : Number.isFinite(d) ? d + offsetOf(a) : 0;
    setDuration(dur);
    updatePositionState(offsetOf(a) + a.currentTime, dur);
  };

  const onEnded = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const a = e.currentTarget;
    if (a !== els()[active] || fadingRef.current) return;
    // a transcode pipe that dies cleanly reads as end-of-stream: the song "ends" early.
    // If we're well short of the tagged length, pick the stream back up instead.
    if (track && !track.streamUrl && rungOf(a).bitrate > 0 && track.duration > 0) {
      const at = offsetOf(a) + a.currentTime;
      if (track.duration - at > 5 && restream(a, wantedRung(a))) return;
    }
    if (repeat === 'one') {
      // a replay is a fresh play as far as history and Last.fm are concerned
      resetPlayTracking();
      a.currentTime = 0;
      a.play().catch(() => {});
      if (track) markStarted(track);
      return;
    }
    const b = els()[1 - active];
    if (nextTrack && b && hasSrc(b, nextTrack)) {
      // gapless: preloaded element starts instantly
      b.volume = Math.min(1, volume * gainMult(nextTrack.gain));
      b.play().catch(() => {});
      a.removeAttribute('src');
      setActive(1 - active);
    }
    next();
  };

  const onPlayPause = (e: React.SyntheticEvent<HTMLAudioElement>, playing: boolean) => {
    if (e.currentTarget !== els()[active] || fadingRef.current) return;
    setPlaying(playing);
    // the first 'play' after a (re)load is when the track really starts for Last.fm
    if (playing && track) markStarted(track);
  };

  // sleep timer: pause when it fires
  useEffect(() => {
    if (!sleepUntil) return;
    const t = setInterval(() => {
      if (Date.now() >= sleepUntil) {
        setPlaying(false);
        setSleepUntil(null);
      }
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleepUntil]);

  const cycleSleep = () => {
    if (!sleepUntil) {
      setSleepUntil(Date.now() + SLEEP_STEPS[0] * 60000);
      return;
    }
    const remainMin = Math.ceil((sleepUntil - Date.now()) / 60000);
    const next = SLEEP_STEPS.find((m) => m > remainMin);
    setSleepUntil(next ? Date.now() + next * 60000 : null);
  };
  const sleepLabel = sleepUntil ? `${Math.max(1, Math.ceil((sleepUntil - Date.now()) / 60000))}m` : null;

  const seek = (v: number) => {
    const a = els()[active];
    if (!a) return;
    cancelFade();
    a.volume = Math.min(1, volume * gainMult(track?.gain));
    const rung = rungOf(a);
    if (track && !track.streamUrl && rung.bitrate > 0) {
      // transcodes are an unseekable pipe — restart it at the target second instead
      lastSwitchRef.current = Date.now();
      setSrc(a, track, rung, v);
      if (isPlaying) a.play().catch(() => {});
    } else {
      a.currentTime = v - offsetOf(a);
    }
    setProgress(v);
  };

  /** Play/pause from a click or key: the gesture is what lets the EQ's AudioContext run. */
  const onToggle = () => {
    resumeEq();
    toggle();
  };

  // keep the once-registered listeners (keyboard, media session) on the current render
  useEffect(() => {
    latest.current = { seek, progress, duration, volume, canSeek: !!track && !isStation };
  });

  // global keyboard shortcuts — one document listener, reading live state through `latest`
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const store = usePlayer.getState();
      const { seek, progress, duration, volume, canSeek } = latest.current;
      switch (e.key) {
        case ' ': {
          // a focused button takes Space itself (that is how keyboard users press it)
          if (e.target instanceof HTMLElement && e.target.tagName === 'BUTTON') return;
          e.preventDefault(); // Space would scroll the page
          if (e.repeat) return;
          resumeEq();
          store.toggle();
          break;
        }
        case 'ArrowRight':
        case 'ArrowLeft': {
          const forward = e.key === 'ArrowRight';
          if (e.shiftKey) {
            e.preventDefault();
            if (e.repeat) return;
            if (forward) store.next();
            else store.prev();
            break;
          }
          if (!canSeek) return;
          e.preventDefault();
          const target = forward ? progress + KEY_SEEK_S : progress - KEY_SEEK_S;
          seek(Math.max(0, duration > 0 ? Math.min(duration, target) : target));
          break;
        }
        case 'm':
        case 'M': {
          if (e.repeat) return;
          e.preventDefault();
          if (volume > 0) {
            mutedFromRef.current = volume;
            store.setVolume(0);
          } else {
            store.setVolume(mutedFromRef.current > 0 ? mutedFromRef.current : 1);
          }
          break;
        }
        case '/': {
          const box = document.querySelector<HTMLInputElement>('input[type="search"], input[placeholder*="Search"]');
          if (!box) return;
          e.preventDefault();
          box.focus();
          box.select();
          break;
        }
        default:
          break;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const pct = (n: number, d: number) => (d > 0 ? `${(n / d) * 100}%` : '0%');

  const audioProps = {
    onTimeUpdate: onTime,
    onDurationChange: onDuration,
    onEnded,
    onPlay: (e: React.SyntheticEvent<HTMLAudioElement>) => onPlayPause(e, true),
    onPause: (e: React.SyntheticEvent<HTMLAudioElement>) => onPlayPause(e, false),
    onWaiting,
    // 'stalled' is the fetch going quiet; onWaiting only acts on it once the decoder runs dry
    onStalled: onWaiting,
    onError,
  };

  return (
    <>
      <audio ref={audioARef} {...audioProps} />
      <audio ref={audioBRef} {...audioProps} />

      {showLyrics && track && (
        <div className="fixed inset-x-0 bottom-0 top-14 z-[80] overflow-y-auto bg-black/95 pb-64 md:bottom-20 md:left-64 md:top-0 md:z-30 md:pb-0">
          <div className="sticky top-0 flex items-center gap-3 bg-black/90 px-6 py-3 backdrop-blur">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/artwork/${track.albumId}`} alt="" className="h-10 w-10 rounded object-cover" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold">{track.title}</div>
              <div className="truncate text-sm text-subdued">{track.artist}</div>
            </div>
            <button onClick={() => setShowLyrics(false)} className="rounded-full p-2 text-subdued hover:text-white" aria-label="Close lyrics">✕</button>
          </div>
          <div className="mx-auto max-w-2xl">
            <Lyrics trackId={track.id} progress={progress} />
          </div>
        </div>
      )}

      {showQueue && (
        <>
          {/* tap anywhere outside to close */}
          <div className="fixed inset-0 z-[84] bg-black/40 md:z-40" onClick={() => setShowQueue(false)} aria-hidden />
          <div className="fixed inset-x-2 bottom-56 z-[85] max-h-[55vh] overflow-y-auto rounded-lg border border-highlight bg-elevated p-3 shadow-dialog md:inset-x-auto md:bottom-24 md:right-2 md:z-50 md:w-80">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-bold">Queue</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-subdued">drag to reorder</span>
                <button
                  onClick={() => setShowQueue(false)}
                  className="rounded-full p-1.5 text-subdued hover:text-white"
                  aria-label="Close queue"
                >
                  ✕
                </button>
              </div>
            </div>
          {queue.length === 0 && <div className="text-sm text-subdued">Nothing queued.</div>}
          {queue.map((t, i) => (
            <div
              key={`${t.id}-${i}`}
              draggable
              onDragStart={() => (dragFrom.current = i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom.current !== null) moveInQueue(dragFrom.current, i);
                dragFrom.current = null;
              }}
              className={`flex w-full cursor-grab items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-highlight active:cursor-grabbing ${i === index ? 'text-accent' : ''}`}
            >
              <button onClick={() => jumpTo(i)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/artwork/${t.albumId}`} alt="" className="h-9 w-9 rounded object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{t.title}</span>
                  <span className="block truncate text-xs text-subdued">{t.artist}</span>
                </span>
              </button>
              <div className="text-xs text-subdued">{fmtDuration(t.duration)}</div>
              {t.id > 0 && <AddToPlaylist track={t} className="rounded-full p-2 text-subdued hover:text-white" />}
            </div>
          ))}
          </div>
        </>
      )}

      <div className={`relative z-40 border-t border-highlight bg-black px-3 py-2 md:border-0 md:px-4 md:py-3 ${track ? '' : 'hidden md:block'}`}>
        {/* mobile: collapsed mini-player — tap to expand */}
        {track && !expanded && (
          <div
            className="relative flex items-center gap-3 overflow-hidden rounded-lg bg-elevated p-2 shadow-elevated md:hidden"
            onClick={() => setExpanded(true)}
            role="button"
            aria-label="Expand player"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/artwork/${track.albumId}`} alt="" className="h-10 w-10 rounded object-cover" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{track.title}</div>
              <div className="truncate text-xs text-subdued">{track.artist}</div>
            </div>
            {!isStation && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  likes.toggle(track.id);
                }}
                className={`rounded-full p-2 ${likes.ids.has(track.id) ? 'text-accent' : 'text-subdued'}`}
                aria-label={likes.ids.has(track.id) ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
              >
                <HeartIcon size={18} filled={likes.ids.has(track.id)} />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
            </button>
            {/* thin progress line along the bottom edge */}
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/20">
              <div className="h-full bg-white" style={{ width: pct(progress, duration) }} />
            </div>
          </div>
        )}

        {/* mobile: full-screen now playing */}
        {track && expanded && (
          <div className="fixed inset-x-0 top-0 bottom-14 z-[70] flex flex-col bg-gradient-to-b from-highlight to-base p-6 md:hidden">
            <div className="mb-4 flex items-center justify-between">
              <button
                onClick={() => setExpanded(false)}
                className="-ml-2 flex h-12 w-12 items-center justify-center rounded-full text-white active:bg-highlight"
                aria-label="Collapse player"
              >
                <ChevronDownIcon size={30} />
              </button>
              <span className="text-xs font-bold uppercase tracking-[0.1em] text-subdued">Now playing</span>
              <button
                onClick={() => setShowQueue((v) => !v)}
                className={`rounded-full p-2 ${showQueue ? 'text-accent' : 'text-subdued'}`}
                aria-label="Queue"
              >
                <QueueIcon size={20} />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/artwork/${track.albumId}`}
                alt=""
                className="max-h-full w-full max-w-[80vw] rounded-lg object-contain shadow-dialog"
              />
            </div>

            <div className="mt-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  {isStation ? (
                    <>
                      <div className="block truncate text-xl font-bold">{track.title}</div>
                      <div className="block truncate text-sm text-subdued">{track.artist}</div>
                    </>
                  ) : (
                    <>
                      <Link href={`/album/${track.albumId}`} onClick={() => setExpanded(false)} className="block truncate text-xl font-bold">
                        {track.title}
                      </Link>
                      <Link href={`/artist/${track.artistId}`} onClick={() => setExpanded(false)} className="block truncate text-sm text-subdued">
                        {track.artist}
                      </Link>
                    </>
                  )}
                </div>
                {!isStation && (
                  <button
                    onClick={() => likes.toggle(track.id)}
                    className={`rounded-full p-2 ${likes.ids.has(track.id) ? 'text-accent' : 'text-subdued'}`}
                    aria-label={likes.ids.has(track.id) ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
                  >
                    <HeartIcon size={22} filled={likes.ids.has(track.id)} />
                  </button>
                )}
                {!isStation && <AddToPlaylist track={track} size={22} className="rounded-full p-2 text-subdued" />}
              </div>

              {isStation ? (
                <div className="flex items-center justify-center gap-2 py-2 text-xs font-bold uppercase tracking-[0.1em] text-accent">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Live
                </div>
              ) : (
                <>
                  <input
                    type="range"
                    min={0}
                    max={duration || 1}
                    step={0.5}
                    value={progress}
                    onChange={(e) => seek(Number(e.target.value))}
                    className="w-full"
                    style={{ ['--fill' as string]: pct(progress, duration) }}
                    aria-label="Seek"
                  />
                  <div className="mt-1 flex justify-between text-xs tabular-nums text-subdued">
                    <span>{fmtDuration(progress)}</span>
                    <span>{fmtDuration(duration)}</span>
                  </div>
                </>
              )}

              <div className="mt-4 flex items-center justify-center gap-6">
                <button
                  onClick={toggleShuffle}
                  className={`rounded-full p-2 ${shuffle ? 'text-accent' : 'text-subdued'}`}
                  aria-label="Shuffle"
                  aria-pressed={shuffle}
                >
                  <ShuffleIcon size={22} />
                </button>
                <button onClick={prev} className="rounded-full p-2 text-white" aria-label="Previous track">
                  <PrevIcon size={28} />
                </button>
                <button
                  onClick={onToggle}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-black active:scale-95"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <PauseIcon size={28} /> : <PlayIcon size={28} />}
                </button>
                <button onClick={next} className="rounded-full p-2 text-white" aria-label="Next track">
                  <NextIcon size={28} />
                </button>
                <button
                  onClick={cycleRepeat}
                  className={`relative rounded-full p-2 ${repeat !== 'off' ? 'text-accent' : 'text-subdued'}`}
                  aria-label={`Repeat: ${repeat}`}
                >
                  <RepeatIcon size={22} />
                  {repeat === 'one' && <span className="absolute right-0 top-0 text-[9px] font-bold">1</span>}
                </button>
              </div>

              <div className="mt-4 flex items-center justify-center gap-8">
                <button
                  onClick={toggleRadio}
                  className={`rounded-full p-2 ${radio ? 'text-accent' : 'text-subdued'}`}
                  aria-label="Radio mode"
                  aria-pressed={radio}
                >
                  <RadioIcon size={20} />
                </button>
                <button
                  onClick={cycleSleep}
                  className={`relative rounded-full p-2 ${sleepUntil ? 'text-accent' : 'text-subdued'}`}
                  aria-label="Sleep timer"
                >
                  <MoonIcon size={20} />
                  {sleepLabel && <span className="absolute -right-0.5 -top-0.5 text-[9px] font-bold">{sleepLabel}</span>}
                </button>
                <button
                  onClick={() => setShowLyrics((v) => !v)}
                  className={`rounded-full p-2 ${showLyrics ? 'text-accent' : 'text-subdued'} disabled:opacity-40`}
                  aria-label="Lyrics"
                  disabled={isStation}
                >
                  <MicIcon size={20} />
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="hidden items-center gap-3 md:flex">
          {/* track info (desktop only) */}
          <div className="hidden min-w-0 items-center gap-3 md:flex md:w-[30%]">
            {track && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/artwork/${track.albumId}`} alt="" className="h-12 w-12 rounded object-cover" />
                <div className="min-w-0">
                  {isStation ? (
                    <>
                      <div className="block truncate text-sm font-medium">{track.title}</div>
                      <div className="block truncate text-xs text-subdued">{track.artist}</div>
                    </>
                  ) : (
                    <>
                      <Link href={`/album/${track.albumId}`} className="block truncate text-sm font-medium hover:underline">
                        {track.title}
                      </Link>
                      <Link href={`/artist/${track.artistId}`} className="block truncate text-xs text-subdued hover:text-white hover:underline">
                        {track.artist}
                      </Link>
                    </>
                  )}
                </div>
                {!isStation && (
                  <button
                    onClick={() => likes.toggle(track.id)}
                    className={`rounded-full p-2 ${likes.ids.has(track.id) ? 'text-accent' : 'text-subdued hover:text-white'}`}
                    title="Like"
                    aria-label={likes.ids.has(track.id) ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
                  >
                    <HeartIcon size={18} filled={likes.ids.has(track.id)} />
                  </button>
                )}
                {!isStation && <AddToPlaylist track={track} size={18} className="rounded-full p-2 text-subdued hover:text-white" />}
              </>
            )}
          </div>

          {/* controls */}
          <div className="flex flex-1 flex-col items-center gap-1">
            <div className="flex items-center gap-4">
              <button
                onClick={toggleShuffle}
                className={`rounded-full p-2 ${shuffle ? 'text-accent' : 'text-subdued hover:text-white'}`}
                title="Shuffle"
                aria-label="Shuffle"
                aria-pressed={shuffle}
              >
                <ShuffleIcon size={18} />
              </button>
              <button onClick={prev} className="rounded-full p-2 text-subdued hover:text-white" title="Previous" aria-label="Previous track">
                <PrevIcon size={20} />
              </button>
              <button
                onClick={onToggle}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-105 active:scale-95"
                title={isPlaying ? 'Pause' : 'Play'}
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
              </button>
              <button onClick={next} className="rounded-full p-2 text-subdued hover:text-white" title="Next" aria-label="Next track">
                <NextIcon size={20} />
              </button>
              <button
                onClick={cycleRepeat}
                className={`relative rounded-full p-2 ${repeat !== 'off' ? 'text-accent' : 'text-subdued hover:text-white'}`}
                title={`Repeat: ${repeat}`}
                aria-label={`Repeat: ${repeat}`}
              >
                <RepeatIcon size={18} />
                {repeat === 'one' && <span className="absolute right-0 top-0 text-[9px] font-bold">1</span>}
              </button>
            </div>
            <div className="hidden w-full max-w-xl items-center gap-2 md:flex">
              {isStation ? (
                <div className="flex flex-1 items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-accent">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> Live
                </div>
              ) : (
                <>
                  <span className="w-10 text-right text-xs tabular-nums text-subdued">{fmtDuration(progress)}</span>
                  <input
                    type="range"
                    min={0}
                    max={duration || 1}
                    step={0.5}
                    value={progress}
                    onChange={(e) => seek(Number(e.target.value))}
                    className="flex-1"
                    style={{ ['--fill' as string]: pct(progress, duration) }}
                    aria-label="Seek"
                  />
                  <span className="w-10 text-xs tabular-nums text-subdued">{fmtDuration(duration)}</span>
                </>
              )}
            </div>
          </div>

          {/* volume / queue */}
          <div className="hidden items-center justify-end gap-3 md:flex md:w-[30%]">
            <button
              onClick={cycleSleep}
              className={`relative rounded-full p-2 ${sleepUntil ? 'text-accent' : 'text-subdued hover:text-white'}`}
              title={sleepUntil ? `Sleep in ${sleepLabel} — click to extend/cancel` : 'Sleep timer'}
              aria-label="Sleep timer"
            >
              <MoonIcon size={18} />
              {sleepLabel && <span className="absolute -right-1 -top-1 text-[9px] font-bold">{sleepLabel}</span>}
            </button>
            <button
              onClick={toggleRadio}
              className={`rounded-full p-2 ${radio ? 'text-accent' : 'text-subdued hover:text-white'}`}
              title={radio ? 'Radio on — queue keeps going with similar songs' : 'Radio off'}
              aria-label="Radio mode"
              aria-pressed={radio}
            >
              <RadioIcon size={18} />
            </button>
            <button
              onClick={() => setShowLyrics((v) => !v)}
              className={`rounded-full p-2 ${showLyrics ? 'text-accent' : 'text-subdued hover:text-white'}`}
              title="Lyrics"
              aria-label="Lyrics"
              disabled={!track || isStation}
            >
              <MicIcon size={18} />
            </button>
            <button
              onClick={() => setShowQueue((v) => !v)}
              className={`rounded-full p-2 ${showQueue ? 'text-accent' : 'text-subdued hover:text-white'}`}
              title="Queue"
              aria-label="Queue"
            >
              <QueueIcon size={18} />
            </button>
            <VolumeIcon size={18} className="text-subdued" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-24"
              style={{ ['--fill' as string]: `${volume * 100}%` }}
              aria-label="Volume"
            />
          </div>
        </div>
      </div>
    </>
  );
}
