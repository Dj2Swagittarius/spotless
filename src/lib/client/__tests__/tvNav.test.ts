import { describe, expect, it } from 'vitest';
import { isTv, pickNext, type Box } from '../tvNav';

const box = (left: number, top: number, w = 10, h = 10): Box => ({ left, top, right: left + w, bottom: top + h });

describe('isTv', () => {
  it('is only on for the TV app', () => {
    expect(isTv('Mozilla/5.0 SpotlessAndroid/0.4.0 SpotlessTV')).toBe(true);
    expect(isTv('Mozilla/5.0 SpotlessAndroid/0.4.0')).toBe(false);
    expect(isTv('Mozilla/5.0 Chrome/130')).toBe(false);
  });
});

describe('pickNext', () => {
  // a 3x3 grid, 20px apart
  const grid = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => box(c * 20, r * 20)));
  const center = grid[4];
  const others = grid.filter((b) => b !== center);
  const at = (i: number) => (i < 0 ? null : others[i]);

  it('moves to the neighbour in the same row or column', () => {
    expect(at(pickNext(center, others, 'right'))).toBe(grid[5]);
    expect(at(pickNext(center, others, 'left'))).toBe(grid[3]);
    expect(at(pickNext(center, others, 'up'))).toBe(grid[1]);
    expect(at(pickNext(center, others, 'down'))).toBe(grid[7]);
  });

  it('finds nothing past the edge', () => {
    expect(pickNext(grid[2], grid.filter((b) => b !== grid[2]), 'right')).toBe(-1);
    expect(pickNext(grid[0], grid.slice(1), 'up')).toBe(-1);
  });

  it('prefers a far control in line over a near one off to the side', () => {
    const from = box(0, 0);
    const inLine = box(0, 100);
    const offside = box(60, 30);
    expect(pickNext(from, [offside, inLine], 'down')).toBe(1);
  });

  it('treats an overlapping row as in line', () => {
    const tall = box(0, 0, 10, 50);
    const besideLow = box(30, 35);
    const fartherHigh = box(80, 0);
    expect(pickNext(tall, [fartherHigh, besideLow], 'right')).toBe(1);
  });
});
