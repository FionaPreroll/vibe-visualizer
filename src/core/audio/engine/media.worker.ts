import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  Input,
  type AudioSample,
  type InputAudioTrack,
} from 'mediabunny';
import { sleep } from '../../util/format';
import { exposeWorker } from '../../util/worker-rpc';
import { Resampler } from '../resampler';
import { AudioRingProducer } from '../ring-buffer';

/**
 * Streams the current file into the engine ring: decodes in pieces (Mediabunny + WebCodecs),
 * converts to the engine rate and stays a few seconds ahead of playback. Every seek starts a
 * new ring generation; the AudioWorklet drops older audio within one render quantum.
 */

export interface LoadResult {
  generation: number;
  duration: number;
  sampleRate: number;
  channels: number;
  codec: string;
}

let producer: AudioRingProducer | null = null;
let engineRate = 48000;
let input: Input | null = null;
let track: InputAudioTrack | null = null;
let sink: AudioSampleSink | null = null;
let resampler: Resampler | null = null;
let trackChannels = 2;
let streamToken = 0;

function init(args: { ring: SharedArrayBuffer; channels: number; sampleRate: number }) {
  producer = new AudioRingProducer(args.ring, args.channels);
  engineRate = args.sampleRate;
}

function ring(): AudioRingProducer {
  if (!producer) throw new Error('Media worker not initialised');
  return producer;
}

/** Copies up to two channels of `sample`, from frame `skip` on. */
function toPlanes(sample: AudioSample, skip: number): Float32Array[] {
  const frames = sample.numberOfFrames - skip;
  const planes: Float32Array[] = [];
  for (let c = 0; c < trackChannels; c++) {
    const plane = new Float32Array(frames);
    sample.copyTo(plane, {
      planeIndex: c,
      format: 'f32-planar',
      frameOffset: skip,
      frameCount: frames,
    });
    planes.push(plane);
  }
  return planes;
}

/** Writes all frames, waiting while the ring is full. False if a newer stream took over. */
async function writeAll(planes: Float32Array[], token: number): Promise<boolean> {
  const frames = planes[0]?.length ?? 0;
  let offset = 0;
  while (offset < frames) {
    if (token !== streamToken) return false;
    offset += ring().write(planes, offset, frames - offset);
    if (offset < frames) await sleep(20);
  }
  return token === streamToken;
}

async function stream(startFrame: number, generation: number, token: number): Promise<void> {
  const rate = track!.sampleRate;
  let nextInputFrame = resampler ? resampler.reset(startFrame) : startFrame;
  for await (const sample of sink!.samples(nextInputFrame / rate)) {
    if (token !== streamToken) {
      sample.close();
      return;
    }
    const sampleStart = Math.round(sample.timestamp * rate);
    const skip = Math.max(0, nextInputFrame - sampleStart);
    if (skip >= sample.numberOfFrames) {
      sample.close();
      continue;
    }
    const planes = toPlanes(sample, skip);
    nextInputFrame = sampleStart + sample.numberOfFrames;
    sample.close();
    const converted = resampler ? resampler.push(planes, planes[0]!.length) : planes;
    if (!(await writeAll(converted, token))) return;
  }
  if (resampler && !(await writeAll(resampler.flush(), token))) return;
  if (token === streamToken) ring().markEnded(generation);
}

/** Starts a new generation at `seconds` and streams from there. */
async function startStream(seconds: number): Promise<number> {
  const token = ++streamToken;
  const startFrame = Math.max(0, Math.round(seconds * engineRate));
  const generation = ring().beginGeneration(startFrame);
  const started = performance.now();
  while (!ring().isAcknowledged(generation)) {
    if (performance.now() - started > 3000) throw new Error('The audio engine is not running');
    await sleep(1);
  }
  if (sink) {
    void stream(startFrame, generation, token).catch((error: unknown) => {
      // A replaced stream fails when its file is closed; only the current one matters.
      if (token !== streamToken) return;
      console.error('Streaming failed', error);
      ring().markEnded(generation);
    });
  } else {
    ring().markEnded(generation);
  }
  return generation;
}

async function load(args: { file: File; startSeconds: number }): Promise<LoadResult> {
  streamToken++;
  input?.dispose();
  input = new Input({ source: new BlobSource(args.file), formats: ALL_FORMATS });
  track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error('The file contains no audio track');
  if (!(await track.canDecode())) {
    throw new Error(`This browser cannot decode ${track.codec ?? 'this audio format'}`);
  }
  sink = new AudioSampleSink(track);
  trackChannels = Math.min(2, track.numberOfChannels);
  resampler =
    track.sampleRate === engineRate
      ? null
      : new Resampler(trackChannels, track.sampleRate, engineRate);
  const duration = (await input.getDurationFromMetadata()) ?? (await input.computeDuration());
  const generation = await startStream(args.startSeconds);
  return {
    generation,
    duration,
    sampleRate: track.sampleRate,
    channels: track.numberOfChannels,
    codec: track.codec ?? 'unknown',
  };
}

async function seek(args: { seconds: number }): Promise<number> {
  return startStream(args.seconds);
}

/** Stops streaming and empties the ring. */
async function unload(): Promise<void> {
  streamToken++;
  input?.dispose();
  input = null;
  track = null;
  sink = null;
  resampler = null;
  await startStream(0);
}

exposeWorker({ init, load, seek, unload });
