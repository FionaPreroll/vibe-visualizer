import { RatePlayer, type TempoMode } from '../../core/audio/rate-player';
import { SignalsmithStretch } from '../../core/audio/stretch/signalsmith-stretch';

export interface StretchPlayerOptions {
  planes: Float32Array[];
  rate: number;
  mode: TempoMode;
}

export type StretchPlayerMessage =
  | { type: 'rate'; value: number }
  | { type: 'mode'; value: TempoMode }
  | { type: 'seek'; frame: number };

/** Plays in-memory PCM through the shared RatePlayer (same code as the export path). */
class StretchPlayerProcessor extends AudioWorkletProcessor {
  private readonly player: RatePlayer;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const { planes, rate, mode } = options.processorOptions as StretchPlayerOptions;
    this.player = new RatePlayer(planes, new SignalsmithStretch(2, sampleRate));
    this.player.rate = rate;
    this.player.mode = mode;
    this.port.onmessage = (event: MessageEvent<StretchPlayerMessage>) => {
      const message = event.data;
      if (message.type === 'rate') this.player.rate = message.value;
      else if (message.type === 'mode') this.player.mode = message.value;
      else this.player.seek(message.frame);
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (output && output.length > 0) {
      if (this.player.ended) this.player.seek(0);
      this.player.render(output, output[0]!.length);
    }
    return true;
  }
}

registerProcessor('s2-stretch-player', StretchPlayerProcessor);
