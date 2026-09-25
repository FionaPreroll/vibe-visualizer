import { exportNames, importNames, wasmBase64 } from 'virtual:signalsmith-stretch-wasm';
import { decodeBase64 } from '../../util/base64';
import { createPrng } from '../../util/prng';

/**
 * Minimal binding to the Signalsmith Stretch WebAssembly core (MIT).
 *
 * Works in every thread (main, worker, AudioWorklet): no fetch, no atob, synchronous
 * instantiation. The WASM randomness import is fed from a seeded PRNG, so equal input produces
 * bit-identical output in every thread — the basis for "export sounds exactly like live".
 *
 * Audio-thread rules: construct it outside the render loop and call {@link setMaxBlockFrames} up
 * front; {@link process} and {@link seek} do not allocate.
 */

type WasmFn = (...args: number[]) => number;

interface StretchExports {
  setBuffers: WasmFn;
  blockSamples: WasmFn;
  intervalSamples: WasmFn;
  inputLatency: WasmFn;
  outputLatency: WasmFn;
  reset: WasmFn;
  presetDefault: WasmFn;
  presetCheaper: WasmFn;
  configure: WasmFn;
  setTransposeSemitones: WasmFn;
  seek: WasmFn;
  process: WasmFn;
  flush: WasmFn;
}

let compiledModule: WebAssembly.Module | null = null;

function getModule(): WebAssembly.Module {
  compiledModule ??= new WebAssembly.Module(decodeBase64(wasmBase64));
  return compiledModule;
}

export type StretchPreset = 'default' | 'cheaper';

export interface StretchOptions {
  preset?: StretchPreset;
  /** Largest number of input or output frames per call (default 2048). */
  maxBlockFrames?: number;
  /** Seed for the WASM randomness import (default 1). */
  seed?: number;
}

export class SignalsmithStretch {
  readonly channels: number;
  readonly sampleRate: number;
  private readonly fn: StretchExports;
  private readonly memory: WebAssembly.Memory;
  private heap: Float32Array;
  private inputPointers: number[] = [];
  private outputPointers: number[] = [];
  private blockCapacity = 0;

  constructor(channels: number, sampleRate: number, options: StretchOptions = {}) {
    this.channels = channels;
    this.sampleRate = sampleRate;

    const random = createPrng(options.seed ?? 1);
    let memory: WebAssembly.Memory | null = null;
    const heapBytes = () => new Uint8Array(memory!.buffer);
    const runtime: Record<string, (...args: number[]) => number | void> = {
      _random_get: (pointer, size) => {
        const bytes = heapBytes();
        for (let i = 0; i < size; i++) bytes[pointer + i] = (random() * 256) | 0;
        return 0;
      },
      _emscripten_resize_heap: (requestedSize) => {
        const requested = requestedSize >>> 0;
        const current = memory!.buffer.byteLength;
        const target = Math.min(2 ** 31, Math.max(requested, Math.ceil(current * 1.5)));
        try {
          memory!.grow(Math.ceil((target - current) / 65536));
          return 1;
        } catch {
          return 0;
        }
      },
      __emscripten_memcpy_js: (dest, src, count) => {
        heapBytes().copyWithin(dest, src, src + count);
      },
      __abort_js: () => {
        throw new Error('Signalsmith Stretch: WASM abort');
      },
    };

    const module = getModule();
    const nameOfImport: Record<string, string> = {};
    for (const [name, minified] of Object.entries(importNames)) nameOfImport[minified] = name;
    const imports: Record<string, Record<string, WebAssembly.ImportValue>> = {};
    for (const { module: moduleName, name } of WebAssembly.Module.imports(module)) {
      const implementation = runtime[nameOfImport[name] ?? ''];
      if (!implementation) throw new Error(`Signalsmith Stretch: unknown import ${name}`);
      (imports[moduleName] ??= {})[name] = implementation;
    }

    const instance = new WebAssembly.Instance(module, imports);
    const exported = (name: string) => {
      const value = instance.exports[exportNames[name] ?? ''];
      if (value === undefined) throw new Error(`Signalsmith Stretch: missing export ${name}`);
      return value;
    };
    memory = exported('memory') as WebAssembly.Memory;
    this.memory = memory;
    (exported('__wasm_call_ctors') as WasmFn)();

    const fn = (name: string) => exported(name) as WasmFn;
    this.fn = {
      setBuffers: fn('_setBuffers'),
      blockSamples: fn('_blockSamples'),
      intervalSamples: fn('_intervalSamples'),
      inputLatency: fn('_inputLatency'),
      outputLatency: fn('_outputLatency'),
      reset: fn('_reset'),
      presetDefault: fn('_presetDefault'),
      presetCheaper: fn('_presetCheaper'),
      configure: fn('_configure'),
      setTransposeSemitones: fn('_setTransposeSemitones'),
      seek: fn('_seek'),
      process: fn('_process'),
      flush: fn('_flush'),
    };

    if (options.preset === 'cheaper') this.fn.presetCheaper(channels, sampleRate);
    else this.fn.presetDefault(channels, sampleRate);
    this.heap = new Float32Array(memory.buffer);
    this.setMaxBlockFrames(options.maxBlockFrames ?? 2048);
  }

  /** Input latency in frames: how much input the algorithm looks ahead. */
  get inputLatency(): number {
    return this.fn.inputLatency();
  }

  /** Output latency in frames. */
  get outputLatency(): number {
    return this.fn.outputLatency();
  }

  /** (Re)allocates the transfer buffers. Allocates — do not call from the audio thread. */
  setMaxBlockFrames(frames: number): void {
    const pointer = this.fn.setBuffers(this.channels, frames);
    this.blockCapacity = frames;
    this.inputPointers = [];
    this.outputPointers = [];
    for (let c = 0; c < this.channels; c++) {
      this.inputPointers.push((pointer >> 2) + frames * c);
      this.outputPointers.push((pointer >> 2) + frames * (c + this.channels));
    }
    this.refreshHeap();
  }

  /** Pitch shift in semitones (0 = key lock). `tonalityHz` limits the tonal processing range. */
  setTransposeSemitones(semitones: number, tonalityHz = 8000): void {
    this.fn.setTransposeSemitones(semitones, tonalityHz / this.sampleRate);
  }

  reset(): void {
    this.fn.reset();
  }

  /**
   * Consumes `inputFrames` from `input` (at `inputOffset`) and writes `outputFrames` to `output`.
   * The ratio of the two sets the stretch factor. Input beyond an array's end is read as silence.
   */
  process(
    input: readonly Float32Array[],
    inputOffset: number,
    inputFrames: number,
    output: readonly Float32Array[],
    outputFrames: number,
  ): void {
    this.checkBlock(inputFrames, outputFrames);
    this.copyIn(input, inputOffset, inputFrames);
    this.fn.process(inputFrames, outputFrames);
    this.copyOut(output, outputFrames);
  }

  /** Feeds `frames` of pre-roll ending at the new position, e.g. after a jump. */
  seek(input: readonly Float32Array[], inputOffset: number, frames: number, rate: number): void {
    this.checkBlock(frames, 0);
    this.copyIn(input, inputOffset, frames);
    this.fn.seek(frames, rate);
  }

  private checkBlock(inputFrames: number, outputFrames: number): void {
    if (inputFrames > this.blockCapacity || outputFrames > this.blockCapacity) {
      throw new Error(`Signalsmith Stretch: block larger than ${this.blockCapacity} frames`);
    }
  }

  private refreshHeap(): void {
    if (this.heap.buffer !== this.memory.buffer) this.heap = new Float32Array(this.memory.buffer);
  }

  private copyIn(input: readonly Float32Array[], offset: number, frames: number): void {
    this.refreshHeap();
    const heap = this.heap;
    for (let c = 0; c < this.channels; c++) {
      const source = input[c] ?? input[0]!;
      const base = this.inputPointers[c]!;
      const available = Math.max(0, Math.min(frames, source.length - offset));
      for (let i = 0; i < available; i++) heap[base + i] = source[offset + i]!;
      for (let i = available; i < frames; i++) heap[base + i] = 0;
    }
  }

  private copyOut(output: readonly Float32Array[], frames: number): void {
    this.refreshHeap();
    const heap = this.heap;
    for (let c = 0; c < output.length; c++) {
      const target = output[c]!;
      const base = this.outputPointers[Math.min(c, this.channels - 1)]!;
      for (let i = 0; i < frames; i++) target[i] = heap[base + i]!;
    }
  }
}
