import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onFrame } from './frame-clock';

const { reportProblem } = vi.hoisted(() => ({ reportProblem: vi.fn() }));
vi.mock('./problems', () => ({ reportProblem }));

/** The animation frames asked for, run by hand. */
let pending = new Map<number, (now: number) => void>();
let nextId = 1;

function runFrame(now: number): void {
  const due = pending;
  pending = new Map();
  for (const callback of due.values()) callback(now);
}

describe('the frame clock', () => {
  beforeEach(() => {
    pending = new Map();
    vi.stubGlobal('requestAnimationFrame', (callback: (now: number) => void) => {
      const id = nextId++;
      pending.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
    reportProblem.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('runs every part in one animation frame loop', () => {
    const seen: string[] = [];
    const stopA = onFrame((now) => seen.push(`a${now}`));
    const stopB = onFrame((now) => seen.push(`b${now}`));
    expect(pending.size).toBe(1);
    runFrame(16);
    runFrame(32);
    expect(seen).toEqual(['a16', 'b16', 'a32', 'b32']);
    expect(pending.size).toBe(1);
    stopA();
    stopB();
  });

  it('stops when the last part goes, and starts again for the next', () => {
    const stopA = onFrame(() => {});
    const stopB = onFrame(() => {});
    stopA();
    expect(pending.size).toBe(1);
    stopB();
    expect(pending.size).toBe(0);
    const calls = vi.fn();
    const stopC = onFrame(calls);
    expect(pending.size).toBe(1);
    runFrame(48);
    expect(calls).toHaveBeenCalledWith(48);
    stopC();
  });

  it('reports a part that throws and stops it, while the others go on', () => {
    const error = new Error('broken');
    const broken = vi.fn(() => {
      throw error;
    });
    const fine = vi.fn();
    const stopBroken = onFrame(broken);
    const stopFine = onFrame(fine);
    runFrame(16);
    runFrame(32);
    expect(broken).toHaveBeenCalledTimes(1);
    expect(fine).toHaveBeenCalledTimes(2);
    expect(reportProblem).toHaveBeenCalledWith(error, 'The display');
    stopBroken();
    stopFine();
    expect(pending.size).toBe(0);
  });

  it('stops after the frame in which its only part threw', () => {
    onFrame(() => {
      throw new Error('broken');
    });
    runFrame(16);
    expect(pending.size).toBe(0);
  });
});
