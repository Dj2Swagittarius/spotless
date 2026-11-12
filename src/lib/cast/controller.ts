import type { DeviceEvent, DeviceInfo, PlaybackSnapshot, RemoteCommand, Repeat } from '../devices';
import type { Track } from '../types';
import type { CastSession, LoadRequest, MediaStatus, SessionOpener } from './client';

/**
 * One Chromecast as a "Play on" device. While a user plays on it, the server is the player: it holds
 * the queue, loads each song on the receiver, moves on when one finishes, and reports its state the
 * way a page would. Pages are all remotes then, and their commands land here.
 *
 * The receiver only ever has the current song; the queue, shuffle, repeat and radio live here.
 */

export interface CastTarget {
  info: DeviceInfo;
  host: string;
  port: number;
}

/** What the controller needs from the rest of the server; injected so tests can fake it. */
export interface CastHost {
  open: SessionOpener;
  /** LOAD request for a track, URLs pointing back at this server */
  loadFor: (
    userId: number,
    base: string,
    track: Track,
    opts: { startAt: number; autoplay: boolean; transcode: boolean }
  ) => LoadRequest & { transcoded: boolean };
  report: (userId: number, deviceId: string, patch: Partial<PlaybackSnapshot>) => void;
  stopped: (userId: number, deviceId: string) => void;
  /** more tracks for radio mode, similar to `seed` */
  radioTracks: (seed: Track, exclude: number[]) => Track[];
  /** the origin a receiver can reach this server at, from what the user's page used */
  baseUrl: (userId: number) => string | null;
  log: (msg: string) => void;
}

// While playing, ask for the receiver's position this often so remotes stay in step.
const POLL_MS = 5000;

interface Session {
  userId: number;
  cast: CastSession;
  base: string;
}

function shuffleUpcoming(queue: Track[], index: number): Track[] {
  const head = queue.slice(0, index + 1);
  const rest = queue.slice(index + 1);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return head.concat(rest);
}

export class CastController {
  readonly target: CastTarget;
  private host: CastHost;
  private session: Session | null = null;
  private connecting: Promise<Session | null> | null = null;
  /** bumps on every load/stop so a slow, superseded LOAD can't act on its result */
  private generation = 0;
  private poll: ReturnType<typeof setInterval> | null = null;

  // the player state (same shape as the web player's store)
  queue: Track[] = [];
  originalQueue: Track[] = [];
  index = -1;
  isPlaying = false;
  shuffle = false;
  repeat: Repeat = 'off';
  volume = 1;
  radio = false;
  /** receiver position at `positionAt`, plus where a transcoded stream started */
  position = 0;
  positionAt = 0;
  private offset = 0;
  private transcoded = false;
  private triedTranscode = false;
  /** content id of the song we last asked the receiver for */
  private contentId: string | null = null;

  constructor(target: CastTarget, host: CastHost) {
    this.target = target;
    this.host = host;
  }

  /** The user this receiver currently plays for. */
  get owner(): number | null {
    return this.session?.userId ?? null;
  }

  private current(): Track | undefined {
    return this.index >= 0 ? this.queue[this.index] : undefined;
  }

  private now(): number {
    return this.position + (this.isPlaying ? (Date.now() - this.positionAt) / 1000 : 0);
  }

  private snapshot(withQueue: boolean): Partial<PlaybackSnapshot> {
    return {
      ...(withQueue ? { queue: this.queue } : {}),
      index: this.index,
      isPlaying: this.isPlaying,
      shuffle: this.shuffle,
      repeat: this.repeat,
      volume: this.volume,
      radio: this.radio,
      position: this.now(),
    };
  }

  private report(withQueue = false) {
    if (this.session) this.host.report(this.session.userId, this.target.info.id, this.snapshot(withQueue));
  }

  /** Entry point: an event the devices hub sends this receiver on behalf of `userId`. */
  deliver(userId: number, e: DeviceEvent): void {
    switch (e.type) {
      case 'activate':
        void this.activate(userId, e.state, e.play);
        return;
      case 'command':
        if (this.session?.userId === userId) void this.command(e.cmd);
        return;
      case 'release':
        if (this.session?.userId === userId) void this.release();
        return;
    }
  }

  private async ensureSession(userId: number): Promise<Session | null> {
    if (this.session && this.session.userId !== userId) {
      // someone else in the house takes the TV over
      const prev = this.session.userId;
      this.endSession(false);
      this.host.stopped(prev, this.target.info.id);
    }
    if (this.session) return this.session;
    if (this.connecting) return this.connecting;
    const base = this.host.baseUrl(userId);
    if (!base) {
      this.host.log(`cast: no address the receiver could reach this server at; set CAST_BASE_URL`);
      return null;
    }
    this.connecting = (async () => {
      try {
        const cast = await this.host.open(this.target.host, this.target.port);
        const session: Session = { userId, cast, base };
        this.session = session;
        cast.onStatus((s) => {
          if (this.session === session) this.onStatus(s);
        });
        cast.onEnded((reason) => {
          if (this.session !== session) return;
          this.host.log(`cast: ${this.target.info.name}: session ended (${reason})`);
          this.endSession(false);
          this.host.stopped(userId, this.target.info.id);
        });
        return session;
      } catch (err) {
        this.host.log(
          `cast: could not connect to ${this.target.info.name} (${this.target.host}): ${(err as Error).message}`
        );
        return null;
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  private endSession(stopApp: boolean) {
    const s = this.session;
    this.session = null;
    this.generation++;
    this.isPlaying = false;
    this.contentId = null;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    if (s) void (stopApp ? s.cast.stop() : Promise.resolve(s.cast.close()));
  }

  private async activate(userId: number, state: PlaybackSnapshot | null, play: boolean) {
    const session = await this.ensureSession(userId);
    if (!session) {
      this.host.stopped(userId, this.target.info.id);
      return;
    }
    if (state?.queue) {
      this.queue = state.queue;
      this.originalQueue = state.queue.slice();
      this.index = state.index >= 0 && state.index < state.queue.length ? state.index : state.queue.length ? 0 : -1;
      this.shuffle = state.shuffle;
      this.repeat = state.repeat;
      this.radio = state.radio;
    }
    // the TV keeps its own volume: show it instead of blasting it to the phone's level
    const level = session.cast.volume();
    if (level !== null) this.volume = level;
    this.position = state?.position ?? 0;
    this.positionAt = Date.now();
    this.isPlaying = play && this.index >= 0;
    this.report(true);
    if (this.index >= 0) await this.loadCurrent(state?.position ?? 0, this.isPlaying);
  }

  private async release() {
    // playback moved to another device: free the TV
    this.endSession(true);
  }

  /** Stop casting entirely (receiver removed, server shutting down). */
  shutdown() {
    const owner = this.owner;
    this.endSession(true);
    if (owner !== null) this.host.stopped(owner, this.target.info.id);
  }

  private async loadCurrent(startAt: number, autoplay: boolean, transcode = false) {
    const s = this.session;
    const track = this.current();
    if (!s || !track) return;
    const gen = ++this.generation;
    if (!transcode) this.triedTranscode = false;
    const req = this.host.loadFor(s.userId, s.base, track, { startAt, autoplay, transcode });
    this.transcoded = req.transcoded;
    this.offset = req.transcoded ? startAt : 0;
    this.contentId = req.url;
    this.position = startAt;
    this.positionAt = Date.now();
    this.topUpRadio();
    try {
      const st = await s.cast.load(req);
      if (gen !== this.generation) return;
      this.onStatus(st);
    } catch (err) {
      if (gen !== this.generation || this.session !== s) return;
      this.host.log(`cast: ${this.target.info.name}: "${track.title}" failed to load: ${(err as Error).message}`);
      this.onLoadError();
    }
  }

  private onLoadError() {
    const track = this.current();
    // the receiver can't decode this file (ALAC in .m4a, say): try once more as MP3
    if (track && !track.streamUrl && !this.transcoded && !this.triedTranscode) {
      this.triedTranscode = true;
      void this.loadCurrent(this.position, this.isPlaying, true);
      return;
    }
    this.advance(true);
  }

  private onStatus(st: MediaStatus) {
    // a status for the song before the one we just asked for is stale
    if (st.contentId && this.contentId && st.contentId !== this.contentId) return;
    this.position = this.offset + st.currentTime;
    this.positionAt = Date.now();
    if (st.playerState === 'PLAYING' || st.playerState === 'BUFFERING') {
      this.setPlaying(true);
    } else if (st.playerState === 'PAUSED') {
      this.setPlaying(false);
    } else if (st.playerState === 'IDLE') {
      if (st.idleReason === 'FINISHED') return this.advance(false);
      if (st.idleReason === 'ERROR') return this.onLoadError();
      // stopped from the TV remote or Google Home
      if (st.idleReason === 'CANCELLED') this.setPlaying(false);
    }
    this.report();
  }

  private setPlaying(playing: boolean) {
    this.isPlaying = playing;
    if (playing && !this.poll) {
      this.poll = setInterval(() => {
        void this.session?.cast.requestStatus().catch(() => {});
      }, POLL_MS);
    } else if (!playing && this.poll) {
      clearInterval(this.poll);
      this.poll = null;
    }
  }

  /** The current song ended (or could not play): on to the next, as the web player's store does. */
  private advance(skipOnRepeatOne: boolean) {
    if (this.queue.length === 0) return;
    if (this.repeat === 'one' && !skipOnRepeatOne) {
      void this.loadCurrent(0, true);
    } else if (this.index + 1 < this.queue.length) {
      this.index++;
      void this.loadCurrent(0, true);
    } else if (this.repeat === 'all') {
      if (this.shuffle && this.queue.length > 1) {
        const finished = this.queue[this.index];
        const next = shuffleUpcoming(this.queue, -1);
        if (next[0] === finished) {
          const j = 1 + Math.floor(Math.random() * (next.length - 1));
          [next[0], next[j]] = [next[j], next[0]];
        }
        this.queue = next;
      }
      this.index = 0;
      this.report(true);
      void this.loadCurrent(0, true);
    } else {
      // the queue ran out: the receiver is idle, so play starts the last song over
      this.setPlaying(false);
      this.contentId = null;
      this.position = 0;
      this.positionAt = Date.now();
    }
    this.report();
  }

  /** Radio keeps the queue going: when the last song starts, similar ones are added behind it. */
  private topUpRadio() {
    const track = this.current();
    if (!this.radio || !track || track.streamUrl || this.index !== this.queue.length - 1) return;
    const more = this.host.radioTracks(
      track,
      this.queue.slice(-200).map((t) => t.id)
    );
    if (more.length === 0) return;
    this.queue = [...this.queue, ...more];
    this.originalQueue = [...this.originalQueue, ...more];
    this.report(true);
  }

  private async command(cmd: RemoteCommand) {
    const s = this.session;
    if (!s) return;
    switch (cmd.type) {
      case 'seek': {
        const track = this.current();
        if (!track || track.streamUrl) return;
        this.position = cmd.position;
        this.positionAt = Date.now();
        // a transcoded stream can't seek: it starts over from the new spot instead
        if (this.transcoded) await this.loadCurrent(cmd.position, this.isPlaying, true);
        else await s.cast.seek(cmd.position).catch(() => {});
        this.report();
        return;
      }
      case 'toggleShuffle': {
        this.shuffle = !this.shuffle;
        if (this.shuffle) {
          this.originalQueue = this.queue.slice();
          if (this.index >= 0) this.queue = shuffleUpcoming(this.queue, this.index);
        } else if (this.originalQueue.length === this.queue.length) {
          const cur = this.current();
          const i = cur ? this.originalQueue.indexOf(cur) : -1;
          if (!cur || i >= 0) {
            this.queue = this.originalQueue;
            this.index = cur ? i : this.index;
          }
        }
        this.report(true);
        return;
      }
      case 'sync': {
        const p = cmd.patch;
        const before = this.current();
        const beforeIndex = this.index;
        if (p.queue) {
          this.queue = p.queue;
          this.originalQueue = p.queue.slice();
        }
        if (p.index !== undefined && p.index >= -1 && p.index < this.queue.length) this.index = p.index;
        if (this.index >= this.queue.length) this.index = this.queue.length - 1;
        if (p.repeat !== undefined) this.repeat = p.repeat;
        if (p.radio !== undefined) this.radio = p.radio;
        if (p.volume !== undefined && p.volume !== this.volume) {
          this.volume = p.volume;
          void s.cast.setVolume(p.volume).catch(() => {});
        }
        const track = this.current();
        const trackChanged = track?.id !== before?.id || this.index !== beforeIndex;
        const wantPlaying = p.isPlaying !== undefined ? p.isPlaying && this.index >= 0 : this.isPlaying;
        if (trackChanged) {
          this.isPlaying = wantPlaying;
          this.report(!!p.queue);
          if (track) await this.loadCurrent(0, wantPlaying);
          return;
        }
        if (wantPlaying !== this.isPlaying) {
          this.position = this.now();
          this.positionAt = Date.now();
          this.setPlaying(wantPlaying);
          if (wantPlaying) {
            // after the queue ran out the receiver is idle: start the song again
            if (this.contentId === null) await this.loadCurrent(0, true);
            else await s.cast.play().catch(() => {});
          } else await s.cast.pause().catch(() => {});
        }
        this.report(!!p.queue);
        return;
      }
    }
  }
}
