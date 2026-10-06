import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/user';
import {
  LLM_PROVIDERS,
  STT_PROVIDERS,
  TTS_PROVIDERS,
  cleanBaseUrl,
  getDjConfig,
  llmProvider,
  publicConfig,
  saveDjConfig,
  sttProvider,
  ttsProvider,
  type DjConfig,
} from '@/lib/dj/config';
import { complete, listModels } from '@/lib/dj/llm';
import { listVoices, synthesize } from '@/lib/dj/speech';

export const dynamic = 'force-dynamic';

const providers = () => ({
  llm: LLM_PROVIDERS.map(({ id, label, local, defaultBaseUrl, needsKey, examples }) => ({ id, label, local, defaultBaseUrl, needsKey, examples })),
  tts: TTS_PROVIDERS.map(({ id, label, local, defaultBaseUrl, defaultModel, defaultVoice, needsKey }) => ({ id, label, local, defaultBaseUrl, defaultModel, defaultVoice, needsKey })),
  stt: STT_PROVIDERS.map(({ id, label, local, defaultBaseUrl, defaultModel, needsKey }) => ({ id, label, local, defaultBaseUrl, defaultModel, needsKey })),
});

/** Apply a settings form body onto a config; returns an error string for bad input. */
function merge(cfg: DjConfig, body: Record<string, unknown>): string | null {
  const str = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max);
  if (typeof body.djName === 'string') cfg.djName = str(body.djName, 40) || 'DJ Spotless';
  const llm = body.llm as Record<string, unknown> | undefined;
  if (llm) {
    const p = llmProvider(str(llm.provider));
    const url = cleanBaseUrl(llm.baseUrl);
    if (url === null) return 'LLM server URL must start with http:// or https://';
    const ctx = Number(llm.contextSize);
    cfg.llm = {
      provider: p.id,
      baseUrl: url || p.defaultBaseUrl,
      model: str(llm.model, 200),
      contextSize: Number.isFinite(ctx) && ctx >= 2048 ? Math.min(Math.round(ctx), 262144) : cfg.llm.contextSize,
    };
  }
  const tts = body.tts as Record<string, unknown> | undefined;
  if (tts) {
    const p = ttsProvider(str(tts.provider));
    const url = cleanBaseUrl(tts.baseUrl);
    if (url === null) return 'Voice server URL must start with http:// or https://';
    cfg.tts = { provider: p.id, baseUrl: url || p.defaultBaseUrl, model: str(tts.model, 200) || p.defaultModel, voice: str(tts.voice, 200) };
  }
  const stt = body.stt as Record<string, unknown> | undefined;
  if (stt) {
    const p = sttProvider(str(stt.provider));
    const url = cleanBaseUrl(stt.baseUrl);
    if (url === null) return 'Speech recognition URL must start with http:// or https://';
    cfg.stt = { provider: p.id, baseUrl: url || p.defaultBaseUrl, model: str(stt.model, 200) || p.defaultModel };
  }
  // keys: a non-empty value sets it, an empty string clears it, absent leaves it alone
  const keys = body.keys as Record<string, unknown> | undefined;
  if (keys && typeof keys === 'object') {
    for (const [k, v] of Object.entries(keys)) {
      if (!/^(llm|tts|stt):[a-z]+$/.test(k) || typeof v !== 'string') continue;
      if (v.trim()) cfg.keys[k] = v.trim().slice(0, 500);
      else delete cfg.keys[k];
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json({ config: publicConfig(getDjConfig()), providers: providers() });
}

export async function PUT(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const cfg = getDjConfig();
  const error = merge(cfg, body);
  if (error) return NextResponse.json({ error }, { status: 400 });
  saveDjConfig(cfg);
  return NextResponse.json({ config: publicConfig(cfg), providers: providers() });
}

// { action: 'models' | 'voices' | 'test' | 'test-voice', ...unsaved form values }
export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const cfg = getDjConfig();
  const error = merge(cfg, body);
  if (error) return NextResponse.json({ error }, { status: 400 });
  try {
    switch (body.action) {
      case 'models':
        return NextResponse.json({ models: await listModels(cfg) });
      case 'voices':
        return NextResponse.json({ voices: await listVoices(cfg) });
      case 'test': {
        const started = Date.now();
        const text = await complete(cfg, 'You are a radio DJ. Reply with JSON: {"say": "<one short sentence greeting>", "actions": []}', [
          { role: 'user', content: 'Say hi to the listener.' },
        ], { maxTokens: 1024 });
        return NextResponse.json({ ok: true, reply: text.slice(0, 300), ms: Date.now() - started });
      }
      case 'test-voice': {
        const out = await synthesize(cfg, `Hey, this is ${cfg.djName}. Your library sounds great tonight.`);
        if (!out) return NextResponse.json({ ok: true, browser: cfg.tts.provider === 'browser' });
        return new NextResponse(out.audio, { headers: { 'Content-Type': out.type, 'Cache-Control': 'no-store' } });
      }
      default:
        return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
