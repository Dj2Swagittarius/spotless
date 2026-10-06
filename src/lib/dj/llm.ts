import Anthropic from '@anthropic-ai/sdk';
import { apiKeyFor, llmProvider, type DjConfig } from './config';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const LOCAL_TIMEOUT_MS = 180_000; // local models on modest GPUs can be slow, reasoning models more so
const HOSTED_TIMEOUT_MS = 90_000;

/** JSON schema of the DJ's reply; sent to servers that support structured output. */
export const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    say: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['play', 'queue', 'play_artist', 'play_genre', 'create_playlist', 'suggest'] },
          name: { type: 'string' },
          description: { type: 'string' },
          artist: { type: 'string' },
          genre: { type: 'string' },
          tracks: {
            type: 'array',
            items: {
              type: 'object',
              properties: { title: { type: 'string' }, artist: { type: 'string' }, reason: { type: 'string' } },
              required: ['title', 'artist'],
            },
          },
        },
        required: ['type'],
      },
    },
  },
  required: ['say', 'actions'],
} as const;

export class LlmError extends Error {}

/** Remove reasoning that some local servers leave inline in the answer. */
export function stripReasoning(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '');
  // gpt-oss harmony tokens when a server's chat template doesn't parse them
  const final = t.lastIndexOf('<|message|>');
  if (final >= 0) t = t.slice(final + '<|message|>'.length);
  return t.replace(/<\|[a-z_]+\|>/g, '').trim();
}

async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const msg = String(err);
    if (/timeout|aborted/i.test(msg)) throw new LlmError(`The model took longer than ${Math.round(timeoutMs / 1000)}s to answer`);
    throw new LlmError(`Could not reach ${new URL(url).host}: ${msg.slice(0, 200)}`);
  }
  const text = await res.text();
  if (!res.ok) {
    const err = new LlmError(`HTTP ${res.status} from ${new URL(url).host}: ${text.slice(0, 300)}`);
    (err as LlmError & { status?: number }).status = res.status;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new LlmError(`Unexpected response from ${new URL(url).host}: ${text.slice(0, 200)}`);
  }
}

const isClientError = (err: unknown) => {
  const s = (err as { status?: number }).status;
  return typeof s === 'number' && s >= 400 && s < 500 && s !== 401 && s !== 403 && s !== 429;
};

/** One chat completion. Returns the assistant's text (reasoning stripped). */
export async function complete(
  cfg: DjConfig,
  system: string,
  messages: ChatMessage[],
  opts: { structured?: boolean; maxTokens?: number } = {}
): Promise<string> {
  const p = llmProvider(cfg.llm.provider);
  const baseUrl = (cfg.llm.baseUrl || p.defaultBaseUrl).replace(/\/+$/, '');
  const model = cfg.llm.model.trim();
  if (!model) throw new LlmError('No model selected. Pick one under Settings → AI DJ.');
  const key = apiKeyFor(cfg, 'llm', p.id, p.envKey);
  if (p.needsKey && !key) throw new LlmError(`${p.label} needs an API key (Settings → AI DJ).`);
  const timeout = p.local ? LOCAL_TIMEOUT_MS : HOSTED_TIMEOUT_MS;
  // reasoning models spend part of the budget thinking before they answer
  const maxTokens = opts.maxTokens ?? 4096;
  const structured = opts.structured !== false;

  if (p.kind === 'anthropic') return completeAnthropic(key, model, system, messages, maxTokens);

  if (p.kind === 'ollama') {
    const run = async (withFormat: boolean) => {
      const data = await postJson(
        `${baseUrl}/api/chat`,
        {
          model,
          stream: false,
          messages: [{ role: 'system', content: system }, ...messages],
          options: { num_ctx: cfg.llm.contextSize || 16384, temperature: 0.8 },
          ...(withFormat ? { format: REPLY_SCHEMA } : {}),
        },
        {},
        timeout
      );
      return String(data?.message?.content ?? '');
    };
    const text = structured && p.structured === 'ollama_schema' ? await run(true).catch((e) => (isClientError(e) ? run(false) : Promise.reject(e))) : await run(false);
    return stripReasoning(text);
  }

  // OpenAI-compatible
  const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
  if (p.id === 'openrouter') {
    headers['X-Title'] = 'Spotless';
  }
  const responseFormat =
    p.structured === 'json_schema'
      ? { type: 'json_schema', json_schema: { name: 'dj_reply', schema: REPLY_SCHEMA } }
      : p.structured === 'json_object'
        ? { type: 'json_object' }
        : null;
  const run = async (withFormat: boolean) => {
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: 'system', content: system }, ...messages],
    };
    // OpenAI's current models take max_completion_tokens and reject custom temperatures on reasoning models
    if (p.id === 'openai') body.max_completion_tokens = maxTokens;
    else {
      body.max_tokens = maxTokens;
      body.temperature = 0.8;
    }
    if (withFormat && responseFormat) body.response_format = responseFormat;
    const data = await postJson(`${baseUrl}/chat/completions`, body, headers, timeout);
    const msg = data?.choices?.[0]?.message;
    return String(msg?.content ?? '');
  };
  const text =
    structured && responseFormat
      ? await run(true).catch((e) => (isClientError(e) ? run(false) : Promise.reject(e)))
      : await run(false);
  return stripReasoning(text);
}

const FALLBACK_MODELS = /^claude-(opus-5|sonnet-5-5|fable-5)/;
const EFFORT_MODELS = /^claude-(opus-[45]|sonnet-5|fable-5)/;

async function completeAnthropic(apiKey: string, model: string, system: string, messages: ChatMessage[], maxTokens: number) {
  const client = new Anthropic({ apiKey, timeout: HOSTED_TIMEOUT_MS, maxRetries: 1 });
  const withFallback = FALLBACK_MODELS.test(model);
  try {
    const response = await client.beta.messages.create({
      model,
      max_tokens: Math.max(maxTokens, 8000),
      system,
      messages,
      // chat-style replies: low effort keeps the DJ quick
      ...(EFFORT_MODELS.test(model) ? { output_config: { effort: 'low' as const } } : {}),
      ...(withFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });
    if (response.stop_reason === 'refusal') throw new LlmError('The model declined to answer that request.');
    return response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw new LlmError('Anthropic rejected the API key.');
    if (err instanceof Anthropic.RateLimitError) throw new LlmError('Anthropic rate limit reached; try again shortly.');
    if (err instanceof Anthropic.APIError) throw new LlmError(`Anthropic API error ${err.status}: ${err.message.slice(0, 300)}`);
    throw new LlmError(`Could not reach Anthropic: ${String(err).slice(0, 200)}`);
  }
}

/** Model ids the configured server offers. */
export async function listModels(cfg: DjConfig): Promise<string[]> {
  const p = llmProvider(cfg.llm.provider);
  const baseUrl = (cfg.llm.baseUrl || p.defaultBaseUrl).replace(/\/+$/, '');
  const key = apiKeyFor(cfg, 'llm', p.id, p.envKey);
  if (p.needsKey && !key) throw new LlmError(`${p.label} needs an API key first.`);
  if (p.kind === 'anthropic') {
    try {
      const client = new Anthropic({ apiKey: key, timeout: 15000 });
      const ids: string[] = [];
      for await (const m of client.models.list()) ids.push(m.id);
      return ids;
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new LlmError('Anthropic rejected the API key.');
      throw new LlmError(`Could not list Anthropic models: ${String(err).slice(0, 200)}`);
    }
  }
  const url = p.kind === 'ollama' ? `${baseUrl}/api/tags` : `${baseUrl}/models`;
  const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  } catch (err) {
    throw new LlmError(`Could not reach ${baseUrl}: ${String(err).slice(0, 200)}`);
  }
  if (!res.ok) throw new LlmError(`HTTP ${res.status} listing models: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const ids: string[] =
    p.kind === 'ollama'
      ? (data.models ?? []).map((m: { name?: string; model?: string }) => m.name ?? m.model)
      : (data.data ?? []).map((m: { id: string }) => m.id);
  // Gemini's compat endpoint prefixes ids with "models/"
  return ids.filter(Boolean).map((id) => id.replace(/^models\//, '')).sort();
}
