'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePlayer } from '@/store/player';
import { useLikes } from '@/store/likes';
import { fmtDuration } from '@/lib/format';
import Lyrics from './Lyrics';
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

export default function Player() {
  const audioARef = useRef<HTMLAudioElement>(null);
  const audioBRef = useRef<HTMLAudioElement>(null);
  const [active, setActive] = useState(0);
  const fadingRef = useRef(false);
  const fadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const radioFetchingRef = useRef(false);

  const { queue, index, isPlaying, shuffle, repeat, volume, radio } = usePlayer();
  const { toggle, next, prev, jumpTo, toggleShuffle, cycleRepeat, setVolume, setPlaying, toggleRadio, appendTracks, moveInQueue } =
    usePlayer();
  const likes = useLikes();
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
  const nextIndex = index + 1 < queue.length ? index + 1 : repeat === 'all' && queue.length > 0 ? 0 : -1;
  const nextTrack = nextIndex >= 0 ? queue[nextIndex] : null;

  const els = () => [audioARef.current, audioBRef.current] as const;
  const streamPath = (id: number) => `/api/stream/${id}`;
  const hasSrc = (a: HTMLAudioElement | null, id: number) => !!a && a.src.includes(streamPath(id));

  // navigating anywhere closes the full-screen player and popups
  useEffect(() => {
    setExpanded(false);
    setShowLyrics(false);
    setShowQueue(false);
  }, [pathname]);

  const cancelFade = () => {
    if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
    fadeTimerRef.current = null;
    fadingRef.current = false;
  };

  // load current track into the active element (skip when a fade already put it there)
  useEffect(() => {
    const a = els()[active];
    if (!a || !track) return;
    if (!hasSrc(a, track.id)) {
      cancelFade();
      const other = els()[1 - active];
      if (other) {
        other.pause();
        other.removeAttribute('src');
      }
      a.src = streamPath(track.id);
      a.volume = Math.min(1, volume * gainMult(track.gain));
      a.play().catch(() => {});
      setProgress(0);
    }
    fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId: track.id }),
    }).catch(() => {});
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
  useEffect(() => {
    const other = els()[1 - active];
    if (!other || fadingRef.current) return;
    if (nextTrack && !hasSrc(other, nextTrack.id)) {
      other.preload = 'auto';
      other.src = streamPath(nextTrack.id);
      other.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextTrack?.id, active]);

  // radio: when the last queued track starts, top the queue up in advance
  useEffect(() => {
    if (!radio || !track || index !== queue.length - 1 || radioFetchingRef.current) return;
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

  // play/pause sync on the active element
  useEffect(() => {
    const a = els()[active];
    if (!a || !track) return;
    if (isPlaying) a.play().catch(() => {});
    else a.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, active]);

  useEffect(() => {
    const a = els()[active];
    if (a && !fadingRef.current) a.volume = Math.min(1, volume * gainMult(track?.gain));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume, active]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', () => setPlaying(true));
    navigator.mediaSession.setActionHandler('pause', () => setPlaying(false));
    navigator.mediaSession.setActionHandler('nexttrack', next);
    navigator.mediaSession.setActionHandler('previoustrack', prev);
  }, [next, prev, setPlaying]);

  const startFade = (cf: number) => {
    const a = els()[active];
    const b = els()[1 - active];
    if (!a || !b || !nextTrack) return;
    if (!hasSrc(b, nextTrack.id)) b.src = streamPath(nextTrack.id);
    fadingRef.current = true;
    b.volume = 0;
    b.play().catch(() => {
      cancelFade();
    });
    let t = 0;
    fadeTimerRef.current = setInterval(() => {
      t += 0.1;
      const k = Math.min(1, t / cf);
      b.volume = Math.min(1, volume * gainMult(nextTrack?.gain)) * k;
      a.volume = Math.min(1, volume * gainMult(track?.gain)) * (1 - k);
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

  const onTime = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const a = e.currentTarget;
    if (a !== els()[active]) return;
    setProgress(a.currentTime);
    const cf = crossfadeSec();
    if (
      cf > 0 &&
      !fadingRef.current &&
      nextTrack &&
      repeat !== 'one' &&
      a.duration > cf &&
      a.duration - a.currentTime <= cf
    ) {
      startFade(cf);
    }
  };

  const onDuration = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    if (e.currentTarget !== els()[active]) return;
    setDuration(e.currentTarget.duration || 0);
  };

  const onEnded = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const a = e.currentTarget;
    if (a !== els()[active] || fadingRef.current) return;
    if (repeat === 'one') {
      a.currentTime = 0;
      a.play().catch(() => {});
      return;
    }
    const b = els()[1 - active];
    if (nextTrack && b && hasSrc(b, nextTrack.id)) {
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
    a.currentTime = v;
    setProgress(v);
  };

  const pct = (n: number, d: number) => (d > 0 ? `${(n / d) * 100}%` : '0%');

  const audioProps = {
    onTimeUpdate: onTime,
    onDurationChange: onDuration,
    onEnded,
    onPlay: (e: React.SyntheticEvent<HTMLAudioElement>) => onPlayPause(e, true),
    onPause: (e: React.SyntheticEvent<HTMLAudioElement>) => onPlayPause(e, false),
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
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggle();
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
                  <Link href={`/album/${track.albumId}`} onClick={() => setExpanded(false)} className="block truncate text-xl font-bold">
                    {track.title}
                  </Link>
                  <Link href={`/artist/${track.artistId}`} onClick={() => setExpanded(false)} className="block truncate text-sm text-subdued">
                    {track.artist}
                  </Link>
                </div>
                <button
                  onClick={() => likes.toggle(track.id)}
                  className={`rounded-full p-2 ${likes.ids.has(track.id) ? 'text-accent' : 'text-subdued'}`}
                  aria-label={likes.ids.has(track.id) ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
                >
                  <HeartIcon size={22} filled={likes.ids.has(track.id)} />
                </button>
              </div>

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
                  onClick={toggle}
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
                  className={`rounded-full p-2 ${showLyrics ? 'text-accent' : 'text-subdued'}`}
                  aria-label="Lyrics"
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
                  <Link href={`/album/${track.albumId}`} className="block truncate text-sm font-medium hover:underline">
                    {track.title}
                  </Link>
                  <Link href={`/artist/${track.artistId}`} className="block truncate text-xs text-subdued hover:text-white hover:underline">
                    {track.artist}
                  </Link>
                </div>
                <button
                  onClick={() => likes.toggle(track.id)}
                  className={`rounded-full p-2 ${likes.ids.has(track.id) ? 'text-accent' : 'text-subdued hover:text-white'}`}
                  title="Like"
                  aria-label={likes.ids.has(track.id) ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
                >
                  <HeartIcon size={18} filled={likes.ids.has(track.id)} />
                </button>
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
                onClick={toggle}
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
              disabled={!track}
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
