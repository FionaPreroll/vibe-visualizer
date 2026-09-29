import { dryGain, hasSignal, SILENCE, wetGain } from './dsp-util';

/**
 * Stereo delay (FX-02): time in milliseconds or synced to the beat, feedback with a tone filter,
 * ping-pong, wet/dry. Parameter changes glide, a new delay time crossfades to the new tap, and
 * switching it off lets the echoes ring out (FX-03). Allocation-free after construction.
 */

/** Longest delay time (seconds); synced times above it are halved until they fit. */
export const MAX_DELAY_SECONDS = 2.5;
const SMOOTHING = 0.03;
/** Crossfade to a new delay time (seconds). */
const CROSSFADE = 0.05;
/** A new time counts only if it differs by more than this ratio (beat tempo jitter). */
const TIME_TOLERANCE = 0.01;
/** Tone filter cutoffs at the far ends of the knob (Hz). */
const DARK_END = 1200;
const THIN_END = 1500;

export interface DelayParameters {
  on: boolean;
  /** Delay time (seconds). */
  seconds: number;
  feedback: number;
  /** −1 darker … 0 neutral … +1 thinner. */
  tone: number;
  pingPong: boolean;
  /** 0 dry … 1 wet. */
  mix: number;
}

export class StereoDelay {
  readonly parameters: DelayParameters = {
    on: false,
    seconds: 0.35,
    feedback: 0.35,
    tone: 0,
    pingPong: true,
    mix: 0.3,
  };

  private readonly mask: number;
  private readonly lines: Float64Array[];
  private readonly smoothing: number;
  private readonly crossfadeFrames: number;
  private write = 0;
  /** Current tap (frames) and the tap faded out during a crossfade. */
  private tap = 1;
  private previousTap = 1;
  private crossfade = 0;
  private input = 0;
  private feedback = 0;
  private dry = 1;
  private wet = 0;
  private dark = 0;
  private thin = 0;
  /** Tone filter memory: low-pass state per channel, then high-pass state per channel. */
  private readonly tone = new Float64Array(4);
  private quietFrames = 0;
  private idle = true;

  constructor(private readonly sampleRate: number) {
    const size = 2 ** Math.ceil(Math.log2(MAX_DELAY_SECONDS * sampleRate + 1));
    this.mask = size - 1;
    this.lines = [new Float64Array(size), new Float64Array(size)];
    this.smoothing = 1 - Math.exp(-1 / (SMOOTHING * sampleRate));
    this.crossfadeFrames = Math.round(CROSSFADE * sampleRate);
    this.snap();
  }

  /** Jumps to the current parameters without gliding (the start of an export). */
  snap(): void {
    const p = this.parameters;
    this.input = p.on ? 1 : 0;
    this.feedback = p.feedback;
    this.dry = p.on ? dryGain(p.mix) : 1;
    this.wet = wetGain(p.mix);
    this.dark = Math.max(0, -p.tone);
    this.thin = Math.max(0, p.tone);
    this.tap = this.targetTap();
    this.crossfade = 0;
  }

  /** True while the delay is on or its echoes are still ringing. */
  get active(): boolean {
    return !this.idle;
  }

  /** Adds the echoes to two planes in place. */
  process(planes: readonly Float32Array[], frames: number): void {
    const p = this.parameters;
    const left = planes[0]!;
    const right = planes[1]!;
    if (this.idle) {
      if (!p.on || !hasSignal(left, right, frames)) return;
      // Starts from silence: nothing left over from an earlier use.
      for (const line of this.lines) line.fill(0);
      this.tone.fill(0);
      this.snap();
      this.idle = false;
      this.quietFrames = 0;
    }
    const tap = this.targetTap();
    if (this.crossfade === 0 && Math.abs(tap - this.tap) > this.tap * TIME_TOLERANCE) {
      this.previousTap = this.tap;
      this.tap = tap;
      this.crossfade = this.crossfadeFrames;
    }
    const inputTarget = p.on ? 1 : 0;
    const dryTarget = p.on ? dryGain(p.mix) : 1;
    const wetTarget = wetGain(p.mix);
    const feedbackTarget = p.feedback;
    const darkTarget = Math.max(0, -p.tone);
    const thinTarget = Math.max(0, p.tone);
    const s = this.smoothing;
    const lineLeft = this.lines[0]!;
    const lineRight = this.lines[1]!;
    const mask = this.mask;
    const tone = this.tone;
    const radians = (2 * Math.PI) / this.sampleRate;
    let peak = 0;
    let inputPeak = 0;
    for (let i = 0; i < frames; i++) {
      this.input += (inputTarget - this.input) * s;
      this.dry += (dryTarget - this.dry) * s;
      this.wet += (wetTarget - this.wet) * s;
      this.feedback += (feedbackTarget - this.feedback) * s;
      this.dark += (darkTarget - this.dark) * s;
      this.thin += (thinTarget - this.thin) * s;
      // The echo, crossfading from the old tap after a time change.
      const write = this.write;
      let echoLeft = lineLeft[(write - this.tap) & mask]!;
      let echoRight = lineRight[(write - this.tap) & mask]!;
      if (this.crossfade > 0) {
        const fade = this.crossfade / this.crossfadeFrames;
        echoLeft += (lineLeft[(write - this.previousTap) & mask]! - echoLeft) * fade;
        echoRight += (lineRight[(write - this.previousTap) & mask]! - echoRight) * fade;
        this.crossfade--;
      }
      // Tone filter in the feedback path: a one-pole low-pass (darker) that is transparent at
      // 0, and a one-pole high-pass (thinner) that starts from silence when it comes in.
      let backLeft = echoLeft;
      let backRight = echoRight;
      if (this.dark > 1e-6) {
        const cutoff = 20000 * (DARK_END / 20000) ** this.dark;
        const a = 1 - Math.exp(-radians * cutoff);
        tone[0] = tone[0]! + (echoLeft - tone[0]!) * a;
        tone[1] = tone[1]! + (echoRight - tone[1]!) * a;
        backLeft = tone[0]!;
        backRight = tone[1]!;
      } else {
        tone[0] = echoLeft;
        tone[1] = echoRight;
      }
      if (this.thin > 1e-6) {
        const cutoff = 20 * (THIN_END / 20) ** this.thin;
        const a = 1 - Math.exp(-radians * cutoff);
        tone[2] = tone[2]! + (backLeft - tone[2]!) * a;
        tone[3] = tone[3]! + (backRight - tone[3]!) * a;
        backLeft -= tone[2]!;
        backRight -= tone[3]!;
      } else {
        tone[2] = 0;
        tone[3] = 0;
      }
      const dryLeft = left[i]!;
      const dryRight = right[i]!;
      const input = Math.max(Math.abs(dryLeft), Math.abs(dryRight));
      if (input > inputPeak) inputPeak = input;
      if (p.pingPong) {
        // The input enters on the left; every echo crosses to the other side.
        lineLeft[write] = this.input * 0.5 * (dryLeft + dryRight) + this.feedback * backRight;
        lineRight[write] = this.feedback * backLeft;
      } else {
        lineLeft[write] = this.input * dryLeft + this.feedback * backLeft;
        lineRight[write] = this.input * dryRight + this.feedback * backRight;
      }
      this.write = (write + 1) & mask;
      left[i] = this.dry * dryLeft + this.wet * echoLeft;
      right[i] = this.dry * dryRight + this.wet * echoRight;
      const level = Math.max(Math.abs(echoLeft), Math.abs(echoRight));
      if (level > peak) peak = level;
    }
    // Switched off (or nothing coming in): once the echoes have died away, go idle.
    if ((p.on ? inputPeak < SILENCE : this.input < 1e-4) && peak < SILENCE) {
      this.quietFrames += frames;
      if (this.quietFrames > Math.max(this.tap, this.previousTap) + this.crossfadeFrames) {
        this.idle = true;
      }
    } else {
      this.quietFrames = 0;
    }
  }

  private targetTap(): number {
    let seconds = Math.max(0.001, this.parameters.seconds);
    while (seconds > MAX_DELAY_SECONDS) seconds /= 2;
    return Math.max(1, Math.round(seconds * this.sampleRate));
  }
}
