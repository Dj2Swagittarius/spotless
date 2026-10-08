import { describe, expect, it } from 'vitest';
import { albumKey, artistKey, foldText, stripFeat } from '@/lib/scanner';

describe('foldText', () => {
  it('strips diacritics, lowercases and trims', () => {
    expect(foldText('  Tiësto ')).toBe('tiesto');
    expect(foldText('Mötley Crüe')).toBe('motley crue');
    expect(foldText('Beyoncé')).toBe('beyonce');
  });

  it('unifies curly quotes and non-breaking spaces', () => {
    expect(foldText('Don’t Stop')).toBe("don't stop");
    expect(foldText('“Quoted”')).toBe('"quoted"');
    expect(foldText('Two Words')).toBe('two words');
  });

  it('drops periods and commas and collapses whitespace', () => {
    expect(foldText('Invent, Animate')).toBe('invent animate');
    expect(foldText('Vol. 1')).toBe('vol 1');
    expect(foldText('A    B\t C')).toBe('a b c');
  });
});

describe('stripFeat', () => {
  it('removes bare feat. / ft. / featuring suffixes', () => {
    expect(stripFeat('Artist feat. Someone')).toBe('Artist');
    expect(stripFeat('Artist ft Someone')).toBe('Artist');
    expect(stripFeat('Artist Featuring Someone Else')).toBe('Artist');
  });

  it('removes parenthesised and bracketed credits', () => {
    expect(stripFeat('Artist (feat. Someone)')).toBe('Artist');
    expect(stripFeat('Artist [with Someone]')).toBe('Artist');
    expect(stripFeat('Artist (ft. A & B)')).toBe('Artist');
  });

  it('keeps only the first entry of a semicolon-separated list', () => {
    expect(stripFeat('A; B; C')).toBe('A');
  });

  it('leaves names without credits untouched', () => {
    expect(stripFeat('Featurette')).toBe('Featurette');
    expect(stripFeat('Craft Works')).toBe('Craft Works');
  });
});

describe('artistKey / albumKey', () => {
  it('artistKey folds and strips credits so variants collapse to one key', () => {
    expect(artistKey('Tiësto feat. Someone')).toBe('tiesto');
    expect(artistKey('TIËSTO')).toBe(artistKey('Tiesto'));
  });

  it('albumKey folds but keeps feature credits (they are part of the title)', () => {
    expect(albumKey('Greatest Hits, Vol. 2')).toBe('greatest hits vol 2');
    expect(albumKey('Album (feat. X)')).toBe('album (feat x)');
  });
});
