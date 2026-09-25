import { createFeatureTimeline, FeatureTimelineReader } from '../../analysis/feature-timeline';
import { WorkerClient } from '../../util/worker-rpc';
import { AudioRingMonitor, createAudioRing } from '../ring-buffer';
import { createEngineControl, EngineControl } from './engine-control';
import type { EngineProcessorOptions } from './engine.worklet';
import workletUrl from './engine.worklet.ts?worker&url';
import type { LoadResult } from './media.worker';
import MediaWorker from './media.worker.ts?worker';

export type { LoadResult };

/**
 * Main-thread face of the audio engine. The engine always runs at 48 kHz: files are converted
 * in the media worker, so tracks with different sample rates can follow each other and the
 * export can use the same code.
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
  private gain: GainNode | null = null;
  private starting: Promise<void> | null = null;
  private volumeLevel = 1;

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
      numberOfInputs: 0,
      outputChannelCount: [2],
      processorOptions: options,
    });
    const gain = context.createGain();
    gain.gain.value = this.volumeLevel;
    node.connect(gain).connect(context.destination);
    this.context = context;
    this.gain = gain;
  }

  /** Opens `file` and positions it at `startSeconds` (paused state is unchanged). */
  async load(file: File, startSeconds = 0): Promise<LoadResult> {
    await this.start();
    return this.media.call<LoadResult>('load', { file, startSeconds });
  }

  async seek(seconds: number): Promise<void> {
    await this.start();
    await this.media.call('seek', { seconds });
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

  /** Engine frame that is audible right now: the time to look analysis frames up at. */
  audibleFrame(): number {
    const clock = this.outputClock();
    if (!clock) return 0;
    const now = performance.timeOrigin + performance.now();
    return (clock.contextTime + (now - clock.performanceTime) / 1000) * AudioEngine.SAMPLE_RATE;
  }

  /**
   * A pair of matching times: `contextTime` (seconds on the audio clock) is being heard at
   * `performanceTime` (milliseconds since the epoch, `performance.timeOrigin + now()`, so that
   * workers with their own time origin can use it). Null before {@link start}.
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
        contextTime: stamp.contextTime,
        performanceTime: performance.timeOrigin + stamp.performanceTime,
      };
    }
    const latency = context.baseLatency + (context.outputLatency || 0);
    return {
      contextTime: context.currentTime - latency,
      performanceTime: performance.timeOrigin + performance.now(),
    };
  }

  async dispose(): Promise<void> {
    this.media.terminate();
    await this.context?.close();
  }
}
