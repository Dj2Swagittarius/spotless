import { apiKeyFor, hostOf, sttProvider, ttsProvider, type DjConfig } from './config';

export class SpeechError extends Error {
  /** Wording any profile may see: no server hosts, URLs or upstream response bodies. */
  readonly safe: string;

  constructor(message: string, safe = message) {
    super(message);
    this.name = 'SpeechError';
    this.safe = safe;
  }
}

const DJ_STYLE =
  'Speak like a charismatic late-night radio DJ: relaxed, warm, confident, with natural pacing and a little smile in the voice.';

async function call(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  // computed up front: a malformed URL must surface as a clean SpeechError, not a TypeError in a catch
  const host = hostOf(url);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new SpeechError(`Could not reach ${host}: ${String(err).slice(0, 200)}`, 'The speech server could not be reached.');
  }
  if (!res.ok) {
    throw new SpeechError(`HTTP ${res.status} from ${host}: ${(await res.text()).slice(0, 300)}`, `The speech server answered with an error (HTTP ${res.status}).`);
  }
  return res;
}

/** Text to speech on the server. Returns null for providers handled in the browser (or off). */
export async function synthesize(cfg: DjConfig, text: string): Promise<{ audio: ArrayBuffer; type: string } | null> {
  const p = ttsProvider(cfg.tts.provider);
  if (p.id === 'browser' || p.id === 'off') return null;
  const baseUrl = (cfg.tts.baseUrl || p.defaultBaseUrl).replace(/\/+$/, '');
  const key = apiKeyFor(cfg, 'tts', p.id, p.envKey);
  if (p.needsKey && !key) throw new SpeechError(`${p.label} needs an API key.`);
  const model = cfg.tts.model || p.defaultModel;
  const voice = cfg.tts.voice || p.defaultVoice;
  const input = text.slice(0, 1500);

  if (p.id === 'elevenlabs') {
    if (!voice) throw new SpeechError('Pick an ElevenLabs voice first.');
    const res = await call(
      `${baseUrl}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': key, Accept: 'audio/mpeg' },
        body: JSON.stringify({ text: input, model_id: model }),
      },
      60_000
    );
    return { audio: await res.arrayBuffer(), type: 'audio/mpeg' };
  }

  // OpenAI and every OpenAI-compatible local server (Kokoro-FastAPI, Speaches, LocalAI, …)
  const body: Record<string, unknown> = { model, voice, input, response_format: 'mp3' };
  if (p.id === 'openai' && /gpt-4o/.test(model)) body.instructions = DJ_STYLE;
  const res = await call(
    `${baseUrl}/audio/speech`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(body),
    },
    p.local ? 120_000 : 60_000
  );
  return { audio: await res.arrayBuffer(), type: res.headers.get('content-type') || 'audio/mpeg' };
}

/** Voices offered by the configured TTS server, when it can list them. */
export async function listVoices(cfg: DjConfig): Promise<{ id: string; name: string }[]> {
  const p = ttsProvider(cfg.tts.provider);
  const baseUrl = (cfg.tts.baseUrl || p.defaultBaseUrl).replace(/\/+$/, '');
  const key = apiKeyFor(cfg, 'tts', p.id, p.envKey);
  if (p.id === 'elevenlabs') {
    if (!key) throw new SpeechError('Add the ElevenLabs API key first.');
    const res = await call(`${baseUrl}/v1/voices`, { headers: { 'xi-api-key': key } }, 15_000);
    const d = (await res.json()) as { voices?: { voice_id: string; name: string }[] };
    return (d.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name }));
  }
  if (p.id === 'local') {
    // Kokoro-FastAPI exposes /audio/voices; other servers may not
    const res = await call(`${baseUrl}/audio/voices`, {}, 10_000);
    const d = (await res.json()) as { voices?: (string | { id?: string; name?: string })[] };
    return (d.voices ?? []).map((v) => (typeof v === 'string' ? { id: v, name: v } : { id: v.id ?? v.name ?? '', name: v.name ?? v.id ?? '' })).filter((v) => v.id);
  }
  if (p.id === 'openai') {
    return ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'].map((v) => ({ id: v, name: v }));
  }
  return [];
}

/** Speech to text via an OpenAI-compatible /audio/transcriptions endpoint. */
export async function transcribe(cfg: DjConfig, audio: Blob, filename: string): Promise<string> {
  const p = sttProvider(cfg.stt.provider);
  if (p.id === 'off') throw new SpeechError('Voice input is turned off (Settings → AI DJ).');
  const baseUrl = (cfg.stt.baseUrl || p.defaultBaseUrl).replace(/\/+$/, '');
  const key = apiKeyFor(cfg, 'stt', p.id, p.envKey);
  if (p.needsKey && !key) throw new SpeechError(`${p.label} needs an API key.`);
  const model = cfg.stt.model || p.defaultModel;
  const auth: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
  const send = () => {
    const form = new FormData();
    form.append('file', audio, filename);
    form.append('model', model);
    form.append('response_format', 'json');
    return call(`${baseUrl}/audio/transcriptions`, { method: 'POST', headers: auth, body: form }, p.local ? 120_000 : 60_000);
  };
  let res: Response;
  try {
    res = await send();
  } catch (err) {
    // Speaches answers 404 for a model it hasn't downloaded yet; ask it to fetch the model once, then retry
    if (!p.local || !/HTTP 404/.test(String(err))) throw err;
    await call(`${baseUrl}/models/${model}`, { method: 'POST', headers: auth }, 600_000).catch(() => {
      throw err;
    });
    res = await send();
  }
  const d = (await res.json().catch(() => ({}))) as { text?: string };
  return (d.text ?? '').trim();
}
