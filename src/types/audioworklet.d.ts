// Globals of the AudioWorkletGlobalScope. TypeScript ships no lib for it.

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

declare const currentFrame: number;
declare const currentTime: number;
declare const sampleRate: number;
