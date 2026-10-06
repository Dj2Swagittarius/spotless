import { getSetting, setSetting } from '../db';

/**
 * AI DJ configuration: one server-wide setup (admin only) shared by every profile.
 * Everything defaults to local servers (LM Studio first) so nothing leaves the machine unless the
 * admin explicitly picks a hosted provider.
 */

export type LlmProviderId =
  | 'ollama'
  | 'lmstudio'
  | 'custom'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'mistral'
  | 'deepseek'
  | 'xai'
  | 'groq'
  | 'openrouter';

export type TtsProviderId = 'local' | 'browser' | 'openai' | 'elevenlabs' | 'off';
export type SttProviderId = 'local' | 'openai' | 'off';

export interface LlmProvider {
  id: LlmProviderId;
  label: string;
  local: boolean;
  /** 'openai' = OpenAI-compatible /chat/completions; 'ollama' = native /api/chat; 'anthropic' = Messages API */
  kind: 'openai' | 'ollama' | 'anthropic';
  defaultBaseUrl: string;
  needsKey: boolean;
  envKey?: string;
  /** structured output flavour sent first; a 4xx retries without it */
  structured: 'json_schema' | 'json_object' | 'ollama_schema' | 'none';
  /** example model ids shown as hints; "Load models" fetches the real list */
  examples: string[];
}

export const LLM_PROVIDERS: LlmProvider[] = [
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    local: true,
    kind: 'openai',
    defaultBaseUrl: process.env.LMSTUDIO_URL || 'http://localhost:1234/v1',
    needsKey: false,
    structured: 'json_schema',
    examples: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3-14b', 'google/gemma-3-12b'],
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    local: true,
    kind: 'ollama',
    defaultBaseUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    needsKey: false,
    structured: 'none',
    examples: ['gpt-oss:20b', 'gpt-oss:120b', 'qwen3:14b', 'gemma3:12b', 'mistral-small3.2'],
  },
  {
    id: 'custom',
    label: 'Other OpenAI-compatible server (vLLM, llama.cpp, LocalAI, Jan…)',
    local: true,
    kind: 'openai',
    defaultBaseUrl: 'http://localhost:8080/v1',
    needsKey: false,
    structured: 'none',
    examples: [],
  },
  { id: 'openai', label: 'OpenAI (ChatGPT)', local: false, kind: 'openai', defaultBaseUrl: 'https://api.openai.com/v1', needsKey: true, envKey: 'OPENAI_API_KEY', structured: 'json_schema', examples: [] },
  { id: 'anthropic', label: 'Anthropic (Claude)', local: false, kind: 'anthropic', defaultBaseUrl: 'https://api.anthropic.com', needsKey: true, envKey: 'ANTHROPIC_API_KEY', structured: 'none', examples: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'] },
  { id: 'gemini', label: 'Google Gemini', local: false, kind: 'openai', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true, envKey: 'GEMINI_API_KEY', structured: 'none', examples: [] },
  { id: 'mistral', label: 'Mistral', local: false, kind: 'openai', defaultBaseUrl: 'https://api.mistral.ai/v1', needsKey: true, envKey: 'MISTRAL_API_KEY', structured: 'json_object', examples: [] },
  { id: 'deepseek', label: 'DeepSeek', local: false, kind: 'openai', defaultBaseUrl: 'https://api.deepseek.com/v1', needsKey: true, envKey: 'DEEPSEEK_API_KEY', structured: 'json_object', examples: [] },
  { id: 'xai', label: 'xAI (Grok)', local: false, kind: 'openai', defaultBaseUrl: 'https://api.x.ai/v1', needsKey: true, envKey: 'XAI_API_KEY', structured: 'none', examples: [] },
  { id: 'groq', label: 'Groq', local: false, kind: 'openai', defaultBaseUrl: 'https://api.groq.com/openai/v1', needsKey: true, envKey: 'GROQ_API_KEY', structured: 'json_object', examples: [] },
  { id: 'openrouter', label: 'OpenRouter (many models)', local: false, kind: 'openai', defaultBaseUrl: 'https://openrouter.ai/api/v1', needsKey: true, envKey: 'OPENROUTER_API_KEY', structured: 'none', examples: [] },
];

export interface TtsProvider {
  id: TtsProviderId;
  label: string;
  local: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
  defaultVoice: string;
  needsKey: boolean;
  envKey?: string;
}

export const TTS_PROVIDERS: TtsProvider[] = [
  {
    id: 'local',
    label: 'Local speech server (Kokoro-FastAPI, Speaches, LocalAI… OpenAI-compatible)',
    local: true,
    defaultBaseUrl: process.env.TTS_URL || 'http://localhost:8880/v1',
    defaultModel: 'kokoro',
    defaultVoice: 'am_michael',
    needsKey: false,
  },
  { id: 'browser', label: 'Browser voice (on-device voices only)', local: true, defaultBaseUrl: '', defaultModel: '', defaultVoice: '', needsKey: false },
  { id: 'openai', label: 'OpenAI TTS (hosted)', local: false, defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini-tts', defaultVoice: 'ash', needsKey: true, envKey: 'OPENAI_API_KEY' },
  { id: 'elevenlabs', label: 'ElevenLabs (hosted)', local: false, defaultBaseUrl: 'https://api.elevenlabs.io', defaultModel: 'eleven_flash_v2_5', defaultVoice: '', needsKey: true, envKey: 'ELEVENLABS_API_KEY' },
  { id: 'off', label: 'Off (text only)', local: true, defaultBaseUrl: '', defaultModel: '', defaultVoice: '', needsKey: false },
];

export interface SttProvider {
  id: SttProviderId;
  label: string;
  local: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
  needsKey: boolean;
  envKey?: string;
}

export const STT_PROVIDERS: SttProvider[] = [
  {
    id: 'local',
    label: 'Local Whisper server (Speaches, LocalAI, whisper.cpp… OpenAI-compatible)',
    local: true,
    defaultBaseUrl: process.env.STT_URL || 'http://localhost:8000/v1',
    defaultModel: 'Systran/faster-whisper-small',
    needsKey: false,
  },
  { id: 'openai', label: 'OpenAI Whisper (hosted)', local: false, defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'whisper-1', needsKey: true, envKey: 'OPENAI_API_KEY' },
  { id: 'off', label: 'Off (type only)', local: true, defaultBaseUrl: '', defaultModel: '', needsKey: false },
];

export interface DjConfig {
  djName: string;
  llm: { provider: LlmProviderId; baseUrl: string; model: string; contextSize: number };
  tts: { provider: TtsProviderId; baseUrl: string; model: string; voice: string };
  stt: { provider: SttProviderId; baseUrl: string; model: string };
  /** API keys by provider id (`llm:openai`, `tts:elevenlabs`, `stt:openai`); never sent to the browser */
  keys: Record<string, string>;
}

const KEY = 'dj_config';

export function defaultConfig(): DjConfig {
  const llm = LLM_PROVIDERS.find((p) => p.id === process.env.DJ_PROVIDER) ?? LLM_PROVIDERS[0];
  const tts = TTS_PROVIDERS[0];
  const stt = STT_PROVIDERS[0];
  return {
    djName: 'DJ Spotless',
    llm: { provider: llm.id, baseUrl: llm.defaultBaseUrl, model: process.env.DJ_MODEL || '', contextSize: 16384 },
    tts: { provider: tts.id, baseUrl: tts.defaultBaseUrl, model: tts.defaultModel, voice: tts.defaultVoice },
    stt: { provider: stt.id, baseUrl: stt.defaultBaseUrl, model: stt.defaultModel },
    keys: {},
  };
}

export function getDjConfig(): DjConfig {
  const base = defaultConfig();
  const raw = getSetting(KEY);
  if (!raw) return base;
  try {
    const saved = JSON.parse(raw) as Partial<DjConfig>;
    return {
      djName: saved.djName || base.djName,
      llm: { ...base.llm, ...saved.llm },
      tts: { ...base.tts, ...saved.tts },
      stt: { ...base.stt, ...saved.stt },
      keys: { ...(saved.keys ?? {}) },
    };
  } catch {
    return base;
  }
}

export function saveDjConfig(cfg: DjConfig): void {
  setSetting(KEY, JSON.stringify(cfg));
}

export const llmProvider = (id: string) => LLM_PROVIDERS.find((p) => p.id === id) ?? LLM_PROVIDERS[0];
export const ttsProvider = (id: string) => TTS_PROVIDERS.find((p) => p.id === id) ?? TTS_PROVIDERS[0];
export const sttProvider = (id: string) => STT_PROVIDERS.find((p) => p.id === id) ?? STT_PROVIDERS[0];

/** Saved key first, then the provider's environment variable. */
export function apiKeyFor(cfg: DjConfig, scope: 'llm' | 'tts' | 'stt', providerId: string, envKey?: string): string {
  return cfg.keys[`${scope}:${providerId}`] || (envKey ? process.env[envKey] || '' : '');
}

/** Config as the browser may see it: keys replaced by "is a key set" flags. */
export function publicConfig(cfg: DjConfig) {
  const keySet: Record<string, boolean> = {};
  for (const p of LLM_PROVIDERS) keySet[`llm:${p.id}`] = Boolean(apiKeyFor(cfg, 'llm', p.id, p.envKey));
  for (const p of TTS_PROVIDERS) keySet[`tts:${p.id}`] = Boolean(apiKeyFor(cfg, 'tts', p.id, p.envKey));
  for (const p of STT_PROVIDERS) keySet[`stt:${p.id}`] = Boolean(apiKeyFor(cfg, 'stt', p.id, p.envKey));
  return { djName: cfg.djName, llm: cfg.llm, tts: cfg.tts, stt: cfg.stt, keySet };
}

/** http(s) URL without trailing slash, or null. */
export function cleanBaseUrl(input: unknown): string | null {
  const s = String(input ?? '').trim().replace(/\/+$/, '');
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? s : null;
  } catch {
    return null;
  }
}
