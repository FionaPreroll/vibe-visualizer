import { describe, expect, it } from 'vitest';
import { Analyzer } from './analyzer';
import { BAND_NAMES } from './features';
import { LoudnessCollector, sanitizeLoudness } from './track-loudness';

/** An analyzer whose last frame had the given levels. */
function measured(db: number, active = true): Analyzer {
  const analyzer = new Analyzer(48000);
  analyzer.loudestDb = db;
  analyzer.energyDb = db + 1;
  analyzer.bandDb.fill(db - 1);
  analyzer.active = active;
  return analyzer;
}

describe('track levels', () => {
  it('takes the level the loud parts reach, from the frames with sound', () => {
    const quiet = measured(-40);
    const loud = measured(-10);
    const silent = measured(-100, false);
    // Three quarters quiet, a quarter loud: the 95th percentile is in the loud part.
    const sources = [...Array<Analyzer>(600).fill(quiet), ...Array<Analyzer>(200).fill(loud)];
    let current = sources[0]!;
    const collector = new LoudnessCollector(
      new Proxy({} as Analyzer, { get: (_, key) => current[key as keyof Analyzer] }),
    );
    for (const source of [...sources, ...Array<Analyzer>(5000).fill(silent)]) {
      current = source;
      collector.push();
    }
    const levels = collector.finish()!;
    expect(levels.spectrum).toBeCloseTo(-10, 0);
    expect(levels.energy).toBeCloseTo(-9, 0);
    expect(levels.bands).toHaveLength(BAND_NAMES.length);
    expect(levels.bands[0]).toBeCloseTo(-11, 0);
  });

  it('says nothing about a file with too little sound', () => {
    const collector = new LoudnessCollector(measured(-10));
    for (let i = 0; i < 100; i++) collector.push();
    expect(collector.finish()).toBeNull();
  });

  it('checks stored levels', () => {
    const levels = { spectrum: -12, energy: -3, bands: [-5, -2, -30, -28, -25, -18] };
    expect(sanitizeLoudness(JSON.parse(JSON.stringify(levels)))).toEqual(levels);
    expect(sanitizeLoudness(null)).toBeNull();
    expect(sanitizeLoudness({ ...levels, bands: [-5] })).toBeNull();
    expect(sanitizeLoudness({ ...levels, energy: 'loud' })).toBeNull();
    expect(sanitizeLoudness({ ...levels, spectrum: Number.NaN })).toBeNull();
  });
});
