import { Analyzer } from '../../analysis/analyzer';
import { FeatureTimelineWriter } from '../../analysis/feature-timeline';
import { F } from '../../analysis/features';
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
  { type: 'sound'; settings: SoundSettings } | { type: 'nudge'; factor: number };

/**
 * Plays the stream from the media worker through the sound chain (tempo, filter, delay, reverb,
 * limiter) and analyses the music between the filter and the delay. Paused, the music stops
 * but effect tails ring out, seeks still take effect, and the analysis goes on (the visuals calm
 * down). In live mode it analyses its input instead (IN-01); monitoring the input runs past the
 * worklet.
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
  /** Source frame (of the stream) and speed of this block's music, for the timeline. */
  private blockSource = 0;
  private blockRate = 0;
  /** Speed the analysis last heard: a change is passed on to the beat tracking. */
  private analysedRate = 1;
  private readonly onAnalysisFrame: (offset: number) => void;

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
    this.port.onmessage = (event: MessageEvent<EngineMessage>) => this.receive(event.data);
    // Bound once: no allocation per analysis frame.
    this.onAnalysisFrame = (offset: number) => {
      const source = this.consumer.startFrame + this.blockSource + offset * this.blockRate;
      this.timeline.write(this.blockStart + offset, source / sampleRate, this.analyzer.frame);
    };
  }

  private receive(message: EngineMessage): void {
    if (message.type === 'sound') this.dsp.setSettings(message.settings);
    else this.dsp.nudge = message.factor;
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const frames = output[0]!.length;
    if (this.music[0]!.length !== frames) {
      this.music = [new Float32Array(frames), new Float32Array(frames)];
    }
    const music = this.music;
    // A seek (or a new file) starts a new stream; the effects' tails carry on.
    const generation = this.consumer.syncGeneration();
    if (generation !== this.generation) {
      this.generation = generation;
      this.dsp.reset();
    }
    this.blockSource = this.dsp.musicPosition;
    if (this.control.live) {
      this.dsp.renderMusic(null, music, frames);
      this.analyseInput(inputs[0], frames);
    } else {
      const playing = !this.control.paused;
      this.dsp.renderMusic(playing ? this.consumer : null, music, frames);
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
    this.consumer.publish(this.dsp.sourcePosition, currentTime + frames / sampleRate);
    if (this.consumer.ended && this.dsp.sourcePosition >= this.consumer.takenFrames) {
      this.consumer.markPlayedOut();
    }
    return true;
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
