'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DjIcon, MicIcon, PauseIcon, PlayIcon, SendIcon, XIcon } from '@/components/Icons';
import { usePlayer } from '@/store/player';
import type { Track } from '@/lib/types';
import { seguesEnabled, setSeguesEnabled, setVoiceEnabled, speak, stopSpeaking, voiceEnabled } from '@/lib/client/djVoice';

interface Suggestion {
  title: string;
  artist: string;
  reason: string | null;
  cover: string | null;
  previewUrl: string | null;
  deezerUrl: string | null;
}

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  play?: Track[];
  queue?: Track[];
  playlist?: { id: number; name: string; added: number; missing: number };
  suggestions?: Suggestion[];
  error?: boolean;
}

interface Status {
  djName: string;
  ready: boolean;
  llm: { label: string; local: boolean; model: string };
  voice: string;
  voiceLocal: boolean;
  listen: boolean;
  listenLocal: boolean;
}

const QUICK = [
  'Start my DJ',
  'Something chill for late night',
  'Hype me up for a workout',
  'Make me a playlist of my forgotten favorites',
  'Suggest 5 songs I don’t have yet',
  'Tell me something cool about what’s playing',
];

const storeKey = (userId: number) => `dj-chat:${userId}`;

export default function DjPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  const [lidarr, setLidarr] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState(true);
  const [segues, setSegues] = useState(true);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [micError, setMicError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [got, setGot] = useState<Record<string, string>>({});
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const playDj = usePlayer((s) => s.playDj);
  const appendTracks = usePlayer((s) => s.appendTracks);

  useEffect(() => {
    setVoice(voiceEnabled());
    setSegues(seguesEnabled());
    fetch('/api/dj/status').then((r) => r.json()).then(setStatus).catch(() => {});
    fetch('/api/settings/lidarr').then((r) => r.json()).then((d) => setLidarr(Boolean(d.configured))).catch(() => {});
    fetch('/api/users')
      .then((r) => r.json())
      .then((d) => {
        const id = d.current?.id as number | undefined;
        if (!id) return;
        setUserId(id);
        try {
          const saved = JSON.parse(localStorage.getItem(storeKey(id)) ?? '[]');
          if (Array.isArray(saved)) setMessages(saved);
        } catch {
          // ignore a corrupt saved chat
        }
      })
      .catch(() => {});
    return () => {
      previewRef.current?.pause();
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    if (userId === null) return;
    try {
      localStorage.setItem(storeKey(userId), JSON.stringify(messages.slice(-40)));
    } catch {
      // storage full or blocked: chat still works for this visit
    }
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, userId]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busy) return;
      setInput('');
      const history: Msg[] = [...messages, { role: 'user', content }];
      setMessages(history);
      setBusy(true);
      const { queue, index } = usePlayer.getState();
      const now = queue[index];
      try {
        const res = await fetch('/api/dj/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // the DJ answers in JSON; showing it its own past lines in that shape keeps it consistent
            messages: history
              .filter((m) => !m.error)
              .map((m) => ({ role: m.role, content: m.role === 'assistant' ? JSON.stringify({ say: m.content }) : m.content })),
            nowPlaying: now && now.id > 0 ? { title: now.title, artist: now.artist } : null,
            upNext: queue.slice(index + 1, index + 6).map((t) => ({ title: t.title, artist: t.artist })),
            localTime: new Date().toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' }),
          }),
        });
        const d = await res.json();
        if (!res.ok) {
          setMessages((m) => [...m, { role: 'assistant', content: d.error ?? 'The DJ could not answer.', error: true }]);
          return;
        }
        const reply: Msg = { role: 'assistant', content: d.say, play: d.play, queue: d.queue, playlist: d.playlist, suggestions: d.suggestions };
        setMessages((m) => [...m, reply]);
        if (d.play?.length) playDj(d.play);
        if (d.queue?.length) appendTracks(d.queue);
        if (d.playlist) window.dispatchEvent(new Event('playlists-changed'));
        if (voiceEnabled()) speak(d.say);
      } catch {
        setMessages((m) => [...m, { role: 'assistant', content: 'Could not reach the server.', error: true }]);
      } finally {
        setBusy(false);
      }
    },
    [busy, messages, playDj, appendTracks]
  );

  const toggleRecord = async () => {
    setMicError('');
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError('The microphone needs HTTPS (or localhost) in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        if (blob.size < 1000) return;
        setTranscribing(true);
        const form = new FormData();
        form.append('audio', blob, 'speech');
        try {
          const res = await fetch('/api/dj/transcribe', { method: 'POST', body: form });
          const d = await res.json();
          if (!res.ok) setMicError(d.error ?? 'Could not understand the recording.');
          else if (d.text) send(d.text);
        } catch {
          setMicError('Could not reach the server.');
        } finally {
          setTranscribing(false);
        }
      };
      recorderRef.current = rec;
      stopSpeaking();
      rec.start();
      setRecording(true);
      // safety stop so a forgotten mic doesn't record forever
      setTimeout(() => rec.state === 'recording' && rec.stop(), 30_000);
    } catch {
      setMicError('Microphone access was blocked.');
    }
  };

  const togglePreview = (url: string) => {
    previewRef.current?.pause();
    if (previewUrl === url) {
      setPreviewUrl(null);
      return;
    }
    const a = new Audio(url);
    a.volume = 0.8;
    a.onended = () => setPreviewUrl(null);
    a.play().catch(() => setPreviewUrl(null));
    previewRef.current = a;
    setPreviewUrl(url);
  };

  const getIt = async (s: Suggestion) => {
    const k = `${s.artist}|${s.title}`;
    setGot((g) => ({ ...g, [k]: 'busy' }));
    const res = await fetch('/api/lidarr/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist: s.artist }),
    });
    const d = await res.json().catch(() => ({}));
    setGot((g) => ({ ...g, [k]: res.ok ? (d.status === 'requested' ? 'Requested' : 'Added to Lidarr') : `Failed: ${d.error ?? res.status}` }));
  };

  const clear = () => {
    stopSpeaking();
    setMessages([]);
  };

  const djName = status?.djName ?? 'DJ';
  const voiceAvailable = status && status.voice !== 'off';

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-12rem)] max-w-3xl flex-col">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-accent to-indigo-600 text-black">
          <DjIcon size={26} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{djName}</h1>
          {status && (
            <div className="truncate text-xs text-subdued">
              {status.ready ? `${status.llm.model} · ${status.llm.label}` : 'Not set up yet'}
              {status.ready && (status.llm.local ? ' · runs on your server' : ' · hosted provider')}
            </div>
          )}
        </div>
        {voiceAvailable && (
          <>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-subdued">
              <input
                type="checkbox"
                checked={voice}
                onChange={(e) => {
                  setVoice(e.target.checked);
                  setVoiceEnabled(e.target.checked);
                  if (!e.target.checked) stopSpeaking();
                }}
              />
              Voice
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-subdued" title="The DJ talks between songs of a DJ set">
              <input
                type="checkbox"
                checked={segues}
                disabled={!voice}
                onChange={(e) => {
                  setSegues(e.target.checked);
                  setSeguesEnabled(e.target.checked);
                }}
              />
              Talk between songs
            </label>
          </>
        )}
        {messages.length > 0 && (
          <button className="btn-pill px-3 py-1" onClick={clear}>
            Clear
          </button>
        )}
      </header>

      {status && !status.ready && (
        <div className="mb-4 rounded-lg bg-elevated p-4 text-sm text-subdued">
          The DJ needs a language model. The admin profile can pick one under{' '}
          <Link href="/settings#ai-dj" className="text-white underline">
            Settings → AI DJ
          </Link>{' '}
          (LM Studio or Ollama on your own server by default).
        </div>
      )}

      <div className="flex-1 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-5 py-10 text-center">
            <p className="max-w-md text-subdued">
              Your personal DJ knows your library and listening history. Ask for a vibe, a playlist, a deep dive on an artist, or songs you
              don’t own yet.
            </p>
            <button className="btn-primary px-8 py-3 text-base" onClick={() => send('Start my DJ')} disabled={busy || !status?.ready}>
              Start my DJ
            </button>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent/90 px-4 py-2 text-sm text-black">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="space-y-2">
              <div className={`max-w-[90%] rounded-2xl rounded-bl-sm px-4 py-2 text-sm ${m.error ? 'bg-negative/10 text-negative' : 'bg-elevated'}`}>
                {m.content}
                {!m.error && voiceAvailable && (
                  <button className="ml-2 align-middle text-subdued hover:text-white" onClick={() => speak(m.content)} title="Say it again" aria-label="Say it again">
                    <PlayIcon size={12} />
                  </button>
                )}
              </div>
              {m.play && m.play.length > 0 && <TrackCard title={`Playing ${m.play.length} song${m.play.length === 1 ? '' : 's'}`} tracks={m.play} onPlay={() => playDj(m.play!)} />}
              {m.queue && m.queue.length > 0 && <TrackCard title={`Queued ${m.queue.length} song${m.queue.length === 1 ? '' : 's'}`} tracks={m.queue} />}
              {m.playlist && (
                <Link href={`/playlist/${m.playlist.id}`} className="block max-w-[90%] rounded-lg bg-highlight px-4 py-3 text-sm hover:bg-press">
                  <div className="font-bold">New playlist: {m.playlist.name}</div>
                  <div className="text-xs text-subdued">
                    {m.playlist.added} songs from your library
                    {m.playlist.missing ? ` · ${m.playlist.missing} you don’t have yet (kept as placeholders)` : ''}
                  </div>
                </Link>
              )}
              {m.suggestions && m.suggestions.length > 0 && (
                <div className="grid max-w-[90%] gap-2 sm:grid-cols-2">
                  {m.suggestions.map((s) => {
                    const k = `${s.artist}|${s.title}`;
                    return (
                      <div key={k} className="flex gap-3 rounded-lg bg-highlight p-2">
                        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded bg-press">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {s.cover && <img src={s.cover} alt="" className="h-full w-full object-cover" />}
                          {s.previewUrl && (
                            <button
                              onClick={() => togglePreview(s.previewUrl!)}
                              className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-90 hover:opacity-100"
                              aria-label={previewUrl === s.previewUrl ? 'Stop preview' : 'Play preview'}
                            >
                              {previewUrl === s.previewUrl ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
                            </button>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">{s.title}</div>
                          <div className="truncate text-xs text-subdued">{s.artist}</div>
                          {s.reason && <div className="line-clamp-2 text-xs text-subdued">{s.reason}</div>}
                          <div className="mt-1 flex gap-2 text-xs">
                            {lidarr &&
                              (got[k] ? (
                                <span className="text-subdued">{got[k] === 'busy' ? 'Adding…' : got[k]}</span>
                              ) : (
                                <button className="text-accent hover:underline" onClick={() => getIt(s)}>
                                  Get this artist
                                </button>
                              ))}
                            {s.deezerUrl && (
                              <a href={s.deezerUrl} target="_blank" rel="noreferrer" className="text-subdued hover:text-white">
                                Deezer
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )
        )}
        {busy && <div className="animate-pulse text-sm text-subdued">{djName} is digging through the crates…</div>}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 mt-4 space-y-2 bg-gradient-to-t from-base via-base to-transparent pb-1 pt-4">
        {messages.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {QUICK.slice(1).map((q) => (
              <button key={q} className="shrink-0 rounded-full bg-highlight px-3 py-1 text-xs hover:bg-press" onClick={() => send(q)} disabled={busy || !status?.ready}>
                {q}
              </button>
            ))}
          </div>
        )}
        {micError && (
          <div className="flex items-center gap-2 rounded bg-negative/10 px-3 py-1.5 text-xs text-negative">
            <span className="flex-1">{micError}</span>
            <button onClick={() => setMicError('')} aria-label="Dismiss">
              <XIcon size={14} />
            </button>
          </div>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          {status?.listen && (
            <button
              type="button"
              onClick={toggleRecord}
              disabled={busy || transcribing || !status.ready}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${recording ? 'animate-pulse bg-negative text-black' : 'bg-highlight text-white hover:bg-press'}`}
              title={recording ? 'Stop and send' : `Talk to ${djName}`}
              aria-label={recording ? 'Stop recording' : 'Talk'}
            >
              <MicIcon size={18} />
            </button>
          )}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder={transcribing ? 'Listening back…' : `Ask ${djName} for anything…`}
            className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl bg-highlight px-4 py-2.5 text-sm text-white outline-none placeholder:text-subdued focus:shadow-insetBorder"
            disabled={!status?.ready}
          />
          <button
            type="submit"
            disabled={busy || !input.trim() || !status?.ready}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-black disabled:opacity-40"
            aria-label="Send"
          >
            <SendIcon size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}

function TrackCard({ title, tracks, onPlay }: { title: string; tracks: Track[]; onPlay?: () => void }) {
  const [open, setOpen] = useState(false);
  const shown = open ? tracks : tracks.slice(0, 5);
  return (
    <div className="max-w-[90%] rounded-lg bg-highlight p-3">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex-1 text-sm font-bold">{title}</div>
        {onPlay && (
          <button onClick={onPlay} className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-black" aria-label="Play again">
            <PlayIcon size={14} />
          </button>
        )}
      </div>
      <ol className="space-y-1">
        {shown.map((t, i) => (
          <li key={`${t.id}-${i}`} className="flex items-center gap-2 text-xs">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/artwork/${t.albumId}`} alt="" className="h-8 w-8 rounded object-cover" loading="lazy" />
            <div className="min-w-0">
              <div className="truncate font-semibold">{t.title}</div>
              <div className="truncate text-subdued">{t.artist}</div>
            </div>
          </li>
        ))}
      </ol>
      {tracks.length > 5 && (
        <button className="mt-2 text-xs text-subdued hover:text-white" onClick={() => setOpen(!open)}>
          {open ? 'Show less' : `Show all ${tracks.length}`}
        </button>
      )}
    </div>
  );
}
