import type { BeatGrid } from '../../analysis/beat-grid';
import type { TrackLoudness } from '../../analysis/track-loudness';
import type { TrackerRange } from '../../analysis/beat-tracker';
import { createFeatureTimeline, FeatureTimelineReader } from '../../analysis/feature-timeline';
import { WorkerClient } from '../../util/worker-rpc';
import { DEFAULT_SOUND, type SoundSettings } from '../dsp/sound-settings';
import { AudioRingMonitor, createAudioRing } from '../ring-buffer';
import { createEngineControl, EngineControl } from './engine-control';
import type { EngineMessage, EngineProcessorOptions } from './engine.worklet';
import workletUrl from './engine.worklet.ts?worker&url';
import type { LoadResult, NextFile } from './media.worker';
import MediaWorker from './media.worker.ts?worker';

export type { LoadResult, NextFile };

/**
 * Main-thread face of the audio engine. The engine always runs at 48 kHz: files are converted
 * in the media worker, so tracks with different sample rates can follow each other and the
 * export can use the same code.
 *
 * The sound chain (tempo and effects) runs in the engine's AudioWorklet; the master volume
 * comes after it.
 *
 * Live input (IN-01…04): an input stream goes through the input gain into the engine, which
 * then analyses it instead of the file; a monitor branch (off by default) plays it.
 */
export class AudioEngine {
  static readonly SAMPLE_RATE = 48000;

  /** Analysis frames of what is being played (read them at {@link audibleFrame}). */
  readonly timeline: FeatureTimelineReader;
  private readonly ringBuffer = createAudioRing(2, AudioEngine.SAMPLE_RATE * 4);
  private readonly monitor = new AudioRingMonitor(this.ringBuffer, 2);
  private readonly controlBuffer = createEngineControl();
  private readonly control = new EngineControl(this.controlBuffer);
  /** Shared memory behind {@link timeline}, for readers in other threads (the renderer). */
  readonly timelineBuffer = createFeatureTimeline(1024);
  private readonly media = new WorkerClient(new MediaWorker());
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private inputGain: GainNode | null = null;
  private monitorGain: GainNode | null = null;
  private input: MediaStreamAudioSourceNode | null = null;
  private starting: Promise<void> | null = null;
  private volumeLevel = 1;
  private inputGainDb = 0;
  private monitoring = false;
  private soundSettings: SoundSettings = DEFAULT_SOUND;
  private nudgeFactor = 1;
  private trackerRange: TrackerRange | null = null;
  private offset = 0;

  constructor() {
    this.timeline = new FeatureTimelineReader(this.timelineBuffer);
    this.control.paused = true;
    void this.media.call('init', {
      ring: this.ringBuffer,
      channels: 2,
      sampleRate: AudioEngine.SAMPLE_RATE,
    });
  }

  get started(): boolean {
    return this.context !== null;
  }

  /**
   * Creates the AudioContext. Browsers only allow audio after a user gesture, so call this from
   * a click or key handler the first time.
   */
  start(): Promise<void> {
    this.starting ??= this.create().catch((error: unknown) => {
      this.starting = null;
      throw error;
    });
    return this.starting;
  }

  private async create(): Promise<void> {
    const context = new AudioContext({
      sampleRate: AudioEngine.SAMPLE_RATE,
      latencyHint: 'interactive',
    });
    void context.resume();
    await context.audioWorklet.addModule(workletUrl);
    const options: EngineProcessorOptions = {
      ring: this.ringBuffer,
      control: this.controlBuffer,
      timeline: this.timelineBuffer,
    };
    const node = new AudioWorkletNode(context, 'vibe-engine', {
      numberOfInputs: 1,
      outputChannelCount: [2],
      processorOptions: options,
    });
    const gain = context.createGain();
    gain.gain.value = this.volumeLevel;
    node.connect(gain).connect(context.destination);
    // Live input: input gain → engine (analysis) and → monitor → volume → speakers.
    const inputGain = context.createGain();
    inputGain.gain.value = dbToGain(this.inputGainDb);
    const monitorGain = context.createGain();
    monitorGain.gain.value = this.monitoring ? 1 : 0;
    inputGain.connect(node);
    inputGain.connect(monitorGain).connect(gain);
    this.context = context;
    this.node = node;
    this.post({ type: 'sound', settings: this.soundSettings });
    if (this.nudgeFactor !== 1) this.post({ type: 'nudge', factor: this.nudgeFactor });
    if (this.trackerRange) this.post({ type: 'tempo-range', range: this.trackerRange });
    this.gain = gain;
    this.inputGain = inputGain;
    this.monitorGain = monitorGain;
  }

  /** True while the engine analyses a live input instead of a file. */
  get live(): boolean {
    return this.input !== null;
  }

  /**
   * Makes `stream` the source (IN-01): the file pauses and the engine analyses the stream.
   * Call {@link start} first.
   */
  connectInput(stream: MediaStream): void {
    const context = this.context;
    if (!context || !this.inputGain) throw new Error('The audio engine is not running');
    this.disconnectInput();
    this.paused = true;
    this.input = context.createMediaStreamSource(stream);
    this.input.connect(this.inputGain);
    this.control.live = true;
    void context.resume();
  }

  /** Back to the file as the source (the stream itself is stopped by its owner). */
  disconnectInput(): void {
    this.control.live = false;
    this.input?.disconnect();
    this.input = null;
  }

  /** Gain of the live input in dB (IN-03). */
  get inputGainDecibels(): number {
    return this.inputGainDb;
  }

  set inputGainDecibels(value: number) {
    this.inputGainDb = value;
    if (this.inputGain && this.context) {
      this.inputGain.gain.setTargetAtTime(dbToGain(value), this.context.currentTime, 0.015);
    }
  }

  /** Hearing the live input through the app (IN-04); off by default to avoid feedback. */
  get monitorInput(): boolean {
    return this.monitoring;
  }

  set monitorInput(value: boolean) {
    this.monitoring = value;
    if (this.monitorGain && this.context) {
      this.monitorGain.gain.setTargetAtTime(value ? 1 : 0, this.context.currentTime, 0.015);
    }
  }

  /** Tempo and effects (TMP, FX). */
  get sound(): SoundSettings {
    return this.soundSettings;
  }

  set sound(settings: SoundSettings) {
    this.soundSettings = settings;
    this.post({ type: 'sound', settings });
  }

  /**
   * The tempo range of the live beat tracking, for live input and for files without a beat
   * grid yet (AN-12, TMP-06); null for its own (75–180 BPM around 120).
   */
  get tempoRange(): TrackerRange | null {
    return this.trackerRange;
  }

  set tempoRange(range: TrackerRange | null) {
    const same =
      range === this.trackerRange ||
      (range !== null &&
        this.trackerRange !== null &&
        range.min === this.trackerRange.min &&
        range.max === this.trackerRange.max &&
        range.prior === this.trackerRange.prior &&
        range.octaves === this.trackerRange.octaves);
    if (same) return;
    this.trackerRange = range;
    this.post({ type: 'tempo-range', range });
  }

  /** Temporary speed change on top of the tempo (TMP-03): 1 = none. */
  get nudge(): number {
    return this.nudgeFactor;
  }

  set nudge(factor: number) {
    this.nudgeFactor = factor;
    this.post({ type: 'nudge', factor });
  }

  /**
   * The beat grid of the file with `token` (AN-07) and how loud it gets: while it plays, the
   * analysis takes its beats from the grid, and its auto-gain does not go below the file's
   * levels. Null forgets them.
   */
  setFileAnalysis(token: number, grid: BeatGrid | null, loudness: TrackLoudness | null): void {
    this.post({
      type: 'grid',
      token,
      beats: grid?.beats ?? null,
      confidence: grid?.confidence ?? null,
      loudness,
    });
  }

  /**
   * How much later the sound is heard than the browser reports, in seconds (AN-06): the visuals
   * follow {@link outputClock}, which counts it in. Live input is unaffected (it is heard
   * directly).
   */
  get syncOffset(): number {
    return this.offset;
  }

  set syncOffset(seconds: number) {
    this.offset = seconds;
  }

  /** The output latency the browser reports in seconds (null before {@link start}). */
  get reportedLatency(): number | null {
    const context = this.context;
    return context ? context.baseLatency + (context.outputLatency || 0) : null;
  }

  /** The audio clock (seconds); 0 before {@link start}. */
  get contextTime(): number {
    return this.context?.currentTime ?? 0;
  }

  /**
   * A short tick at context time `at`, next to the music (for the sync calibration); it goes
   * through the volume.
   */
  beep(at: number): void {
    const context = this.context;
    if (!context || !this.gain) return;
    const tone = context.createOscillator();
    tone.frequency.value = 1500;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(0.5, at + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
    tone.connect(envelope).connect(this.gain);
    tone.start(at);
    tone.stop(at + 0.07);
    tone.onended = () => envelope.disconnect();
  }

  private post(message: EngineMessage): void {
    this.node?.port.postMessage(message);
  }

  /**
   * Opens `file` as the file with `token` and positions it at `startSeconds` (paused state is
   * unchanged); it plays to `end` seconds (its out marker; null: its end). `next` follows it
   * without a gap (PL-05). A newer load or seek meanwhile makes it fail.
   */
  async load(
    file: File,
    startSeconds: number,
    token: number,
    end: number | null = null,
    next: NextFile | null = null,
  ): Promise<LoadResult> {
    await this.start();
    return this.media.call<LoadResult>('load', { file, startSeconds, token, end, next });
  }

  /**
   * Jumps to `seconds` in `file` (known by `token`), to play to `end`; `next` follows it
   * without a gap.
   */
  async seek(
    seconds: number,
    token: number,
    file: File,
    end: number | null = null,
    next: NextFile | null = null,
  ): Promise<void> {
    await this.start();
    await this.media.call('seek', { seconds, token, file, end, next });
  }

  /**
   * Moves where the playing file with `token` ends (seconds; null: at its end). False when it
   * comes too late: the stream is already past the new end, or cuts at the old one.
   */
  async setEnd(token: number, end: number | null): Promise<boolean> {
    if (!this.started) return true;
    return this.media.call<boolean>('setEnd', { token, end });
  }

  /**
   * What follows the file with token `after` without a gap (PL-05); null: nothing, the stream
   * ends there. At the end of a file the stream waits for this. False when it comes too late:
   * the stream is already past that file.
   */
  async queueNext(after: number, next: NextFile | null): Promise<boolean> {
    if (!this.started) return true;
    return this.media.call<boolean>('queueNext', { after, next });
  }

  /** Token of the file being heard: it changes when a queued file follows without a gap. */
  get heardToken(): number {
    return this.monitor.heardToken;
  }

  /** Stops streaming and silences the output. */
  async unload(): Promise<void> {
    if (!this.started) return;
    await this.media.call('unload');
  }

  get paused(): boolean {
    return this.control.paused;
  }

  set paused(value: boolean) {
    this.control.paused = value;
    if (!value) void this.context?.resume();
  }

  get volume(): number {
    return this.volumeLevel;
  }

  set volume(value: number) {
    this.volumeLevel = value;
    if (this.gain && this.context) {
      this.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.015);
    }
  }

  /** Playback position in seconds (of the audio being rendered right now). */
  get position(): number {
    return this.monitor.position / AudioEngine.SAMPLE_RATE;
  }

  /** True when the current stream has been played to its end. */
  get ended(): boolean {
    return this.monitor.isEnded();
  }

  /**
   * Engine frame that is audible right now: the time to look analysis frames up at. With live
   * input the music is heard directly, so the newest analysis frame is shown.
   */
  audibleFrame(): number {
    if (this.live) return Math.max(0, this.timeline.latestEngineFrame());
    const clock = this.outputClock();
    if (!clock) return 0;
    const now = performance.timeOrigin + performance.now();
    return (clock.contextTime + (now - clock.performanceTime) / 1000) * AudioEngine.SAMPLE_RATE;
  }

  /**
   * A pair of matching times: `contextTime` (seconds on the audio clock) is being heard at
   * `performanceTime` (milliseconds since the epoch, `performance.timeOrigin + now()`, so that
   * workers with their own time origin can use it). It counts in the latency the browser
   * reports and the {@link syncOffset}. Null before {@link start}.
   */
  outputClock(): { contextTime: number; performanceTime: number } | null {
    const context = this.context;
    if (!context) return null;
    const stamp = context.getOutputTimestamp();
    if (
      stamp.contextTime !== undefined &&
      stamp.performanceTime !== undefined &&
      stamp.performanceTime > 0
    ) {
      return {
        contextTime: stamp.contextTime - this.offset,
        performanceTime: performance.timeOrigin + stamp.performanceTime,
      };
    }
    const latency = context.baseLatency + (context.outputLatency || 0);
    return {
      contextTime: context.currentTime - latency - this.offset,
      performanceTime: performance.timeOrigin + performance.now(),
    };
  }

  async dispose(): Promise<void> {
    this.disconnectInput();
    this.media.terminate();
    await this.context?.close();
  }
}

function dbToGain(db: number): number {
  return 10 ** (db / 20);
}
