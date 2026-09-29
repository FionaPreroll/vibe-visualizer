import type { SignalsmithStretch } from '../stretch/signalsmith-stretch';
import { StereoDelay } from './delay';
import { DjFilter } from './dj-filter';
import { Limiter, LIMITER_LOOKAHEAD } from './limiter';
import { FdnReverb } from './reverb';
import { DEFAULT_SOUND, syncedDelaySeconds, type SoundSettings } from './sound-settings';
import { TempoStage, type TempoSource } from './tempo';

/**
 * The sound of the player (TMP, FX): tempo → DJ filter → delay → reverb → limiter. The same
 * code runs in the AudioWorklet and in the export, so an export sounds like playback (EX-02).
 *
 * It renders in two steps, and the analysis sits between them: the visuals react to the music
 * at its new tempo and with the filter, but before the echoes and the reverb tail, which would
 * blur the beat detection (and would feed the synced delay's own echoes back into its tempo).
 */

/** Beat tempo for synced delays until the analysis has found one. */
const DEFAULT_BPM = 120;
/** Beat confidence needed before a synced delay follows the detected tempo. */
const MIN_CONFIDENCE = 0.3;
/** Frames over which the music fades out on pause and in on resume (about 5 ms). */
const PAUSE_FADE = 256;
/** Frames over which the old stream fades out under the new one after a jump (8 ms). */
const JUMP_FADE = 384;

export class DspCore {
  /** Frames between the music (the analysis) and the output: the limiter's look-ahead. */
  static readonly EFFECTS_LATENCY = LIMITER_LOOKAHEAD;

  private readonly tempo: TempoStage;
  private readonly filter: DjFilter;
  private readonly delay: StereoDelay;
  private readonly reverb: FdnReverb;
  private readonly limiter: Limiter;
  private settings: SoundSettings = DEFAULT_SOUND;
  private bpm = DEFAULT_BPM;
  /** Level of the music: 0 while paused, 1 while playing, ramping in between. */
  private level = 1;
  /** The old stream's last milliseconds after a jump, fading out under the new one. */
  private readonly jumpTail = [new Float32Array(JUMP_FADE), new Float32Array(JUMP_FADE)];
  private jumpRead = JUMP_FADE;

  constructor(sampleRate: number, stretch: SignalsmithStretch | null) {
    this.tempo = new TempoStage(stretch);
    this.filter = new DjFilter(sampleRate);
    this.delay = new StereoDelay(sampleRate);
    this.reverb = new FdnReverb(sampleRate);
    this.limiter = new Limiter(sampleRate);
    this.setSettings(DEFAULT_SOUND);
  }

  setSettings(settings: SoundSettings): void {
    this.settings = settings;
    this.tempo.rate = settings.rate;
    this.tempo.mode = settings.tempoMode;
    this.filter.amount = settings.filter;
    this.filter.resonance = settings.filterResonance;
    const delay = this.delay.parameters;
    delay.on = settings.delayOn;
    delay.feedback = settings.delayFeedback;
    delay.tone = settings.delayTone;
    delay.pingPong = settings.delayPingPong;
    delay.mix = settings.delayMix;
    this.updateDelayTime();
    const reverb = this.reverb.parameters;
    reverb.on = settings.reverbOn;
    reverb.size = settings.reverbSize;
    reverb.decay = settings.reverbDecay;
    reverb.preDelay = settings.reverbPreDelay / 1000;
    reverb.damping = settings.reverbDamping;
    reverb.mix = settings.reverbMix;
  }

  /** Temporary speed change on top of the tempo (TMP-03), e.g. 1.04 while nudging. */
  set nudge(value: number) {
    this.tempo.nudge = value;
  }

  /** The beat tempo the analysis hears, for synced delays. */
  setBeat(bpm: number, confidence: number): void {
    if (confidence < MIN_CONFIDENCE || !(bpm >= 40 && bpm <= 300)) return;
    this.bpm = bpm;
    if (this.settings.delaySync) this.updateDelayTime();
  }

  /** Jumps to the current settings without gliding (the start of an export). */
  snap(): void {
    this.filter.snap();
    this.delay.snap();
    this.reverb.snap();
  }

  /** A new stream (a seek): the tempo stage starts over, effect tails keep ringing. */
  reset(): void {
    this.tempo.reset();
  }

  /**
   * A jump while playing: `source` still holds the old stream, which plays on for a few
   * milliseconds and fades out under the new one instead of stopping at once. Call it right
   * before {@link reset}.
   */
  fadeOutStream(source: TempoSource): void {
    if (this.level <= 0) return;
    const [left, right] = this.jumpTail as [Float32Array, Float32Array];
    this.tempo.process(source, this.jumpTail, JUMP_FADE);
    for (let i = 0; i < JUMP_FADE; i++) {
      const gain = this.level * Math.cos(((i + 0.5) / JUMP_FADE) * (Math.PI / 2));
      left[i]! *= gain;
      right[i]! *= gain;
    }
    this.jumpRead = 0;
  }

  /** Source frame of the stream that is heard at the start of the next block. */
  get sourcePosition(): number {
    return Math.max(0, this.tempo.sourcePosition - LIMITER_LOOKAHEAD * this.tempo.playbackRate);
  }

  /** Source frame of the stream at the start of the next block of music (the analysis). */
  get musicPosition(): number {
    return this.tempo.sourcePosition;
  }

  /** Speed of the last block, nudge included. */
  get playbackRate(): number {
    return this.tempo.playbackRate;
  }

  /** True if the last block of music ran short of source frames. */
  get underrun(): boolean {
    return this.tempo.underrun;
  }

  /** True while an effect is on or its tail still rings. */
  get effectsActive(): boolean {
    return this.delay.active || this.reverb.active;
  }

  /**
   * Step 1: the music at its tempo and through the filter, into `output` (two planes). Without
   * a source it is silence, and the filter's and effects' tails ring out. Paused (`playing`
   * false), the music fades out over a few milliseconds, taking them from `source`, and fades
   * in again on resume, so neither clicks.
   */
  renderMusic(
    source: TempoSource | null,
    output: readonly Float32Array[],
    frames: number,
    playing = true,
  ): void {
    const left = output[0]!;
    const right = output[1]!;
    const target = source && playing ? 1 : 0;
    if (source && (target > 0 || this.level > 0)) {
      this.tempo.process(source, output, frames);
      if (this.level !== target) {
        const step = 1 / PAUSE_FADE;
        let level = this.level;
        for (let i = 0; i < frames; i++) {
          level = target > level ? Math.min(target, level + step) : Math.max(target, level - step);
          left[i]! *= level;
          right[i]! *= level;
        }
        this.level = level;
      }
    } else {
      left.fill(0, 0, frames);
      right.fill(0, 0, frames);
      this.level = 0;
    }
    if (this.jumpRead < JUMP_FADE) {
      const count = Math.min(frames, JUMP_FADE - this.jumpRead);
      const [tailLeft, tailRight] = this.jumpTail as [Float32Array, Float32Array];
      for (let i = 0; i < count; i++) {
        left[i]! += tailLeft[this.jumpRead + i]!;
        right[i]! += tailRight[this.jumpRead + i]!;
      }
      this.jumpRead += count;
    }
    this.filter.process(output, frames);
  }

  /** Step 2, in place: delay, reverb and the safety limiter. */
  renderEffects(planes: readonly Float32Array[], frames: number): void {
    this.delay.process(planes, frames);
    this.reverb.process(planes, frames);
    this.limiter.process(planes, frames);
  }

  private updateDelayTime(): void {
    const settings = this.settings;
    this.delay.parameters.seconds = settings.delaySync
      ? syncedDelaySeconds(this.bpm, settings.delayDivision, settings.delayFeel)
      : settings.delayMs / 1000;
  }
}
