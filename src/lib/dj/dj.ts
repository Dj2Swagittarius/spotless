import { getDb } from '../db';
import { nextPosition } from '../playlistMatch';
import type { Track } from '../types';
import { getDjConfig } from './config';
import { complete, type ChatMessage } from './llm';
import { artistTracks, buildIndex, buildListenerProfile, genreTracks, similarTracks, tracksByIds, type ListenerContext } from './library';

export interface WantedSong {
  title: string;
  artist: string;
  reason?: string;
}

interface RawAction {
  type?: string;
  name?: string;
  description?: string;
  artist?: string;
  genre?: string;
  tracks?: WantedSong[];
}

export interface Suggestion {
  title: string;
  artist: string;
  reason: string | null;
  cover: string | null;
  previewUrl: string | null;
  deezerUrl: string | null;
}

export interface DjReply {
  say: string;
  play?: Track[];
  queue?: Track[];
  playlist?: { id: number; name: string; added: number; missing: number };
  suggestions?: Suggestion[];
  /** songs the DJ wanted to play that aren't in the library */
  unmatched?: WantedSong[];
}

function persona(djName: string): string {
  return `You are ${djName}, the listener's personal radio DJ inside Spotless, their self-hosted music library. You are a warm, quick-witted, deeply knowledgeable music nerd: you know artists, scenes, labels, producers, samples, eras, deep cuts and the stories behind records, and you love connecting dots between songs. You talk like a great late-night radio host: confident, specific, never generic, never gushing.

How you work:
- You speak your "say" text out loud, so write for the ear: 1 to 4 short sentences, no lists, no markdown, no emoji, no URLs.
- Ground picks in the listener's real history and library below. Mention why a pick fits them when it adds something.
- "play", "queue" and "create_playlist" may only use songs from their library: songs in the sample list, or well-known songs by artists in their library. Use exact titles and artist names.
- Songs they do NOT have go in "suggest" with a one-line reason. Suggest real, existing songs only.
- When asked to "start the DJ", play something, or set a mood, pick 15 to 25 songs that flow well (energy, tempo, era, transitions) and use "play".
- For a whole artist or genre, prefer "play_artist" or "play_genre".
- When they just want to talk about music, answer and use no actions.
- Never invent library contents or play counts.

Reply with ONLY a JSON object, no text before or after it:
{"say": "...", "actions": [ ... ]}
Action shapes:
{"type":"play","tracks":[{"title":"...","artist":"..."}]}
{"type":"queue","tracks":[{"title":"...","artist":"..."}]}
{"type":"play_artist","artist":"..."}
{"type":"play_genre","genre":"..."}
{"type":"create_playlist","name":"...","description":"...","tracks":[{"title":"...","artist":"..."}]}
{"type":"suggest","tracks":[{"title":"...","artist":"...","reason":"..."}]}`;
}

/** The "say" text is read aloud: drop markdown and links models add anyway. */
export function speakable(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pull the first JSON object out of a model reply; models often wrap it in prose or code fences. */
export function parseReply(text: string): { say: string; actions: RawAction[] } {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  if (start >= 0) {
    // scan for the matching closing brace, respecting strings
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < cleaned.length; i++) {
      const c = cleaned[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try {
          const obj = JSON.parse(cleaned.slice(start, i + 1));
          const say = typeof obj.say === 'string' ? obj.say : typeof obj.message === 'string' ? obj.message : '';
          const actions = Array.isArray(obj.actions) ? obj.actions.filter((a: unknown) => a && typeof a === 'object') : [];
          if (say || actions.length) return { say: speakable(say), actions };
        } catch {
          // fall through to plain text
        }
        break;
      }
    }
  }
  return { say: speakable(cleaned), actions: [] };
}

const songs = (a: RawAction): WantedSong[] =>
  (Array.isArray(a.tracks) ? a.tracks : [])
    .filter((t) => t && typeof t.title === 'string' && typeof t.artist === 'string')
    .slice(0, 50)
    .map((t) => ({ title: t.title.trim().slice(0, 200), artist: t.artist.trim().slice(0, 200), reason: typeof t.reason === 'string' ? t.reason.slice(0, 300) : undefined }));

async function deezerLookup(s: WantedSong): Promise<Suggestion> {
  const base: Suggestion = { title: s.title, artist: s.artist, reason: s.reason ?? null, cover: null, previewUrl: null, deezerUrl: null };
  try {
    const q = encodeURIComponent(`artist:"${s.artist}" track:"${s.title}"`);
    const res = await fetch(`https://api.deezer.com/search/track?q=${q}&limit=1`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return base;
    const d = (await res.json()) as { data?: { title: string; preview: string | null; link: string; artist: { name: string }; album: { cover_medium: string | null } }[] };
    const hit = d.data?.[0];
    if (!hit) return base;
    return { ...base, cover: hit.album.cover_medium, previewUrl: hit.preview || null, deezerUrl: hit.link };
  } catch {
    return base;
  }
}

function createPlaylist(userId: number, name: string, description: string, ids: number[], missing: WantedSong[]) {
  const db = getDb();
  const id = Number(
    db.prepare('INSERT INTO playlists (name, description, user_id) VALUES (?, ?, ?)').run(name, description || null, userId).lastInsertRowid
  );
  const addTrack = db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)');
  const addPlaceholder = db.prepare('INSERT INTO playlist_placeholders (playlist_id, position, title, artist) VALUES (?, ?, ?, ?)');
  let added = 0;
  db.transaction(() => {
    let pos = nextPosition(db, id);
    for (const t of ids) added += addTrack.run(id, t, pos++).changes;
    // songs the library lacks stay as placeholders and resolve after a future scan
    for (const m of missing) addPlaceholder.run(id, pos++, m.title, m.artist);
  })();
  return { id, name, added, missing: missing.length };
}

export async function runDj(userId: number, userName: string, history: ChatMessage[], ctx: ListenerContext): Promise<DjReply> {
  const cfg = getDjConfig();
  const last = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
  const system = `${persona(cfg.djName)}\n\n--- About the listener ---\n${buildListenerProfile(userId, userName, last, ctx)}`;
  const text = await complete(cfg, system, history);
  const { say, actions } = parseReply(text);

  const index = buildIndex();
  const reply: DjReply = { say: say || 'Here you go.' };
  const unmatched: WantedSong[] = [];
  const resolve = (list: WantedSong[]) => {
    const ids: number[] = [];
    const missing: WantedSong[] = [];
    for (const s of list) {
      const id = index.find(s.title, s.artist);
      if (id !== undefined && !ids.includes(id)) ids.push(id);
      else if (id === undefined) missing.push(s);
    }
    return { ids, missing };
  };

  const suggestions: WantedSong[] = [];
  for (const a of actions.slice(0, 6)) {
    const type = String(a.type ?? '');
    if (type === 'play' || type === 'queue') {
      const { ids, missing } = resolve(songs(a));
      unmatched.push(...missing);
      const tracks = tracksByIds(ids);
      if (tracks.length) {
        if (type === 'play' && !reply.play) reply.play = tracks;
        else reply.queue = [...(reply.queue ?? []), ...tracks];
      }
    } else if (type === 'play_artist' && a.artist) {
      const artistId = index.artistId(String(a.artist));
      if (artistId) reply.play = tracksByIds(artistTracks(artistId));
      else unmatched.push({ title: '(any song)', artist: String(a.artist) });
    } else if (type === 'play_genre' && a.genre) {
      const tracks = tracksByIds(genreTracks(String(a.genre)));
      if (tracks.length) reply.play = tracks;
    } else if (type === 'create_playlist') {
      const { ids, missing } = resolve(songs(a));
      const name = String(a.name ?? '').trim().slice(0, 100) || `${cfg.djName} mix`;
      if (ids.length || missing.length) {
        reply.playlist = createPlaylist(userId, name, String(a.description ?? `Picked by ${cfg.djName}`).slice(0, 300), ids, missing);
      }
    } else if (type === 'suggest') {
      suggestions.push(...songs(a));
    }
  }

  // small local models often pick only a song or two; a DJ set should keep going
  const SET_SIZE = 20;
  if (reply.play && reply.play.length < 10) {
    const extra = similarTracks(userId, reply.play.map((t) => t.id), SET_SIZE - reply.play.length);
    reply.play = [...reply.play, ...tracksByIds(extra)];
  }

  // songs it wanted to play but the library lacks are worth surfacing as suggestions
  const explicit = new Set(suggestions.map((s) => `${s.artist}|${s.title}`.toLowerCase()));
  const all = [...suggestions, ...unmatched.filter((u) => u.title !== '(any song)')].slice(0, 12);
  if (all.length) {
    reply.suggestions = await Promise.all(
      all.map(async (s) => {
        const owned = index.find(s.title, s.artist);
        if (owned !== undefined) {
          // the model thought it was new, but the listener already has it: queue it instead
          const t = tracksByIds([owned]);
          reply.queue = [...(reply.queue ?? []), ...t];
          return null;
        }
        const found = await deezerLookup(s);
        // a song it tried to play but nobody can find is probably made up: drop it
        if (!explicit.has(`${s.artist}|${s.title}`.toLowerCase()) && !found.deezerUrl) return null;
        return found;
      })
    ).then((list) => list.filter((s): s is Suggestion => s !== null));
  }
  if (unmatched.length) reply.unmatched = unmatched.slice(0, 20);
  return reply;
}

/** A short spoken intro for the next song, between tracks of a DJ set. */
export async function segue(userName: string, track: { title: string; artist: string; album?: string; genre?: string | null }, previous?: { title: string; artist: string }) {
  const cfg = getDjConfig();
  const system = `${persona(cfg.djName)}\n\nRight now you are between songs on air for ${userName}. Write one or two spoken sentences (under 40 words) leading into the next song: a fact, story or connection about it, then its title and artist. Do not use actions.`;
  const prompt = `${previous ? `Just played: ${previous.title} by ${previous.artist}. ` : ''}Next up: ${track.title} by ${track.artist}${track.album ? ` from ${track.album}` : ''}${track.genre ? ` (${track.genre})` : ''}.`;
  const text = await complete(cfg, system, [{ role: 'user', content: prompt }], { maxTokens: 2048 });
  return parseReply(text).say;
}
