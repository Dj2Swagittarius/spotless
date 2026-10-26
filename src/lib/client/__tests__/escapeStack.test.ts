import { describe, expect, it } from 'vitest';
import { closeTopOverlay } from '../escapeStack';

describe('closeTopOverlay', () => {
  it('reports when nothing is open, so Android back falls through to page history', () => {
    expect(closeTopOverlay()).toBe(false);
  });
});
