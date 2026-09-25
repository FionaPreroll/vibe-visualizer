/**
 * Layout of one analysis frame: a flat Float32Array, so frames can live in shared memory and be
 * read by the renderer without copying or allocation.
 */

export const SPECTRUM_BANDS = 64;
export const WAVEFORM_POINTS = 128;

export const BAND_NAMES = ['sub', 'bass', 'lowMid', 'mid', 'highMid', 'treble'] as const;
export type BandName = (typeof BAND_NAMES)[number];

/** Frequency ranges of the six energy bands, in Hz. */
export const BAND_RANGES: Record<BandName, readonly [number, number]> = {
  sub: [20, 60],
  bass: [60, 250],
  lowMid: [250, 500],
  mid: [500, 2000],
  highMid: [2000, 4000],
  treble: [4000, 16000],
};

/** Float offsets within a frame. All values are normalised to 0…1 unless noted. */
export const F = {
  /** Log-spaced spectrum, 30 Hz – 16 kHz, auto-gained. */
  spectrum: 0,
  /** Energy per band, in {@link BAND_NAMES} order, auto-gained. */
  bands: SPECTRUM_BANDS,
  /** Overall loudness, auto-gained. */
  energy: SPECTRUM_BANDS + 6,
  /** RMS of the last hop, linear (not auto-gained). */
  rms: SPECTRUM_BANDS + 7,
  /** Peak of the last hop, linear (not auto-gained). */
  peak: SPECTRUM_BANDS + 8,
  /** Drum envelopes: 1 at the onset of a detected hit, then decaying. */
  kick: SPECTRUM_BANDS + 9,
  snare: SPECTRUM_BANDS + 10,
  hat: SPECTRUM_BANDS + 11,
  /** 1 in the frame where a hit was detected, else 0. */
  kickHit: SPECTRUM_BANDS + 12,
  snareHit: SPECTRUM_BANDS + 13,
  hatHit: SPECTRUM_BANDS + 14,
  /** Beat envelope: 1 on each beat, then decaying. */
  beat: SPECTRUM_BANDS + 15,
  /** 1 in the frame of a beat, else 0. */
  beatHit: SPECTRUM_BANDS + 16,
  /** Position within the current beat: 0 on the beat, rising to 1 just before the next. */
  beatPhase: SPECTRUM_BANDS + 17,
  /** Tempo in beats per minute (not normalised). */
  bpm: SPECTRUM_BANDS + 18,
  /** How clearly the music follows the tracked beat, 0…1. */
  beatConfidence: SPECTRUM_BANDS + 19,
  /** Time-domain snapshot (mono, −1…1) for oscilloscope-style elements. */
  waveform: SPECTRUM_BANDS + 20,
  size: SPECTRUM_BANDS + 20 + WAVEFORM_POINTS,
} as const;

/** Fields that mark events: never interpolated between frames. */
export const HIT_FIELDS: readonly number[] = [F.kickHit, F.snareHit, F.hatHit, F.beatHit];
