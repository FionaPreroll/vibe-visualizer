import { describe, expect, it } from 'vitest';
import { F } from '../analysis/features';
import {
  DEFAULT_AUTO_PRESETS,
  PresetDirector,
  sanitizeAutoPresets,
  switchingPool,
  type AutoPresets,
} from './preset-director';

const FRAME = 1 / 60;

function frame(fields: Partial<Record<keyof typeof F, number>> = {}): Float32Array {
  const features = new Float32Array(F.size);
  features[F.rms] = 0.1;
  for (const [key, value] of Object.entries(fields)) features[F[key as keyof typeof F]] = value;
  return features;
}

function director(config: Partial<AutoPresets>, count = 4, current = 0): PresetDirector {
  const result = new PresetDirector(7);
  result.configure({ ...DEFAULT_AUTO_PRESETS, on: true, ...config });
  result.setPool(count, current);
  return result;
}

describe('automatic preset switching (PR-02)', () => {
  it('validates its settings', () => {
    expect(sanitizeAutoPresets(null)).toEqual(DEFAULT_AUTO_PRESETS);
    expect(sanitizeAutoPresets({ on: true, trigger: 'drops', bars: 7.4, seconds: 1 })).toEqual({
      ...DEFAULT_AUTO_PRESETS,
      on: true,
      trigger: 'drops',
      bars: 7,
      seconds: 5,
    });
    expect(sanitizeAutoPresets({ trigger: 'moon', order: 'chaos' })).toEqual(DEFAULT_AUTO_PRESETS);
  });

  it('switches every so many seconds of music, in order', () => {
    const auto = director({ trigger: 'seconds', seconds: 10 });
    const switches: [number, number][] = [];
    for (let i = 0; i < 60 * 25; i++) {
      const next = auto.update(FRAME, frame());
      if (next !== null) switches.push([Math.round(i * FRAME), next]);
    }
    expect(switches).toEqual([
      [10, 1],
      [20, 2],
    ]);
    // Silence does not count.
    const quiet = director({ trigger: 'seconds', seconds: 10 });
    for (let i = 0; i < 60 * 20; i++) expect(quiet.update(FRAME, frame({ rms: 0 }))).toBeNull();
  });

  it('counts anew when switched on again', () => {
    const config: AutoPresets = {
      ...DEFAULT_AUTO_PRESETS,
      on: true,
      trigger: 'seconds',
      seconds: 10,
    };
    const auto = director(config);
    for (let i = 0; i < 60 * 8; i++) expect(auto.update(FRAME, frame())).toBeNull();
    auto.configure({ ...config, on: false });
    auto.configure(config);
    for (let i = 0; i < 60 * 9; i++) expect(auto.update(FRAME, frame())).toBeNull();
    for (let i = 0; i < 60 * 2; i++) auto.update(FRAME, frame());
    expect(auto.shown).toBe(1);
  });

  it('switches every so many bars, on the beat', () => {
    const auto = director({ trigger: 'bars', bars: 2 }, 3, 2);
    const beats: (number | null)[] = [];
    for (let beat = 0; beat < 16; beat++) {
      beats.push(auto.update(FRAME, frame({ beatHit: 1 })));
      for (let i = 0; i < 29; i++) expect(auto.update(FRAME, frame())).toBeNull();
    }
    // Every eighth beat, and after the last preset the first.
    expect(beats.map((next, i) => (next === null ? null : [i, next])).filter(Boolean)).toEqual([
      [7, 0],
      [15, 1],
    ]);
  });

  it('switches on a drop: the low end back after a quiet stretch, then rests', () => {
    const auto = director({ trigger: 'drops' });
    const switches: number[] = [];
    const run = (seconds: number, low: number, kicks: boolean, from: number) => {
      for (let i = 0; i < seconds * 60; i++) {
        const kick = kicks && i % 30 === 0 ? 1 : 0;
        const features = frame({ bands: low, kickHit: kick });
        features[F.bands + 1] = low;
        const next = auto.update(FRAME, features);
        if (next !== null) switches.push(from + i * FRAME);
      }
    };
    run(20, 0.8, true, 0); // loud from the start: no drop
    run(12, 0.1, false, 20); // breakdown
    run(10, 0.9, true, 32); // the drop
    run(5, 0.1, false, 42); // a short break
    run(5, 0.9, true, 47); // too soon, and not after a long enough quiet stretch
    expect(switches).toHaveLength(1);
    expect(switches[0]).toBeGreaterThan(32);
    expect(switches[0]).toBeLessThan(33);
  });

  it('picks another preset at random, never the one shown, the same way from a snapshot', () => {
    const auto = director({ trigger: 'seconds', seconds: 5, order: 'random' }, 5, 2);
    let shown = 2;
    for (let i = 0; i < 60 * 60; i++) {
      const next = auto.update(FRAME, frame());
      if (next === null) continue;
      expect(next).not.toBe(shown);
      shown = next;
    }
    const copy = director({ trigger: 'seconds', seconds: 5, order: 'random' }, 5, 0);
    copy.restoreState(auto.saveState());
    const a: (number | null)[] = [];
    const b: (number | null)[] = [];
    for (let i = 0; i < 60 * 30; i++) {
      a.push(auto.update(FRAME, frame()));
      b.push(copy.update(FRAME, frame()));
    }
    expect(b).toEqual(a);
  });

  it('does nothing while off or with fewer than two presets', () => {
    const off = director({ trigger: 'seconds', seconds: 5, on: false });
    const alone = director({ trigger: 'seconds', seconds: 5 }, 1);
    for (let i = 0; i < 60 * 20; i++) {
      expect(off.update(FRAME, frame())).toBeNull();
      expect(alone.update(FRAME, frame())).toBeNull();
    }
  });

  it('takes all presets of the mode, or the favourites while there are two or more', () => {
    const builtIn = [
      { name: 'A', settings: 1 },
      { name: 'B', settings: 2 },
    ];
    const yours = [{ name: 'Mine', settings: 3 }];
    expect(switchingPool(builtIn, yours, ['B'], 'all')).toEqual([1, 2, 3]);
    expect(switchingPool(builtIn, yours, ['Mine', 'A'], 'favourites')).toEqual([1, 3]);
    // One favourite (or a name that is gone) is too few to switch between.
    expect(switchingPool(builtIn, yours, ['B', 'Deleted'], 'favourites')).toEqual([1, 2, 3]);
    expect(switchingPool(builtIn, yours, [], 'favourites')).toEqual([1, 2, 3]);
  });
});
