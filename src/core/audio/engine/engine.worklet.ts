import { Analyzer } from '../../analysis/analyzer';
import { FeatureTimelineWriter } from '../../analysis/feature-timeline';
import { AudioRingConsumer } from '../ring-buffer';
import { EngineControl } from './engine-control';

export interface EngineProcessorOptions {
  ring: SharedArrayBuffer;
  control: SharedArrayBuffer;
  timeline: SharedArrayBuffer;
}

/**
 * Plays the stream from the media worker and analyses exactly what is played. Paused, it
 * outputs silence but still accepts seeks, and keeps analysing (the visuals calm down).
 */
class EngineProcessor extends AudioWorkletProcessor {
  private readonly consumer: AudioRingConsumer;
  private readonly control: EngineControl;
  private readonly analyzer: Analyzer;
  private readonly timeline: FeatureTimelineWriter;
  private blockStart = 0;
  private blockFrames = 0;
  private playing = false;
  private readonly onAnalysisFrame: (offset: number) => void;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const { ring, control, timeline } = options.processorOptions as EngineProcessorOptions;
    this.consumer = new AudioRingConsumer(ring, 2);
    this.control = new EngineControl(control);
    this.analyzer = new Analyzer(sampleRate);
    this.timeline = new FeatureTimelineWriter(timeline);
    // Bound once: no allocation per analysis frame.
    this.onAnalysisFrame = (offset: number) => {
      const position = this.playing
        ? this.consumer.positionFrames - (this.blockFrames - offset)
        : this.consumer.positionFrames;
      this.timeline.write(this.blockStart + offset, position / sampleRate, this.analyzer.frame);
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const frames = output[0]!.length;
    this.playing = !this.control.paused;
    if (this.playing) {
      this.consumer.read(output, frames, currentTime, sampleRate);
    } else {
      this.consumer.syncGeneration();
      for (let c = 0; c < output.length; c++) output[c]!.fill(0);
    }
    this.blockStart = currentFrame;
    this.blockFrames = frames;
    this.analyzer.process(output[0]!, output[1] ?? output[0]!, frames, this.onAnalysisFrame);
    return true;
  }
}

registerProcessor('vibe-engine', EngineProcessor);
