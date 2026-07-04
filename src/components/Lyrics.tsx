'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

interface LyricLine {
  time: number; // seconds
  text: string;
}

function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split('\n')) {
    const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (m) lines.push({ time: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() });
  }
  return lines.sort((a, b) => a.time - b.time);
}

export default function Lyrics({ trackId, progress }: { trackId: number; progress: number }) {
  const [synced, setSynced] = useState<LyricLine[] | null>(null);
  const [plain, setPlain] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const activeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLoading(true);
    setSynced(null);
    setPlain(null);
    fetch(`/api/lyrics/${trackId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.synced) setSynced(parseLrc(d.synced));
        else if (d.plain) setPlain(d.plain);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [trackId]);

  const activeIndex = useMemo(() => {
    if (!synced) return -1;
    let idx = -1;
    for (let i = 0; i < synced.length; i++) {
      if (synced[i].time <= progress + 0.3) idx = i;
      else break;
    }
    return idx;
  }, [synced, progress]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIndex]);

  if (loading) return <div className="p-6 text-center text-subdued">Looking for lyrics…</div>;
  if (!synced && !plain) return <div className="p-6 text-center text-subdued">No lyrics found for this song.</div>;

  if (synced) {
    return (
      <div className="space-y-3 p-6">
        {synced.map((l, i) => (
          <div
            key={i}
            ref={i === activeIndex ? activeRef : undefined}
            className={`text-lg font-semibold transition-colors ${
              i === activeIndex ? 'text-accent' : i < activeIndex ? 'text-subdued/60' : 'text-white/80'
            }`}
          >
            {l.text || '♪'}
          </div>
        ))}
      </div>
    );
  }

  return <div className="whitespace-pre-wrap p-6 text-lg font-medium text-white/90">{plain}</div>;
}
