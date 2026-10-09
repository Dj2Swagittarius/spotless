'use client';

import { useEffect, useState } from 'react';

interface LlmP {
  id: string;
  label: string;
  local: boolean;
  defaultBaseUrl: string;
  needsKey: boolean;
  examples: string[];
}
interface TtsP {
  id: string;
  label: string;
  local: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
  defaultVoice: string;
  needsKey: boolean;
}
interface SttP {
  id: string;
  label: string;
  local: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
  needsKey: boolean;
}
interface Cfg {
  djName: string;
  llm: { provider: string; baseUrl: string; model: string; contextSize: number };
  tts: { provider: string; baseUrl: string; model: string; voice: string };
  stt: { provider: string; baseUrl: string; model: string };
  keySet: Record<string, boolean>;
}

type Msg = { ok: boolean; text: string } | null;

const input = 'w-full rounded-sm bg-highlight px-3 py-2 text-sm text-white placeholder:text-subdued outline-hidden focus:shadow-insetBorder';
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wider text-subdued';

/** Settings → AI DJ (admin only): language model, voice and speech recognition. */
export default function DjSettings() {
  const [providers, setProviders] = useState<{ llm: LlmP[]; tts: TtsP[]; stt: SttP[] } | null>(null);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [models, setModels] = useState<string[]>([]);
  const [voices, setVoices] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [voiceMsg, setVoiceMsg] = useState<Msg>(null);

  useEffect(() => {
    fetch('/api/settings/dj')
      .then((r) => r.json())
      .then((d) => {
        if (d.config) {
          setCfg(d.config);
          setProviders(d.providers);
        }
      })
      .catch(() => {});
  }, []);

  if (!cfg || !providers) return <div className="text-sm text-subdued">Loading…</div>;

  const llmP = providers.llm.find((p) => p.id === cfg.llm.provider) ?? providers.llm[0];
  const ttsP = providers.tts.find((p) => p.id === cfg.tts.provider) ?? providers.tts[0];
  const sttP = providers.stt.find((p) => p.id === cfg.stt.provider) ?? providers.stt[0];

  const body = () => ({
    djName: cfg.djName,
    llm: cfg.llm,
    tts: cfg.tts,
    stt: cfg.stt,
    keys: Object.fromEntries(Object.entries(keys).filter(([, v]) => v.trim() !== '')),
  });

  const post = async (action: string) => {
    const res = await fetch('/api/settings/dj', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body() }),
    });
    return res;
  };

  const loadModels = async () => {
    setBusy('models');
    setMsg(null);
    const res = await post('models');
    const d = await res.json().catch(() => ({}));
    setBusy('');
    if (!res.ok) return setMsg({ ok: false, text: d.error ?? 'Could not list models' });
    setModels(d.models ?? []);
    if (!cfg.llm.model && d.models?.length) setCfg({ ...cfg, llm: { ...cfg.llm, model: d.models[0] } });
    setMsg({ ok: true, text: `${d.models?.length ?? 0} models available` });
  };

  const loadVoices = async () => {
    setBusy('voices');
    setVoiceMsg(null);
    const res = await post('voices');
    const d = await res.json().catch(() => ({}));
    setBusy('');
    if (!res.ok) return setVoiceMsg({ ok: false, text: d.error ?? 'Could not list voices' });
    setVoices(d.voices ?? []);
    setVoiceMsg({ ok: true, text: `${d.voices?.length ?? 0} voices` });
  };

  const test = async () => {
    setBusy('test');
    setMsg(null);
    const res = await post('test');
    const d = await res.json().catch(() => ({}));
    setBusy('');
    setMsg(res.ok ? { ok: true, text: `Answered in ${(d.ms / 1000).toFixed(1)}s: ${d.reply}` } : { ok: false, text: d.error ?? 'Test failed' });
  };

  const testVoice = async () => {
    setBusy('voice');
    setVoiceMsg(null);
    const res = await post('test-voice');
    setBusy('');
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('application/json')) {
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setVoiceMsg({ ok: false, text: d.error ?? 'Voice test failed' });
      if (d.browser && typeof speechSynthesis !== 'undefined') {
        const v = speechSynthesis.getVoices().find((x) => x.localService);
        if (!v) return setVoiceMsg({ ok: false, text: 'This browser has no on-device voices.' });
        const u = new SpeechSynthesisUtterance(`Hey, this is ${cfg.djName}.`);
        u.voice = v;
        speechSynthesis.speak(u);
        return setVoiceMsg({ ok: true, text: `Using on-device voice: ${v.name}` });
      }
      return setVoiceMsg({ ok: true, text: 'Voice is off.' });
    }
    const url = URL.createObjectURL(await res.blob());
    new Audio(url).play().catch(() => {});
    setVoiceMsg({ ok: true, text: 'Playing a sample…' });
  };

  const save = async () => {
    setBusy('save');
    setMsg(null);
    const res = await fetch('/api/settings/dj', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body()),
    });
    const d = await res.json().catch(() => ({}));
    setBusy('');
    if (!res.ok) return setMsg({ ok: false, text: d.error ?? 'Save failed' });
    setCfg(d.config);
    setKeys({});
    setMsg({ ok: true, text: 'Saved' });
  };

  const keyField = (scope: 'llm' | 'tts' | 'stt', providerId: string, placeholder: string) => {
    const k = `${scope}:${providerId}`;
    return (
      <div>
        <span className={label}>API key</span>
        <input
          className={input}
          type="password"
          autoComplete="off"
          value={keys[k] ?? ''}
          onChange={(e) => setKeys({ ...keys, [k]: e.target.value })}
          placeholder={cfg.keySet[k] ? '•••••••• (saved, type to replace)' : placeholder}
        />
      </div>
    );
  };

  const hostedWarning = (local: boolean, what: string) =>
    !local && <div className="rounded-sm bg-warning/10 px-3 py-2 text-xs text-warning">{what} will be sent to a hosted service, outside your server.</div>;

  const message = (m: Msg) =>
    m && <div className={`rounded-sm px-3 py-2 text-sm ${m.ok ? 'bg-accent/10 text-accent' : 'bg-negative/10 text-negative'}`}>{m.text}</div>;

  return (
    <div className="space-y-6">
      <p className="text-sm text-subdued">
        A chat DJ that knows every profile’s library and listening history: starts sets, builds playlists, suggests songs you don’t own and
        talks between songs. Defaults are local (LM Studio, a local voice server and a local Whisper server) so nothing leaves this machine.
        When Spotless runs in Docker, use <code className="text-white">http://host.docker.internal:PORT</code> to reach servers on the host.
      </p>

      <div>
        <span className={label}>DJ name</span>
        <input className={input} value={cfg.djName} maxLength={40} onChange={(e) => setCfg({ ...cfg, djName: e.target.value })} />
      </div>

      {/* language model */}
      <div className="space-y-3">
        <h3 className="font-bold">Brain (language model)</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className={label}>Provider</span>
            <select
              className={input}
              value={cfg.llm.provider}
              onChange={(e) => {
                const p = providers.llm.find((x) => x.id === e.target.value)!;
                setModels([]);
                setCfg({ ...cfg, llm: { ...cfg.llm, provider: p.id, baseUrl: p.defaultBaseUrl, model: '' } });
              }}
            >
              <optgroup label="On your server">
                {providers.llm.filter((p) => p.local).map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </optgroup>
              <optgroup label="Hosted">
                {providers.llm.filter((p) => !p.local).map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </optgroup>
            </select>
          </div>
          <div>
            <span className={label}>Server URL</span>
            <input className={input} value={cfg.llm.baseUrl} onChange={(e) => setCfg({ ...cfg, llm: { ...cfg.llm, baseUrl: e.target.value } })} placeholder={llmP.defaultBaseUrl} />
          </div>
          {llmP.needsKey && keyField('llm', llmP.id, 'API key')}
          {!llmP.needsKey && llmP.id === 'custom' && keyField('llm', llmP.id, 'API key (optional)')}
          <div>
            <span className={label}>Model</span>
            <div className="flex gap-2">
              <input
                className={input}
                list="dj-models"
                value={cfg.llm.model}
                onChange={(e) => setCfg({ ...cfg, llm: { ...cfg.llm, model: e.target.value } })}
                placeholder={llmP.examples[0] ? `e.g. ${llmP.examples[0]}` : 'Load models →'}
              />
              <datalist id="dj-models">
                {(models.length ? models : llmP.examples).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <button className="btn-pill shrink-0" onClick={loadModels} disabled={busy !== ''}>
                {busy === 'models' ? '…' : 'Load models'}
              </button>
            </div>
          </div>
          {llmP.id === 'ollama' && (
            <div>
              <span className={label}>Context size (tokens)</span>
              <input
                className={input}
                type="number"
                min={2048}
                step={1024}
                value={cfg.llm.contextSize}
                onChange={(e) => setCfg({ ...cfg, llm: { ...cfg.llm, contextSize: Number(e.target.value) } })}
              />
            </div>
          )}
        </div>
        {llmP.examples.length > 0 && llmP.local && (
          <p className="text-xs text-subdued">
            Good local picks: <span className="text-white">{llmP.examples.join(', ')}</span>. gpt-oss reasons before it answers, so it is smarter but
            slower; Qwen 3 and Gemma 3 answer faster on smaller GPUs.
          </p>
        )}
        {llmP.id === 'lmstudio' && (
          <p className="text-xs text-subdued">
            In LM Studio, open the Developer tab and start the server (port 1234). If Spotless runs in Docker or on another machine, turn on
            “Serve on Local Network” too. Load the model there, or enable just-in-time loading.
          </p>
        )}
        {hostedWarning(llmP.local, 'Your chat and a summary of your listening history')}
        {message(msg)}
        <button className="btn-pill" onClick={test} disabled={busy !== '' || !cfg.llm.model}>
          {busy === 'test' ? 'Asking the DJ…' : 'Test model'}
        </button>
      </div>

      {/* voice */}
      <div className="space-y-3">
        <h3 className="font-bold">Voice (text to speech)</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <span className={label}>Provider</span>
            <select
              className={input}
              value={cfg.tts.provider}
              onChange={(e) => {
                const p = providers.tts.find((x) => x.id === e.target.value)!;
                setVoices([]);
                setCfg({ ...cfg, tts: { provider: p.id, baseUrl: p.defaultBaseUrl, model: p.defaultModel, voice: p.defaultVoice } });
              }}
            >
              {providers.tts.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          {!['browser', 'off'].includes(ttsP.id) && (
            <>
              <div>
                <span className={label}>Server URL</span>
                <input className={input} value={cfg.tts.baseUrl} onChange={(e) => setCfg({ ...cfg, tts: { ...cfg.tts, baseUrl: e.target.value } })} placeholder={ttsP.defaultBaseUrl} />
              </div>
              {ttsP.needsKey && keyField('tts', ttsP.id, 'API key')}
              <div>
                <span className={label}>Model</span>
                <input className={input} value={cfg.tts.model} onChange={(e) => setCfg({ ...cfg, tts: { ...cfg.tts, model: e.target.value } })} placeholder={ttsP.defaultModel} />
              </div>
              <div>
                <span className={label}>Voice</span>
                <div className="flex gap-2">
                  <input
                    className={input}
                    list="dj-voices"
                    value={cfg.tts.voice}
                    onChange={(e) => setCfg({ ...cfg, tts: { ...cfg.tts, voice: e.target.value } })}
                    placeholder={ttsP.defaultVoice || 'voice id'}
                  />
                  <datalist id="dj-voices">
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </datalist>
                  <button className="btn-pill shrink-0" onClick={loadVoices} disabled={busy !== ''}>
                    {busy === 'voices' ? '…' : 'Load voices'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        {ttsP.id === 'local' && (
          <p className="text-xs text-subdued">
            Recommended: Kokoro-FastAPI (<code className="text-white">docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu</code>, GPU
            image available). Model <code className="text-white">kokoro</code>, voices like am_michael, af_heart, bf_emma. Any server with an
            OpenAI-style <code className="text-white">/v1/audio/speech</code> endpoint works.
          </p>
        )}
        {ttsP.id === 'browser' && <p className="text-xs text-subdued">Uses only voices installed on the listening device; quality depends on the OS.</p>}
        {hostedWarning(ttsP.local, 'What the DJ says')}
        {message(voiceMsg)}
        {ttsP.id !== 'off' && (
          <button className="btn-pill" onClick={testVoice} disabled={busy !== ''}>
            {busy === 'voice' ? 'Generating…' : 'Test voice'}
          </button>
        )}
      </div>

      {/* speech recognition */}
      <div className="space-y-3">
        <h3 className="font-bold">Listening (speech to text)</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <span className={label}>Provider</span>
            <select
              className={input}
              value={cfg.stt.provider}
              onChange={(e) => {
                const p = providers.stt.find((x) => x.id === e.target.value)!;
                setCfg({ ...cfg, stt: { provider: p.id, baseUrl: p.defaultBaseUrl, model: p.defaultModel } });
              }}
            >
              {providers.stt.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          {sttP.id !== 'off' && (
            <>
              <div>
                <span className={label}>Server URL</span>
                <input className={input} value={cfg.stt.baseUrl} onChange={(e) => setCfg({ ...cfg, stt: { ...cfg.stt, baseUrl: e.target.value } })} placeholder={sttP.defaultBaseUrl} />
              </div>
              <div>
                <span className={label}>Model</span>
                <input className={input} value={cfg.stt.model} onChange={(e) => setCfg({ ...cfg, stt: { ...cfg.stt, model: e.target.value } })} placeholder={sttP.defaultModel} />
              </div>
              {sttP.needsKey && keyField('stt', sttP.id, 'API key')}
            </>
          )}
        </div>
        {sttP.id === 'local' && (
          <p className="text-xs text-subdued">
            Recommended: Speaches (faster-whisper) or any server with an OpenAI-style <code className="text-white">/v1/audio/transcriptions</code>{' '}
            endpoint. The browser’s built-in speech recognition is deliberately not used: Chrome sends that audio to Google. The mic needs HTTPS or
            localhost.
          </p>
        )}
        {hostedWarning(sttP.local, 'Your voice recordings')}
      </div>

      <button className="btn-primary" onClick={save} disabled={busy !== ''}>
        {busy === 'save' ? 'Saving…' : 'Save AI DJ settings'}
      </button>
    </div>
  );
}
