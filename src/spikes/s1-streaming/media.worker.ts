import { ALL_FORMATS, AudioSampleSink, BlobSource, Input, type AudioSample } from 'mediabunny';
import { AudioRingProducer } from '../../core/audio/ring-buffer';
import { sleep } from '../../core/util/format';
import { exposeWorker } from '../../core/util/worker-rpc';

/**
 * Spike S1 media worker: decodes an audio file in pieces and keeps the ring buffer filled a few
 * seconds ahead of playback. Short caches at the cue points make cue jumps instant.
 */

export interface OpenResult {
  format: string;
  codec: string;
  sampleRate: number;
  channels: number;
  duration: number;
  durationSource: 'metadata' | 'computed';
  title: string | null;
  artist: string | null;
  hasCover: boolean;
  openMs: number;
}

export interface PlayResult {
  generation: number;
  ackMs: number;
  cached: boolean;
}

export interface DecodeBenchmarkResult {
  decodedSeconds: number;
  elapsedMs: number;
  realtimeFactor: number;
  firstTimestamp: number;
  frames: number;
}

interface CueCache {
  planes: Float32Array[];
  frames: number;
}

let input: Input | null = null;
let sink: AudioSampleSink | null = null;
let producer: AudioRingProducer | null = null;
let sampleRate = 48000;
let streamToken = 0;
const cueCaches = new Map<number, CueCache>();

/** Copies `sample` (from frame `skip` on) into new planar arrays. */
function toPlanes(sample: AudioSample, skip: number): { planes: Float32Array[]; frames: number } {
  const frames = Math.max(0, sample.numberOfFrames - skip);
  const planes: Float32Array[] = [];
  for (let c = 0; c < sample.numberOfChannels; c++) {
    const plane = new Float32Array(frames);
    if (frames > 0) {
      sample.copyTo(plane, {
        planeIndex: c,
        format: 'f32-planar',
        frameOffset: skip,
        frameCount: frames,
      });
    }
    planes.push(plane);
  }
  return { planes, frames };
}

/** Writes all frames, waiting while the ring is full. Returns false if the stream was replaced. */
async function writeAll(planes: Float32Array[], frames: number, token: number): Promise<boolean> {
  let offset = 0;
  while (offset < frames) {
    if (token !== streamToken) return false;
    offset += producer!.write(planes, offset, frames - offset);
    if (offset < frames) await sleep(15);
  }
  return true;
}

async function stream(start: number, generation: number, token: number, cache?: CueCache) {
  let from = start;
  if (cache) {
    if (!(await writeAll(cache.planes, cache.frames, token))) return;
    from = start + cache.frames / sampleRate;
  }
  for await (const sample of sink!.samples(from)) {
    if (token !== streamToken) {
      sample.close();
      return;
    }
    // The first sample may begin before the requested position: skip up to it.
    const skip = Math.max(0, Math.round((from - sample.timestamp) * sampleRate));
    const { planes, frames } = toPlanes(sample, Math.min(skip, sample.numberOfFrames));
    sample.close();
    if (!(await writeAll(planes, frames, token))) return;
  }
  if (token === streamToken) producer!.markEnded(generation);
}

async function open(args: { file: File; sab: SharedArrayBuffer; channels: number }) {
  const started = performance.now();
  input?.dispose();
  cueCaches.clear();
  streamToken++;
  input = new Input({ source: new BlobSource(args.file), formats: ALL_FORMATS });
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error('The file contains no audio track');
  if (!(await track.canDecode())) throw new Error(`This browser cannot decode ${track.codec}`);
  sink = new AudioSampleSink(track);
  sampleRate = track.sampleRate;
  producer = new AudioRingProducer(args.sab, args.channels);

  let duration = await input.getDurationFromMetadata();
  let durationSource: OpenResult['durationSource'] = 'metadata';
  if (duration === null) {
    duration = await input.computeDuration();
    durationSource = 'computed';
  }
  const tags = await input
    .getMetadataTags()
    .catch(() => ({}) as Awaited<ReturnType<Input['getMetadataTags']>>);
  const format = await input.getFormat();
  return {
    format: format.name,
    codec: track.codec ?? 'unknown',
    sampleRate,
    channels: track.numberOfChannels,
    duration,
    durationSource,
    title: tags.title ?? null,
    artist: tags.artist ?? null,
    hasCover: (tags.images?.length ?? 0) > 0,
    openMs: performance.now() - started,
  } satisfies OpenResult;
}

/** Pre-decodes `seconds` of audio at every cue position. */
async function cacheCues(args: { positions: number[]; seconds: number }) {
  const started = performance.now();
  for (const position of args.positions) {
    const planes: Float32Array[][] = [];
    let frames = 0;
    const wanted = Math.round(args.seconds * sampleRate);
    for await (const sample of sink!.samples(position, position + args.seconds + 0.5)) {
      const skip = Math.max(0, Math.round((position - sample.timestamp) * sampleRate));
      const part = toPlanes(sample, Math.min(skip, sample.numberOfFrames));
      sample.close();
      planes.push(part.planes);
      frames += part.frames;
      if (frames >= wanted) break;
    }
    const channels = planes[0]?.length ?? 1;
    const merged = Array.from(
      { length: channels },
      () => new Float32Array(Math.min(frames, wanted)),
    );
    let offset = 0;
    for (const part of planes) {
      const take = Math.min(part[0]!.length, merged[0]!.length - offset);
      for (let c = 0; c < channels; c++) merged[c]!.set(part[c]!.subarray(0, take), offset);
      offset += take;
    }
    cueCaches.set(position, { planes: merged, frames: offset });
  }
  return { elapsedMs: performance.now() - started };
}

/** Starts playback at `seconds` in a new ring generation. */
async function play(args: { seconds: number; useCache: boolean }): Promise<PlayResult> {
  const token = ++streamToken;
  const generation = producer!.beginGeneration(Math.round(args.seconds * sampleRate));
  const started = performance.now();
  // The AudioWorklet drops older frames within one render quantum.
  while (!producer!.isAcknowledged(generation)) {
    if (performance.now() - started > 2000) throw new Error('Audio engine did not respond');
    await sleep(1);
  }
  const ackMs = performance.now() - started;
  const cache = args.useCache ? cueCaches.get(args.seconds) : undefined;
  void stream(args.seconds, generation, token, cache).catch((error: unknown) => {
    console.error('Streaming failed', error);
  });
  return { generation, ackMs, cached: cache !== undefined };
}

function stop() {
  streamToken++;
}

/** Decodes the whole file as fast as possible (the basis for waveform and beat analysis). */
async function benchmarkDecode(_args: unknown, progress: (seconds: number) => void) {
  const benchmarkSink = new AudioSampleSink((await input!.getPrimaryAudioTrack())!);
  const started = performance.now();
  let frames = 0;
  let firstTimestamp = NaN;
  let lastProgress = started;
  for await (const sample of benchmarkSink.samples()) {
    if (Number.isNaN(firstTimestamp)) firstTimestamp = sample.timestamp;
    frames += sample.numberOfFrames;
    sample.close();
    if (performance.now() - lastProgress > 500) {
      lastProgress = performance.now();
      progress(frames / sampleRate);
    }
  }
  const elapsedMs = performance.now() - started;
  const decodedSeconds = frames / sampleRate;
  return {
    decodedSeconds,
    elapsedMs,
    realtimeFactor: decodedSeconds / (elapsedMs / 1000),
    firstTimestamp,
    frames,
  } satisfies DecodeBenchmarkResult;
}

exposeWorker({ open, cacheCues, play, stop, benchmarkDecode });
