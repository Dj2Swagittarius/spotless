import path from 'path';
import { describe, expect, it } from 'vitest';
import { localLrcCandidates, parseLrc } from '@/lib/lyrics';

describe('localLrcCandidates', () => {
  it('maps an audio path to same-basename .lrc and .LRC siblings', () => {
    const audio = path.join('music', 'Artist', 'Album', 'Song.flac');
    expect(localLrcCandidates(audio)).toEqual([
      path.join('music', 'Artist', 'Album', 'Song.lrc'),
      path.join('music', 'Artist', 'Album', 'Song.LRC'),
    ]);
  });

  it('keeps dots inside the basename and only swaps the final extension', () => {
    const [lrc] = localLrcCandidates(path.join('music', 'Mr. Blue Sky.mp3'));
    expect(lrc).toBe(path.join('music', 'Mr. Blue Sky.lrc'));
  });
});

describe('parseLrc', () => {
  it('parses timestamped lines into millisecond offsets and reads [offset:]', () => {
    const parsed = parseLrc('[offset:+250]\n[00:01.50]First\n[01:02.3]Second\r\n');
    expect(parsed.synced).toBe(true);
    expect(parsed.offset).toBe(250);
    expect(parsed.lines).toEqual([
      { start: 1_500, value: 'First' },
      { start: 62_300, value: 'Second' },
    ]);
  });

  it('expands a line with several timestamps and strips a BOM', () => {
    const parsed = parseLrc('﻿[00:10.00][00:20.00]Chorus');
    expect(parsed.lines.map((l) => l.start)).toEqual([10_000, 20_000]);
    expect(parsed.lines.every((l) => l.value === 'Chorus')).toBe(true);
  });

  it('treats text without timestamps as plain lyrics', () => {
    const parsed = parseLrc('Just words\nMore words');
    expect(parsed.synced).toBe(false);
    expect(parsed.lines.map((l) => l.value)).toEqual(['Just words', 'More words']);
    expect(parsed.lines.every((l) => l.start === undefined)).toBe(true);
    expect(parsed.plain).toContain('Just words');
  });
});
