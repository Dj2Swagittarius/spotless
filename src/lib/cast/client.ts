import tls from 'tls';
import { DEFAULT_MEDIA_RECEIVER, encodeMessage, MessageReader, NS, type CastMessage } from './protocol';

/**
 * A connection to one cast receiver, running Google's Default Media Receiver. Covers what Spotless
 * needs from the protocol: launch (or join) the receiver app, load a URL with metadata, play, pause,
 * seek, volume, and hear about status changes and the session ending.
 */

export type PlayerState = 'IDLE' | 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'LOADING';
export type IdleReason = 'FINISHED' | 'CANCELLED' | 'INTERRUPTED' | 'ERROR';

export interface MediaStatus {
  mediaSessionId: number;
  playerState: PlayerState;
  idleReason?: IdleReason;
  currentTime: number;
  contentId?: string;
}

export interface LoadRequest {
  url: string;
  contentType: string;
  live: boolean;
  title: string;
  artist: string;
  album: string;
  imageUrl?: string;
  duration?: number;
  startAt: number;
  autoplay: boolean;
}

/** What the controller drives; the real one talks to a receiver, tests use a fake. */
export interface CastSession {
  load(req: LoadRequest): Promise<MediaStatus>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(seconds: number): Promise<void>;
  setVolume(level: number): Promise<void>;
  /** the receiver's volume (0..1) as last reported */
  volume(): number | null;
  requestStatus(): Promise<void>;
  /** stop the receiver app (the TV goes back to its idle screen) and disconnect */
  stop(): Promise<void>;
  /** disconnect without stopping the app */
  close(): void;
  onStatus(cb: (s: MediaStatus) => void): void;
  /** the session is over: socket dropped, or another app/sender took the receiver */
  onEnded(cb: (reason: string) => void): void;
}

export type SessionOpener = (host: string, port: number) => Promise<CastSession>;

const SENDER = 'sender-spotless';
const RECEIVER = 'receiver-0';
const HEARTBEAT_MS = 5000;
// No traffic at all (not even a PONG) for this long means the receiver is gone.
const SILENCE_MS = 16_000;
const REQUEST_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 6000;

class RequestError extends Error {}

export const openCastSession: SessionOpener = (host, port) =>
  new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, rejectUnauthorized: false, timeout: CONNECT_TIMEOUT_MS });
    const reader = new MessageReader();
    const pending = new Map<
      number,
      { resolve: (d: Record<string, unknown>) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
    >();
    let nextId = 1;
    let lastHeard = Date.now();
    let heartbeat: NodeJS.Timeout | null = null;
    let ended = false;
    let transportId: string | null = null;
    let appSessionId: string | null = null;
    let mediaSessionId: number | null = null;
    let volume: number | null = null;
    const statusListeners: ((s: MediaStatus) => void)[] = [];
    const endListeners: ((reason: string) => void)[] = [];

    const send = (namespace: string, destinationId: string, payload: Record<string, unknown>) => {
      if (ended) return;
      socket.write(encodeMessage({ sourceId: SENDER, destinationId, namespace, data: JSON.stringify(payload) }));
    };

    const request = (namespace: string, destinationId: string, payload: Record<string, unknown>) =>
      new Promise<Record<string, unknown>>((res, rej) => {
        if (ended) return rej(new RequestError('cast session closed'));
        const requestId = nextId++;
        const timer = setTimeout(() => {
          pending.delete(requestId);
          rej(new RequestError(`cast ${String(payload.type)} timed out`));
        }, REQUEST_TIMEOUT_MS);
        pending.set(requestId, { resolve: res, reject: rej, timer });
        send(namespace, destinationId, { ...payload, requestId });
      });

    const end = (reason: string) => {
      if (ended) return;
      ended = true;
      if (heartbeat) clearInterval(heartbeat);
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new RequestError(reason));
      }
      pending.clear();
      socket.destroy();
      for (const cb of endListeners) cb(reason);
    };

    const readStatus = (d: Record<string, unknown>) => {
      const list = Array.isArray(d.status) ? (d.status as Record<string, unknown>[]) : [];
      const s = list[0];
      if (!s) return null;
      mediaSessionId = typeof s.mediaSessionId === 'number' ? s.mediaSessionId : mediaSessionId;
      const media = s.media as { contentId?: string } | undefined;
      const status: MediaStatus = {
        mediaSessionId: mediaSessionId ?? 0,
        playerState: (s.playerState as PlayerState) ?? 'IDLE',
        idleReason: s.idleReason as IdleReason | undefined,
        currentTime: typeof s.currentTime === 'number' ? s.currentTime : 0,
        contentId: media?.contentId,
      };
      return status;
    };

    const onReceiverStatus = (d: Record<string, unknown>) => {
      const status = d.status as
        | { applications?: { appId: string; sessionId: string; transportId: string }[]; volume?: { level?: number } }
        | undefined;
      if (typeof status?.volume?.level === 'number') volume = status.volume.level;
      if (appSessionId && status?.applications && !status.applications.some((a) => a.sessionId === appSessionId)) {
        end('another app took over the receiver');
      }
    };

    const onMessage = (m: CastMessage) => {
      lastHeard = Date.now();
      let d: Record<string, unknown>;
      try {
        d = JSON.parse(m.data) as Record<string, unknown>;
      } catch {
        return;
      }
      if (m.namespace === NS.heartbeat) {
        if (d.type === 'PING') send(NS.heartbeat, m.sourceId, { type: 'PONG' });
        return;
      }
      if (m.namespace === NS.connection && d.type === 'CLOSE') {
        if (m.sourceId === RECEIVER || m.sourceId === transportId) end('receiver closed the connection');
        return;
      }
      if (m.namespace === NS.receiver && d.type === 'RECEIVER_STATUS') onReceiverStatus(d);
      if (m.namespace === NS.media && d.type === 'MEDIA_STATUS') {
        const st = readStatus(d);
        if (st) for (const cb of statusListeners) cb(st);
      }
      const id = typeof d.requestId === 'number' ? d.requestId : 0;
      const p = id ? pending.get(id) : undefined;
      if (p) {
        pending.delete(id);
        clearTimeout(p.timer);
        if (
          d.type === 'LOAD_FAILED' ||
          d.type === 'LOAD_CANCELLED' ||
          d.type === 'INVALID_REQUEST' ||
          d.type === 'LAUNCH_ERROR'
        ) {
          p.reject(new RequestError(`cast ${String(d.type)}${d.reason ? ` (${String(d.reason)})` : ''}`));
        } else p.resolve(d);
      }
    };

    socket.on('data', (chunk: Buffer) => {
      try {
        for (const m of reader.push(chunk)) onMessage(m);
      } catch (err) {
        end(`bad data from receiver: ${(err as Error).message}`);
      }
    });
    socket.on('error', (err) => {
      if (!appSessionId) reject(err);
      end(err.message);
    });
    socket.on('timeout', () => {
      if (!appSessionId) {
        reject(new Error(`no answer from ${host}:${port}`));
        end('connect timeout');
      }
    });
    socket.on('close', () => end('connection closed'));

    const media = (payload: Record<string, unknown>) => {
      if (!transportId) return Promise.reject(new RequestError('no receiver app'));
      return request(NS.media, transportId, payload);
    };
    const mediaCommand = async (payload: Record<string, unknown>) => {
      if (mediaSessionId === null) return;
      await media({ ...payload, mediaSessionId });
    };

    const session: CastSession = {
      async load(req) {
        const metadata: Record<string, unknown> = {
          metadataType: 3, // MusicTrackMediaMetadata
          title: req.title,
          artist: req.artist,
          albumName: req.album,
        };
        if (req.imageUrl) metadata.images = [{ url: req.imageUrl }];
        const d = await media({
          type: 'LOAD',
          autoplay: req.autoplay,
          currentTime: req.startAt,
          media: {
            contentId: req.url,
            contentUrl: req.url,
            contentType: req.contentType,
            streamType: req.live ? 'LIVE' : 'BUFFERED',
            ...(req.duration && !req.live ? { duration: req.duration } : {}),
            metadata,
          },
        });
        const st = readStatus(d);
        if (!st) throw new RequestError('cast LOAD returned no status');
        return st;
      },
      play: () => mediaCommand({ type: 'PLAY' }),
      pause: () => mediaCommand({ type: 'PAUSE' }),
      seek: (seconds) => mediaCommand({ type: 'SEEK', currentTime: seconds }),
      async setVolume(level) {
        volume = level;
        await request(NS.receiver, RECEIVER, { type: 'SET_VOLUME', volume: { level } });
      },
      volume: () => volume,
      async requestStatus() {
        if (transportId) await media({ type: 'GET_STATUS' });
      },
      async stop() {
        try {
          if (appSessionId) await request(NS.receiver, RECEIVER, { type: 'STOP', sessionId: appSessionId });
        } catch {
          // closing anyway
        }
        end('stopped');
      },
      close: () => end('closed'),
      onStatus: (cb) => statusListeners.push(cb),
      onEnded: (cb) => endListeners.push(cb),
    };

    socket.once('secureConnect', async () => {
      socket.setTimeout(0);
      send(NS.connection, RECEIVER, { type: 'CONNECT' });
      heartbeat = setInterval(() => {
        if (Date.now() - lastHeard > SILENCE_MS) return end('receiver stopped answering');
        send(NS.heartbeat, RECEIVER, { type: 'PING' });
      }, HEARTBEAT_MS);
      try {
        let status = await request(NS.receiver, RECEIVER, { type: 'GET_STATUS' });
        type App = { appId: string; sessionId: string; transportId: string };
        const findApp = (d: Record<string, unknown>) =>
          ((d.status as { applications?: App[] } | undefined)?.applications ?? []).find(
            (a) => a.appId === DEFAULT_MEDIA_RECEIVER
          );
        onReceiverStatus({ status: status.status });
        let app = findApp(status);
        if (!app) {
          status = await request(NS.receiver, RECEIVER, { type: 'LAUNCH', appId: DEFAULT_MEDIA_RECEIVER });
          app = findApp(status);
          // some receivers answer LAUNCH before the app is up; the next status has it
          for (let i = 0; !app && i < 10; i++) {
            await new Promise((r) => setTimeout(r, 500));
            app = findApp(await request(NS.receiver, RECEIVER, { type: 'GET_STATUS' }));
          }
          if (!app) throw new RequestError('the receiver did not start the media app');
        }
        transportId = app.transportId;
        appSessionId = app.sessionId;
        send(NS.connection, transportId, { type: 'CONNECT' });
        resolve(session);
      } catch (err) {
        reject(err);
        end((err as Error).message);
      }
    });
  });
