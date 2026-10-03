import { describe, expect, it } from 'vitest';
import { createTestSignal } from '../audio/test-signal';
import { hashFloat32 } from '../util/hash';
import { Analyzer } from './analyzer';
import { createPattern } from './eval/patterns';
import { F, SPECTRUM_BANDS } from './features';
import { LoudnessCollector, type TrackLoudness } from './track-loudness';

const RATE = 48000;

/** Runs the analyzer over stereo input in blocks and collects copies of all frames. */
function analyze(left: Float32Array, right: Float32Array, block: number): Float32Array[] {
  const analyzer = new Analyzer(RATE);
  const frames: Float32Array[] = [];
  for (let offset = 0; offset < left.length; offset += block) {
    const count = Math.min(block, left.length - offset);
    analyzer.process(left.subarray(offset), right.subarray(offset), count, () => {
      frames.push(analyzer.frame.slice());
    });
  }
  return frames;
}

describe('Analyzer', () => {
  it('emits one frame per hop', () => {
    const silence = new Float32Array(RATE);
    expect(analyze(silence, silence, 128)).toHaveLength(Math.floor(RATE / 512));
  });

  it('finds a 1 kHz tone in the right spectrum band and in the mid band', () => {
    const tone = Float32Array.from({ length: RATE }, (_, i) =>
      Math.sin((2 * Math.PI * 1000 * i) / RATE),
    );
    const last = analyze(tone, tone, 128).at(-1)!;
    const spectrum = Array.from(last.subarray(F.spectrum, F.spectrum + SPECTRUM_BANDS));
    const loudest = spectrum.indexOf(Math.max(...spectrum));
    const center = 30 * (16000 / 30) ** ((loudest + 0.5) / SPECTRUM_BANDS);
    expect(center).toBeGreaterThan(900);
    expect(center).toBeLessThan(1100);
    expect(last[F.bands + 3]).toBeGreaterThan(0.9); // mid
    expect(last[F.bands + 0]).toBeLessThan(0.1); // sub
  });

  it('detects kick, snare, hi-hat and beat of the 120 BPM test signal', () => {
    const [left, right] = createTestSignal(10, RATE) as [Float32Array, Float32Array];
    const frames = analyze(left, right, 128);
    const count = (offset: number) => frames.filter((f) => f[offset] === 1).length;
    expect(count(F.kickHit)).toBe(20);
    expect(count(F.snareHit)).toBe(10);
    expect(count(F.hatHit)).toBe(40);
    expect(count(F.beatHit)).toBeGreaterThanOrEqual(17); // 20 beats, the first ones unconfirmed
    const last = frames.at(-1)!;
    expect(last[F.bpm]).toBeCloseTo(120, 0);
    expect(last[F.beatConfidence]).toBeGreaterThan(0.5);
  });

  it('stays silent on silence', () => {
    const silence = new Float32Array(RATE * 3);
    const last = analyze(silence, silence, 128).at(-1)!;
    // Everything but the tempo and the beat position (which only mean something with confidence).
    last[F.bpm] = 0;
    last[F.beatPhase] = 0;
    expect(Math.max(...last)).toBe(0);
  });

  it('keeps a quiet intro quiet against the drop when the levels of the track are known', () => {
    // A techno groove at -24 dB, then the same at full level.
    const groove = createPattern('techno', 8, RATE);
    const length = groove.left.length;
    const track = [new Float32Array(2 * length), new Float32Array(2 * length)] as const;
    for (const [channel, source] of [groove.left, groove.right].entries()) {
      track[channel]!.set(source.map((sample) => sample * 0.06));
      track[channel]!.set(source, length);
    }
    const run = (levels: TrackLoudness | null) => {
      const analyzer = new Analyzer(RATE);
      analyzer.setLoudness(levels);
      const collector = new LoudnessCollector(analyzer);
      const frames: { at: number; low: number; kick: number; energy: number }[] = [];
      for (let offset = 0; offset < 2 * length; offset += 512) {
        const count = Math.min(512, 2 * length - offset);
        const [left, right] = track.map((channel) => channel.subarray(offset));
        analyzer.process(left!, right!, count, (done) => {
          collector.push();
          const frame = analyzer.frame;
          frames.push({
            at: (offset + done) / RATE,
            low: (frame[F.bands]! + frame[F.bands + 1]!) / 2,
            kick: frame[F.kick]!,
            energy: frame[F.energy]!,
          });
        });
      }
      const half = length / RATE;
      const part = (from: number, to: number) => {
        const list = frames.filter(({ at }) => at >= from && at < to);
        const mean = (key: 'low' | 'energy') =>
          list.reduce((sum, frame) => sum + frame[key], 0) / list.length;
        const kick = Math.max(...list.map((frame) => frame.kick));
        return { low: mean('low'), energy: mean('energy'), kick };
      };
      return { intro: part(2, half), drop: part(half + 1, 2 * half), levels: collector.finish() };
    };

    // The auto-gain alone makes the intro as big as the drop (live input keeps it that way).
    const alone = run(null);
    expect(alone.intro.low).toBeCloseTo(alone.drop.low, 1);
    expect(alone.intro.kick).toBeCloseTo(alone.drop.kick, 1);
    // With the levels of the whole track, the intro is as quiet as it sounds, the drop as before.
    const known = run(alone.levels);
    expect(known.intro.low).toBeLessThan(0.15);
    expect(known.intro.energy).toBeLessThan(0.3);
    expect(known.intro.kick).toBeLessThan(0.35);
    expect(known.drop.low).toBeCloseTo(alone.drop.low, 1);
    expect(known.drop.kick).toBeCloseTo(alone.drop.kick, 1);
    expect(known.drop.energy).toBeCloseTo(alone.drop.energy, 1);
  });

  it('is independent of the block size', () => {
    const [left, right] = createTestSignal(3, RATE) as [Float32Array, Float32Array];
    const small = analyze(left, right, 128);
    const large = analyze(left, right, 4096);
    expect(hashFloat32(...large)).toBe(hashFloat32(...small));
  });
});
