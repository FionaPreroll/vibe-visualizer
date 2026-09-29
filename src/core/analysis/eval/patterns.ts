import { createPrng } from '../../util/prng';

/**
 * Drum patterns of different genres with known beats and bars, for measuring the tempo and bar
 * detection of the beat grid (AN-07): the tempo where genres like drum & bass tempt a tracker to
 * a related one (2/3 or 1/2 of it), and the downbeats. Each pattern has a kick, a snare or clap,
 * hi-hats and a bass that changes its note every bar, like a bass line would.
 */

export interface Pattern {
  name: string;
  sampleRate: number;
  bpm: number;
  left: Float32Array;
  right: Float32Array;
  /** Beat and downbeat times in seconds. */
  beats: number[];
  downbeats: number[];
}

/** Hits within a bar of four beats, in beats (0 = the downbeat). */
interface Groove {
  bpm: number;
  kick: number[];
  snare: number[];
  hat: number[];
  /** Quieter hats between (16ths), 0 for none. */
  ghostHats?: number;
  /** A sustained, low bass (like a reese) instead of short notes on the beats. */
  sustainedBass?: boolean;
  /** Loud synth stabs (a chord in the mids), e.g. every 1.5 beats, which suggest another tempo. */
  stabs?: number[];
}

export const GROOVES: Record<string, Groove> = {
  techno: {
    bpm: 128,
    kick: [0, 1, 2, 3],
    snare: [1, 3],
    hat: [0.5, 1.5, 2.5, 3.5],
    ghostHats: 0.3,
  },
  house: { bpm: 122, kick: [0, 1, 2, 3], snare: [1, 3], hat: [0.5, 1.5, 2.5, 3.5] },
  rock: { bpm: 118, kick: [0, 2, 2.5], snare: [1, 3], hat: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] },
  hiphop: { bpm: 92, kick: [0, 1.75, 2.5], snare: [1, 3], hat: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] },
  dnb: {
    bpm: 174,
    kick: [0, 2.5],
    snare: [1, 3],
    hat: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
    ghostHats: 0.35,
    sustainedBass: true,
  },
  jungle: {
    bpm: 166,
    kick: [0, 0.5, 2.5, 2.75],
    snare: [1, 1.75, 3],
    hat: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
    ghostHats: 0.3,
    sustainedBass: true,
  },
  'dnb-dotted': {
    bpm: 174,
    kick: [0, 2.5],
    snare: [1, 3],
    hat: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
    sustainedBass: true,
    stabs: [0, 1.5, 3],
  },
  hardcore: { bpm: 178, kick: [0, 1, 2, 3], snare: [1, 3], hat: [0.5, 1.5, 2.5, 3.5] },
  dubstep: {
    bpm: 140,
    kick: [0, 2.75],
    snare: [2],
    hat: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
    sustainedBass: true,
  },
};

const TWO_PI = 2 * Math.PI;

export function createPattern(name: string, bars = 16, sampleRate = 48000): Pattern {
  const groove = GROOVES[name];
  if (!groove) throw new Error(`Unknown pattern ${name}`);
  const beat = 60 / groove.bpm;
  const lead = 0.5;
  const frames = Math.ceil((lead + bars * 4 * beat + 1) * sampleRate);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const random = createPrng(7);
  const noise = () => random() * 2 - 1;

  const add = (start: number, length: number, gain: number, voice: (t: number) => number) => {
    const first = Math.round(start * sampleRate);
    for (let i = 0; i < Math.round(length * sampleRate) && first + i < frames; i++) {
      const value = voice(i / sampleRate) * gain;
      left[first + i]! += value;
      right[first + i]! += value;
    }
  };
  const kick = (t: number) => {
    const phase = TWO_PI * (45 * t + (105 / 30) * (1 - Math.exp(-30 * t)));
    return Math.sin(phase) * Math.exp(-t / 0.22) + (t < 0.003 ? noise() * 0.5 : 0);
  };
  let low = 0;
  const snare = (t: number) => {
    const n = noise();
    low += (n - low) * 0.2;
    return (n - low) * Math.exp(-t / 0.12) * 0.7 + Math.sin(TWO_PI * 190 * t) * Math.exp(-t / 0.06);
  };
  let previous = 0;
  const hat = (t: number) => {
    const n = noise();
    const high = n - previous;
    previous = n;
    return high * Math.exp(-t / 0.035);
  };

  const beats: number[] = [];
  const downbeats: number[] = [];
  const notes = [41.2, 49, 36.7, 43.65];
  for (let bar = 0; bar < bars; bar++) {
    const start = lead + bar * 4 * beat;
    downbeats.push(start);
    for (let b = 0; b < 4; b++) beats.push(start + b * beat);
    for (const at of groove.kick) add(start + at * beat, 0.5, 0.9, kick);
    for (const at of groove.snare) add(start + at * beat, 0.4, 0.55, snare);
    for (const at of groove.hat) add(start + at * beat, 0.12, 0.18, hat);
    for (const at of groove.stabs ?? []) {
      add(start + at * beat, 0.3, 0.5, (t) => {
        const chord =
          Math.sin(TWO_PI * 311 * t) + Math.sin(TWO_PI * 392 * t) + Math.sin(TWO_PI * 466 * t);
        return (chord / 3) * Math.exp(-t / 0.12);
      });
    }
    if (groove.ghostHats) {
      for (let at = 0.25; at < 4; at += 0.5)
        add(start + at * beat, 0.08, 0.18 * groove.ghostHats, hat);
    }
    // The bass changes its note on every downbeat.
    const frequency = notes[bar % notes.length]!;
    if (groove.sustainedBass) {
      add(start, 4 * beat, 0.35, (t) => {
        const detune = Math.sin(TWO_PI * frequency * t) + Math.sin(TWO_PI * frequency * 1.01 * t);
        return 0.5 * detune * Math.min(1, t / 0.02);
      });
    } else {
      for (const at of [0.5, 1.5, 2.5, 3.5]) {
        add(
          start + at * beat,
          beat * 0.4,
          0.3,
          (t) => Math.sin(TWO_PI * frequency * t) * Math.exp(-t / 0.15),
        );
      }
    }
  }
  return { name, sampleRate, bpm: groove.bpm, left, right, beats, downbeats };
}
