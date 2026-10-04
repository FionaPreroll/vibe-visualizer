import { describe, expect, it } from 'vitest';
import { EDGE, edgeSpeed, MAX_SPEED } from './drag-scroll';

describe('edgeSpeed', () => {
  it('scrolls only near the edges, faster the closer, up at the top and down at the bottom', () => {
    const [top, bottom] = [100, 500];
    expect(edgeSpeed(300, top, bottom)).toBe(0);
    expect(edgeSpeed(top + EDGE, top, bottom)).toBe(0);
    expect(edgeSpeed(bottom - EDGE, top, bottom)).toBe(0);
    expect(edgeSpeed(top + EDGE / 2, top, bottom)).toBeCloseTo(-MAX_SPEED / 2);
    expect(edgeSpeed(bottom - EDGE / 4, top, bottom)).toBeCloseTo((MAX_SPEED * 3) / 4);
    // At the edge and beyond it (over the header above the list): the most.
    expect(edgeSpeed(top, top, bottom)).toBe(-MAX_SPEED);
    expect(edgeSpeed(top - 30, top, bottom)).toBe(-MAX_SPEED);
    expect(edgeSpeed(bottom + 30, top, bottom)).toBe(MAX_SPEED);
  });

  it('keeps the middle of a short list still', () => {
    // 90 pixels high: a strip of 30 at each edge, still in the middle.
    expect(edgeSpeed(145, 100, 190)).toBe(0);
    expect(edgeSpeed(101, 100, 190)).toBeLessThan(0);
    expect(edgeSpeed(100, 100, 100)).toBe(0);
  });
});
