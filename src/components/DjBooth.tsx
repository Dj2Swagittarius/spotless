'use client';

import { useEffect, useRef } from 'react';
import { usePlayer } from '@/store/player';
import { seguesEnabled, speak, voiceEnabled } from '@/lib/client/djVoice';

/** Every few songs of a DJ set, the DJ talks the next song in (like a radio host). */
const EVERY = 3;

export default function DjBooth() {
  const index = usePlayer((s) => s.index);
  const djSession = usePlayer((s) => s.djSession);
  const queue = usePlayer((s) => s.queue);
  // segue text prepared one song ahead so it is ready when the song starts
  const prepared = useRef<{ trackId: number; text: Promise<string | null> } | null>(null);

  useEffect(() => {
    if (!djSession || index < 0 || !voiceEnabled() || !seguesEnabled()) return;
    const track = queue[index];
    if (track && prepared.current?.trackId === track.id) {
      const pending = prepared.current.text;
      prepared.current = null;
      pending.then((text) => {
        if (text && usePlayer.getState().queue[usePlayer.getState().index]?.id === track.id) speak(text);
      });
    }
    // prepare for the next talk point (songs 3, 6, 9, … of the set)
    const next = queue[index + 1];
    if (next && next.id > 0 && (index + 1) % EVERY === 0 && prepared.current?.trackId !== next.id) {
      prepared.current = {
        trackId: next.id,
        text: fetch('/api/dj/segue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackId: next.id, previousId: track?.id > 0 ? track.id : undefined }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => (d?.say as string) || null)
          .catch(() => null),
      };
    }
  }, [index, djSession, queue]);

  return null;
}
