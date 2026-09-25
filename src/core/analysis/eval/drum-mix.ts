import { createPrng } from '../../util/prng';

/**
 * A deliberately hard synthetic EDM arrangement with known drum onsets, for measuring the onset
 * detectors and the beat tracker. Traps for the detectors: an offbeat sub bass in the kick band,
 * sidechain pumping, claps with pre-bursts, open hats and a crash, a vocal-like synth in the
 * breakdown, and a noise riser with a snare roll in the build-up.
 *
 * Sections (124 BPM, 18 bars): intro (hats, pad) · groove (claps with a snare body) ·
 * breakdown (no drums) · build-up (snare roll, then a roll of thin claps without a body, and a
 * riser) · drop (thin claps).
 */

export interface DrumMix {
  sampleRate: number;
  bpm: number;
  left: Float32Array;
  right: Float32Array;
  /** Onset times in seconds. */
  kicks: number[];
  snares: number[];
  hats: number[];
  /** Time ranges with a steady four-on-the-floor kick. */
  grooveRanges: [number, number][];
}

type Voice = (t: number) => number;

const TWO_PI = 2 * Math.PI;

export function createDrumMix(sampleRate = 48000): DrumMix {
  const bpm = 124;
  const beat = 60 / bpm;
  const bar = beat * 4;
  const bars = 18;
  const frames = Math.ceil((bars * bar + 1.5) * sampleRate);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const random = createPrng(42);
  const noise = () => random() * 2 - 1;

  const kicks: number[] = [];
  const snares: number[] = [];
  const hats: number[] = [];

  /** Renders `voice` from `start` for `length` seconds at `gain`, panned −1…1. */
  const add = (start: number, length: number, gain: number, pan: number, voice: Voice) => {
    const first = Math.round(start * sampleRate);
    const count = Math.round(length * sampleRate);
    const gainLeft = gain * Math.cos(((pan + 1) * Math.PI) / 4);
    const gainRight = gain * Math.sin(((pan + 1) * Math.PI) / 4);
    for (let i = 0; i < count && first + i < frames; i++) {
      const value = voice(i / sampleRate) * sidechain((first + i) / sampleRate, voice);
      left[first + i]! += value * gainLeft;
      right[first + i]! += value * gainRight;
    }
  };

  // Voices that get ducked by the kick (sidechain).
  const ducked = new Set<Voice>();
  const sidechain = (time: number, voice: Voice) => {
    if (!ducked.has(voice)) return 1;
    let last = -Infinity;
    for (const kick of kicks) {
      if (kick > time) break;
      last = kick;
    }
    const since = time - last;
    return since < 0 ? 1 : 1 - 0.75 * Math.exp(-since / 0.11);
  };

  // --- Instruments -------------------------------------------------------------------------

  const kick = (): Voice => {
    let previous = 0;
    return (t) => {
      // Pitch drops from 180 Hz to 50 Hz within about 25 ms.
      const phase = TWO_PI * (50 * t + (180 - 50) * 0.012 * (1 - Math.exp(-t / 0.012)));
      const body = Math.sin(phase) * Math.exp(-t / 0.22);
      const n = noise();
      const click = t < 0.004 ? (n - previous) * 0.35 * (1 - t / 0.004) : 0;
      previous = n;
      return body + click;
    };
  };

  const bass =
    (frequency: number, length: number): Voice =>
    (t) => {
      const envelope = Math.min(1, t / 0.004) * (t < length ? 1 : Math.exp(-(t - length) / 0.02));
      return (
        (Math.sin(TWO_PI * frequency * t) +
          0.35 * Math.sin(2 * TWO_PI * frequency * t) +
          0.1 * Math.sin(3 * TWO_PI * frequency * t)) *
        envelope
      );
    };

  /** Two-pole resonant band-pass on noise (state-variable filter). */
  const bandNoise = (center: (t: number) => number, q: number): Voice => {
    let low = 0;
    let band = 0;
    return (t) => {
      const f = 2 * Math.sin((Math.PI * Math.min(center(t), sampleRate / 6)) / sampleRate);
      const high = noise() - low - band / q;
      band += f * high;
      low += f * band;
      return band;
    };
  };

  /** Clap: noise bursts and a tail; `body` adds a snare-like 200 Hz tone (the drop has none). */
  const clap = (body = true): Voice => {
    const texture = bandNoise(() => 1800, 1.2);
    return (t) => {
      const bursts = t < 0.03 ? Math.exp(-(t % 0.01) / 0.003) : 0;
      const tail = Math.exp(-Math.max(0, t - 0.02) / 0.14);
      const tone = body ? 0.4 * Math.sin(TWO_PI * 200 * t) * Math.exp(-t / 0.05) : 0;
      return texture(t) * (bursts + tail) * 1.4 + tone;
    };
  };

  const hat = (decay: number): Voice => {
    let previous = 0;
    let previous2 = 0;
    return (t) => {
      const n = noise();
      const high = n - 2 * previous + previous2; // second difference: strongly high-passed
      previous2 = previous;
      previous = n;
      return high * 0.5 * Math.exp(-t / decay);
    };
  };

  const pad = (): Voice => (t) => {
    const attack = Math.min(1, t / 0.4);
    let sum = 0;
    for (const f of [110, 220, 261.63, 329.63]) {
      sum += Math.sin(TWO_PI * f * t) + 0.3 * Math.sin(TWO_PI * 2.003 * f * t);
    }
    return (sum / 6) * attack;
  };

  const vocal =
    (frequency: number, length: number): Voice =>
    (t) => {
      const envelope = Math.min(1, t / 0.008) * (t < length ? 1 : Math.exp(-(t - length) / 0.04));
      let sum = 0;
      for (let h = 1; h <= 14; h++) {
        const f = h * frequency;
        const formant =
          Math.exp(-(((f - 750) / 250) ** 2)) + 0.7 * Math.exp(-(((f - 1150) / 300) ** 2));
        sum += ((formant + 0.05) * Math.sin(TWO_PI * f * t)) / h;
      }
      return sum * envelope;
    };

  // --- Arrangement ------------------------------------------------------------------------

  const barStart = (index: number) => 0.5 + index * bar;
  const groove = [...range(2, 10), ...range(14, 18)];
  const grooveRanges: [number, number][] = [
    [barStart(2), barStart(10)],
    [barStart(14), barStart(18)],
  ];

  // Kicks first: the sidechain needs their times.
  for (const index of groove) {
    for (let b = 0; b < 4; b++) kicks.push(barStart(index) + b * beat);
  }
  kicks.sort((a, b) => a - b);
  for (const time of kicks) add(time, 0.6, 0.9, 0, kick());

  // Offbeat sub bass in the groove and drop.
  const bassNotes = [55, 55, 65.41, 49];
  for (const index of groove) {
    for (let b = 0; b < 4; b++) {
      const voice = bass(bassNotes[b]!, beat * 0.42);
      ducked.add(voice);
      add(barStart(index) + b * beat + beat / 2, beat * 0.5, 0.55, 0, voice);
    }
  }

  // Pad across everything except the build-up, sidechained.
  for (const [from, to] of [
    [0, 12],
    [14, 18],
  ] as const) {
    const voice = pad();
    ducked.add(voice);
    add(barStart(from), barStart(to) - barStart(from), 0.14, 0, voice);
  }

  // Claps on 2 and 4.
  for (const index of groove) {
    for (const b of [1, 3]) {
      const time = barStart(index) + b * beat;
      snares.push(time);
      add(time, 0.5, 0.45, 0.1, clap(index < 14));
    }
  }

  // Hi-hats: closed 8ths (intro, groove), 16ths in the drop, open hat on the "and" of 4.
  for (const index of [0, 1, ...range(2, 10), ...range(14, 18)]) {
    const sixteenths = index >= 14;
    const steps = sixteenths ? 16 : 8;
    for (let s = 0; s < steps; s++) {
      const time = barStart(index) + (s * bar) / steps;
      const onKick = s % (steps / 4) === 0 && index >= 2;
      if (onKick && !sixteenths) continue; // closed hats on offbeats only
      const open = !sixteenths && s === 7 && index >= 2;
      hats.push(time);
      add(
        time,
        open ? 0.6 : 0.15,
        (sixteenths && s % 2 === 1 ? 0.6 : 1) * 0.35,
        -0.3,
        hat(open ? 0.22 : 0.025),
      );
    }
  }

  // Crashes at the breakdown and the drop.
  for (const index of [10, 14]) {
    hats.push(barStart(index));
    add(barStart(index), 2.5, 0.3, 0.3, hat(1.2));
  }

  // Breakdown: vocal-like synth with syncopated notes.
  const melody: [number, number, number][] = [
    [0, 440, 0.6],
    [0.75, 392, 0.4],
    [1.5, 523.25, 0.6],
    [2.5, 440, 0.4],
    [3.25, 349.23, 0.5],
    [4, 440, 0.6],
    [4.75, 587.33, 0.4],
    [5.5, 523.25, 0.9],
    [6.75, 392, 0.5],
  ];
  for (const [position, frequency, length] of melody) {
    add(barStart(10) + position * beat, length + 0.2, 0.22, -0.1, vocal(frequency, length));
  }

  // Build-up: snare roll (8ths, then 16ths) and a rising noise sweep.
  for (let s = 0; s < 8; s++) {
    const time = barStart(12) + (s * bar) / 8;
    snares.push(time);
    add(time, 0.3, 0.3 + s * 0.01, 0.1, clap());
  }
  for (let s = 0; s < 16; s++) {
    const time = barStart(13) + (s * bar) / 16;
    snares.push(time);
    add(time, 0.2, 0.34 + s * 0.01, 0.1, clap(false));
  }
  const riser = bandNoise((t) => 400 * 15 ** (t / (2 * bar)), 2);
  add(barStart(12), 2 * bar, 1, 0, (t) => riser(t) * (0.02 + 0.2 * (t / (2 * bar)) ** 2));

  kicks.sort((a, b) => a - b);
  snares.sort((a, b) => a - b);
  hats.sort((a, b) => a - b);
  return { sampleRate, bpm, left, right, kicks, snares, hats, grooveRanges };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, i) => from + i);
}
