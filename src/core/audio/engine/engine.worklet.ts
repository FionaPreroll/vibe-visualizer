import { Analyzer } from '../../analysis/analyzer';
import type { TrackerRange } from '../../analysis/beat-tracker';
import { FeatureTimelineWriter } from '../../analysis/feature-timeline';
import { F } from '../../analysis/features';
import { GridBeats } from '../../analysis/grid-beats';
import type { TrackLoudness } from '../../analysis/track-loudness';
import { DspCore } from '../dsp/dsp-core';
import type { SoundSettings } from '../dsp/sound-settings';
import { AudioRingConsumer } from '../ring-buffer';
import { SignalsmithStretch } from '../stretch/signalsmith-stretch';
import { EngineControl } from './engine-control';

export interface EngineProcessorOptions {
  ring: SharedArrayBuffer;
  control: SharedArrayBuffer;
  timeline: SharedArrayBuffer;
}

/** Messages from the main thread to the engine. */
export type EngineMessage =
  | { type: 'sound'; settings: SoundSettings }
  | { type: 'nudge'; factor: number }
  /** The tempo range of the live beat tracking (AN-12, TMP-06); null for its own. */
  | { type: 'tempo-range'; range: TrackerRange | null }
  /** The beat grid of the file with `token` and how loud it gets (null: forget them). */
  | {
      type: 'grid';
      token: number;
      beats: Float64Array | null;
      confidence: Float32Array | null;
      loudness: TrackLoudness | null;
    };

/** Messages from the engine to the main thread. */
export type EngineEvent =
  /** Playing a block or taking a message failed; the block stayed silent (NF-09). */
  { type: 'error'; message: string };

/** Beat grids and loudness kept (the playing file, the next ones, the one before). */
const KEEP_GRIDS = 6;
/** Errors are reported once a second at most: a failing block repeats 375 times a second. */
const ERROR_REPORT_SECONDS = 1;

/**
 * Plays the stream from the media worker through the sound chain (tempo, filter, delay, reverb,
 * limiter) and analyses the music between the filter and the delay. Paused, the music stops
 * but effect tails ring out, seeks still take effect, and the analysis goes on (the visuals calm
 * down). In live mode it analyses its input instead (IN-01); monitoring the input runs past the
 * worklet.
 *
 * A stream may run from one file into the next (gapless, PL-05): the worklet follows the file
 * boundaries the media worker records, for the position it publishes and for the beat grid.
 */
class EngineProcessor extends AudioWorkletProcessor {
  private readonly consumer: AudioRingConsumer;
  private readonly control: EngineControl;
  private readonly analyzer: Analyzer;
  private readonly timeline: FeatureTimelineWriter;
  private readonly dsp: DspCore;
  private music = [new Float32Array(128), new Float32Array(128)];
  private silence = new Float32Array(128);
  private generation = -1;
  /** Engine frame of this block's first frame, plus the delay until the music is heard. */
  private blockStart = 0;
  /** Stream frame and speed of this block's music, for the timeline. */
  private blockSource = 0;
  private blockRate = 0;
  /** Speed the analysis last heard: a change is passed on to the beat tracking. */
  private analysedRate = 1;
  /** The heard file: its token, the stream frame it starts at, and its own frame there. */
  private heardToken = 0;
  private heardOffset = 0;
  private heardBase = 0;
  /** The next file boundary of the stream (-1: none), the next file's token and its frame there. */
  private nextStart = -1;
  private nextToken = 0;
  private nextBase = 0;
  /** Beat grids of the files (AN-07), by token: they replace the live beat tracking. */
  private readonly grids = new Map<number, GridBeats>();
  /** How loud each file gets, by token: the analysis's auto-gain stays above its levels. */
  private readonly loudness = new Map<number, TrackLoudness>();
  private readonly onAnalysisFrame: (offset: number) => void;
  /** Context time from which the next error is reported. */
  private reportFrom = 0;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const { ring, control, timeline } = options.processorOptions as EngineProcessorOptions;
    this.consumer = new AudioRingConsumer(ring, 2);
    this.control = new EngineControl(control);
    this.analyzer = new Analyzer(sampleRate);
    this.timeline = new FeatureTimelineWriter(timeline);
    let stretch: SignalsmithStretch | null = null;
    try {
      stretch = new SignalsmithStretch(2, sampleRate);
    } catch (error) {
      console.error('Key lock is not available', error); // vinyl mode still works
    }
    this.dsp = new DspCore(sampleRate, stretch);
    this.port.onmessage = (event: MessageEvent<EngineMessage>) => {
      try {
        this.receive(event.data);
      } catch (error) {
        this.report(error);
      }
    };
    // Bound once: no allocation per analysis frame.
    this.onAnalysisFrame = (offset: number) => {
      // The music is ahead of what is heard: it may already be in the next file.
      const stream = this.blockSource + offset * this.blockRate;
      let token = this.heardToken;
      let frame = this.heardBase + stream - this.heardOffset;
      if (this.nextStart >= 0 && stream >= this.nextStart) {
        token = this.nextToken;
        frame = this.nextBase + stream - this.nextStart;
      }
      const seconds = frame / sampleRate;
      if (this.blockRate > 0) {
        this.grids.get(token)?.apply(this.analyzer.frame, seconds, this.blockRate);
      }
      // Live input comes from no file. The next frames are measured against this file's levels.
      const file = this.control.live ? 0 : token;
      this.analyzer.setLoudness(this.loudness.get(file) ?? null);
      this.timeline.write(this.blockStart + offset, seconds, this.analyzer.frame, file);
    };
  }

  private receive(message: EngineMessage): void {
    if (message.type === 'sound') {
      this.dsp.setSettings(message.settings);
    } else if (message.type === 'nudge') {
      this.dsp.nudge = message.factor;
    } else if (message.type === 'tempo-range') {
      this.analyzer.setTempoRange(message.range);
    } else {
      this.keepFile(message);
    }
  }

  /** The beat grid and the loudness of a file (null: forget them), of the last few files. */
  private keepFile(message: Extract<EngineMessage, { type: 'grid' }>): void {
    const { token } = message;
    this.grids.delete(token);
    this.loudness.delete(token);
    if (message.beats && message.confidence) {
      const beats = new GridBeats();
      beats.set({ beats: message.beats, confidence: message.confidence });
      this.grids.set(token, beats);
    }
    if (message.loudness) this.loudness.set(token, message.loudness);
    for (const kept of [this.grids, this.loudness]) {
      for (const key of kept.keys()) {
        if (kept.size <= KEEP_GRIDS) break;
        kept.delete(key);
      }
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    // An error would end the processor for good: the block stays silent instead, and the
    // engine goes on with the next one (NF-09).
    try {
      this.render(inputs, outputs);
    } catch (error) {
      for (const channel of outputs[0] ?? []) channel.fill(0);
      this.report(error);
    }
    return true;
  }

  private report(error: unknown): void {
    if (currentTime < this.reportFrom) return;
    this.reportFrom = currentTime + ERROR_REPORT_SECONDS;
    const message = error instanceof Error ? error.message : String(error);
    this.port.postMessage({ type: 'error', message } satisfies EngineEvent);
  }

  private render(inputs: Float32Array[][], outputs: Float32Array[][]): void {
    const output = outputs[0];
    if (!output || output.length === 0) return;
    const frames = output[0]!.length;
    if (this.music[0]!.length !== frames) {
      this.music = [new Float32Array(frames), new Float32Array(frames)];
    }
    const music = this.music;
    // A seek (or a new file) starts a new stream. While playing, the old one fades out under
    // it (a soft jump); the effects' tails carry on.
    if (this.consumer.switchPending && this.generation >= 0 && !this.control.live) {
      this.dsp.fadeOutStream(this.consumer);
    }
    const generation = this.consumer.syncGeneration();
    if (generation !== this.generation) {
      this.generation = generation;
      this.dsp.reset();
      this.heardToken = this.consumer.startToken;
      this.heardOffset = 0;
      this.heardBase = this.consumer.startFrame;
      // No beat hits across the jump.
      for (const beats of this.grids.values()) beats.set(beats.grid);
    }
    this.nextStart = this.consumer.nextStart;
    this.nextToken = this.consumer.nextToken;
    this.nextBase = this.consumer.nextBase;
    this.blockSource = this.dsp.musicPosition;
    if (this.control.live) {
      this.dsp.renderMusic(null, music, frames);
      this.analyseInput(inputs[0], frames);
    } else {
      const playing = !this.control.paused;
      this.dsp.renderMusic(this.consumer, music, frames, playing);
      if (playing && this.dsp.underrun) this.consumer.countUnderrun();
      const rate = this.dsp.playbackRate;
      if (playing && Math.abs(rate / this.analysedRate - 1) > 1e-4) {
        this.analyzer.scaleTempo(rate / this.analysedRate);
        this.analysedRate = rate;
      }
      this.blockStart = currentFrame + DspCore.EFFECTS_LATENCY;
      this.blockRate = playing ? this.dsp.playbackRate : 0;
      this.analyzer.process(music[0]!, music[1]!, frames, this.onAnalysisFrame);
      const frame = this.analyzer.frame;
      this.dsp.setBeat(frame[F.bpm]!, frame[F.beatConfidence]!);
    }
    this.dsp.renderEffects(music, frames);
    for (let c = 0; c < output.length; c++) output[c]!.set(music[Math.min(c, 1)]!);
    // Once the next file is heard, the position counts in it.
    const heard = this.dsp.sourcePosition;
    if (this.nextStart >= 0 && heard >= this.nextStart) {
      this.heardToken = this.nextToken;
      this.heardOffset = this.nextStart;
      this.heardBase = this.nextBase;
      this.consumer.passBoundary();
    }
    this.consumer.publish(
      this.heardBase + heard - this.heardOffset,
      currentTime + frames / sampleRate,
      this.heardToken,
      this.blockRate,
    );
    if (this.consumer.ended && heard >= this.consumer.takenFrames) this.consumer.markPlayedOut();
  }

  /** Live input: analyses the input (mono inputs count for both channels). */
  private analyseInput(input: Float32Array[] | undefined, frames: number) {
    if (this.silence.length !== frames) this.silence = new Float32Array(frames);
    const left = input?.[0] ?? this.silence;
    const right = input?.[1] ?? left;
    this.blockStart = currentFrame;
    this.blockRate = 0;
    this.analyzer.process(left, right, frames, this.onAnalysisFrame);
  }
}

registerProcessor('vibe-engine', EngineProcessor);
