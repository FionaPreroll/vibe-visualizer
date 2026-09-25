import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';
import { RatePlayer, type TempoMode } from '../../core/audio/rate-player';
import {
  SignalsmithStretch,
  type StretchPreset,
} from '../../core/audio/stretch/signalsmith-stretch';
import { createTestSignal } from '../../core/audio/test-signal';
import { hashFloat32 } from '../../core/util/hash';
import { exposeWorker, withTransfer } from '../../core/util/worker-rpc';

/** Same block size as an AudioWorklet render quantum, so worker and worklet match bit for bit. */
const BLOCK = 128;

function renderPlayer(player: RatePlayer, frames: number): Float32Array[] {
  const output = [new Float32Array(frames), new Float32Array(frames)];
  const block = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  for (let done = 0; done < frames; done += BLOCK) {
    const count = Math.min(BLOCK, frames - done);
    player.render(block, count);
    output[0]!.set(block[0]!.subarray(0, count), done);
    output[1]!.set(block[1]!.subarray(0, count), done);
  }
  return output;
}

export interface BenchmarkResult {
  rate: number;
  realtimeFactor: number;
  cpuPercent: number;
}

/** Time-stretches `seconds` of the test signal and measures the processing speed. */
function benchmark(args: {
  seconds: number;
  rate: number;
  sampleRate: number;
  preset: StretchPreset;
}): BenchmarkResult {
  const input = createTestSignal(args.seconds * args.rate + 1, args.sampleRate);
  const player = new RatePlayer(
    input,
    new SignalsmithStretch(2, args.sampleRate, { preset: args.preset }),
  );
  player.rate = args.rate;
  const frames = Math.round(args.seconds * args.sampleRate);
  const started = performance.now();
  renderPlayer(player, frames);
  const elapsed = (performance.now() - started) / 1000;
  const realtimeFactor = args.seconds / elapsed;
  return { rate: args.rate, realtimeFactor, cpuPercent: 100 / realtimeFactor };
}

export interface RenderResult {
  hash: string;
  left: Float32Array;
  right: Float32Array;
}

/** Renders like the AudioWorklet would, for the bit-exactness comparison. */
function render(args: {
  planes: Float32Array[];
  rate: number;
  mode: TempoMode;
  frames: number;
  sampleRate: number;
}) {
  const player = new RatePlayer(args.planes, new SignalsmithStretch(2, args.sampleRate));
  player.rate = args.rate;
  player.mode = args.mode;
  const [left, right] = renderPlayer(player, args.frames) as [Float32Array, Float32Array];
  const result: RenderResult = { hash: hashFloat32(left, right), left, right };
  return withTransfer(result, [left.buffer, right.buffer]);
}

/** Decodes up to `maxSeconds` of a file into (shared, if possible) planar buffers. */
async function decodeFile(args: { file: File; maxSeconds: number }) {
  const input = new Input({ source: new BlobSource(args.file), formats: ALL_FORMATS });
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error('The file contains no audio track');
  const sampleRate = track.sampleRate;
  const frames = Math.round(args.maxSeconds * sampleRate);
  const shared = globalThis.crossOriginIsolated === true;
  const planes = [0, 1].map(() =>
    shared ? new Float32Array(new SharedArrayBuffer(frames * 4)) : new Float32Array(frames),
  ) as [Float32Array, Float32Array];
  let written = 0;
  for await (const sample of new AudioSampleSink(track).samples(0, args.maxSeconds)) {
    const count = Math.min(sample.numberOfFrames, frames - written);
    for (let c = 0; c < 2; c++) {
      const plane = Math.min(c, sample.numberOfChannels - 1);
      sample.copyTo(planes[c]!.subarray(written, written + count), {
        planeIndex: plane,
        format: 'f32-planar',
        frameCount: count,
      });
    }
    written += count;
    sample.close();
    if (written >= frames) break;
  }
  input.dispose();
  const trimmed = planes.map((plane) => plane.subarray(0, written));
  return { planes: trimmed, sampleRate, seconds: written / sampleRate };
}

exposeWorker({ benchmark, render, decodeFile });
