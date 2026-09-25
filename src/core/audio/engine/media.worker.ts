import { ALL_FORMATS, BlobSource, Input, type InputAudioTrack } from 'mediabunny';
import { sleep } from '../../util/format';
import { exposeWorker } from '../../util/worker-rpc';
import { decodeAtRate } from '../decode-stream';
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
let resampler: Resampler | null = null;
let streamToken = 0;

function init(args: { ring: SharedArrayBuffer; channels: number; sampleRate: number }) {
  producer = new AudioRingProducer(args.ring, args.channels);
  engineRate = args.sampleRate;
}

function ring(): AudioRingProducer {
  if (!producer) throw new Error('Media worker not initialised');
  return producer;
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
  for await (const planes of decodeAtRate(track!, resampler, startFrame)) {
    if (token !== streamToken || !(await writeAll(planes, token))) return;
  }
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
  if (track) {
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
  resampler =
    track.sampleRate === engineRate
      ? null
      : new Resampler(Math.min(2, track.numberOfChannels), track.sampleRate, engineRate);
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
  resampler = null;
  await startStream(0);
}

exposeWorker({ init, load, seek, unload });
