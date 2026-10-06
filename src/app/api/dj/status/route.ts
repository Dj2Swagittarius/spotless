import { NextResponse } from 'next/server';
import { getDjConfig, llmProvider, sttProvider, ttsProvider } from '@/lib/dj/config';

export const dynamic = 'force-dynamic';

// what any profile needs to drive the DJ page; no URLs or keys
export async function GET() {
  const cfg = getDjConfig();
  const llm = llmProvider(cfg.llm.provider);
  return NextResponse.json({
    djName: cfg.djName,
    ready: Boolean(cfg.llm.model),
    llm: { label: llm.label, local: llm.local, model: cfg.llm.model },
    voice: cfg.tts.provider, // 'local' | 'openai' | 'elevenlabs' → server audio; 'browser' | 'off'
    voiceLocal: ttsProvider(cfg.tts.provider).local,
    listen: cfg.stt.provider !== 'off',
    listenLocal: sttProvider(cfg.stt.provider).local,
  });
}
