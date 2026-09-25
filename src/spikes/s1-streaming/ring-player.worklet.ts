import { AudioRingConsumer } from '../../core/audio/ring-buffer';

/** Plays whatever the media worker writes into the shared ring buffer. */
class RingPlayerProcessor extends AudioWorkletProcessor {
  private readonly consumer: AudioRingConsumer;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const { sab, channels } = options.processorOptions as {
      sab: SharedArrayBuffer;
      channels: number;
    };
    this.consumer = new AudioRingConsumer(sab, channels);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (output && output.length > 0) {
      this.consumer.read(output, output[0]!.length, currentTime, sampleRate);
    }
    return true;
  }
}

registerProcessor('s1-ring-player', RingPlayerProcessor);
