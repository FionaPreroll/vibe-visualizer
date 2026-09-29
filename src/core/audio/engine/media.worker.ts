import { ALL_FORMATS, BlobSource, Input, type InputAudioTrack } from 'mediabunny';
import { sleep } from '../../util/format';
import { exposeWorker } from '../../util/worker-rpc';
import { decodeAtRate } from '../decode-stream';
import { Resampler } from '../resampler';
import { AudioRingProducer } from '../ring-buffer';

/**
 * Streams files into the engine ring: decodes in pieces (Mediabunny + WebCodecs), converts to
 * the engine rate and stays a few seconds ahead of playback. Every seek starts a new ring
 * generation; the AudioWorklet drops older audio within one render quantum.
 *
 * Files are known by a token from the main thread. For gapless playback (PL-05) the main thread
 * answers, for the file being decoded, which file follows it. At the end of the file the
 * stream waits for that answer, then continues with the next file in the same generation, and
 * the ring records where it starts.
 */

export interface LoadResult {
  generation: number;
  duration: number;
  sampleRate: number;
  channels: number;
  codec: string;
}

/** A file to follow another one, from the main thread. */
export interface NextFile {
  file: File;
  token: number;
}

interface Source {
  token: number;
  input: Input;
  track: InputAudioTrack;
  resampler: Resampler | null;
  duration: number;
}

/** What follows the file with token `after`: the main thread's answer. */
interface Answer {
  after: number;
  /** Token of the next file, -1 for none. */
  token: number;
  source: Promise<Source | null>;
}

/** Open files kept for seeking and for what follows. */
const KEEP_SOURCES = 3;
/**
 * The answer is taken late, once the ring is down to this much music: until then the main
 * thread may still change what follows (the queue was edited) without restarting the stream.
 */
const COMMIT_SECONDS = 1.5;
/**
 * Without an answer, the stream waits at the end of a file while the ring holds at least this
 * much music (the main thread answers once the file is heard; paused, the ring stays full).
 */
const ANSWER_RESERVE_SECONDS = 0.25;

let producer: AudioRingProducer | null = null;
let engineRate = 48000;
const sources = new Map<number, Source>();
const openings = new Map<number, Promise<Source>>();
/** The file whose answer is still open: the stream is decoding it or waiting at its end. */
let current: Source | null = null;
let answer: Answer | null = null;
let streamToken = 0;

function init(args: { ring: SharedArrayBuffer; channels: number; sampleRate: number }) {
  producer = new AudioRingProducer(args.ring, args.channels);
  engineRate = args.sampleRate;
}

function ring(): AudioRingProducer {
  if (!producer) throw new Error('Media worker not initialised');
  return producer;
}

/** The open file with `token`; it is opened first if needed (once, however often asked). */
function open(file: File, token: number): Promise<Source> {
  const known = sources.get(token);
  if (known) return Promise.resolve(known);
  let opening = openings.get(token);
  if (!opening) {
    opening = openSource(file, token).finally(() => openings.delete(token));
    openings.set(token, opening);
  }
  return opening;
}

async function openSource(file: File, token: number): Promise<Source> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('The file contains no audio track');
    if (!(await track.canDecode())) {
      throw new Error(`This browser cannot decode ${track.codec ?? 'this audio format'}`);
    }
    const resampler =
      track.sampleRate === engineRate
        ? null
        : new Resampler(Math.min(2, track.numberOfChannels), track.sampleRate, engineRate);
    const duration = (await input.getDurationFromMetadata()) ?? (await input.computeDuration());
    const source: Source = { token, input, track, resampler, duration };
    sources.set(token, source);
    prune();
    return source;
  } catch (error) {
    input.dispose();
    throw error;
  }
}

/** Closes the oldest files beyond {@link KEEP_SOURCES} (never the current or the next one). */
function prune(): void {
  for (const [token, source] of sources) {
    if (sources.size <= KEEP_SOURCES) break;
    if (source === current || token === answer?.token) continue;
    source.input.dispose();
    sources.delete(token);
  }
}

/** Sets what follows the file with token `after`. */
function setAnswer(after: number, next: NextFile | null): void {
  answer = {
    after,
    token: next?.token ?? -1,
    // A file that cannot be opened ends the stream; the main thread then reports the error.
    source: next ? open(next.file, next.token).catch(() => null) : Promise.resolve(null),
  };
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

/** Decodes `first` from `startFrame` into the ring, then the files that follow it. */
async function stream(
  first: Source,
  startFrame: number,
  generation: number,
  token: number,
): Promise<void> {
  const commit = COMMIT_SECONDS * engineRate;
  const reserve = ANSWER_RESERVE_SECONDS * engineRate;
  let source = first;
  let from = startFrame;
  let written = 0;
  for (;;) {
    if (token !== streamToken) return;
    current = source;
    for await (const planes of decodeAtRate(source.track, source.resampler, from)) {
      if (!(await writeAll(planes, token))) return;
      written += planes[0]!.length;
    }
    // What follows is taken late; without an answer the stream ends when the ring runs low.
    for (;;) {
      if (token !== streamToken) return;
      const buffered = ring().bufferedFrames;
      if (answer?.after === source.token ? buffered <= commit : buffered < reserve) break;
      await sleep(10);
    }
    const pending = answer?.after === source.token ? answer.source : null;
    // Taken: a later answer for this file comes too late.
    answer = null;
    current = null;
    const next = pending ? await pending : null;
    if (token !== streamToken) return;
    if (!next) break;
    // Gapless: the next file follows right after the last frame of this one.
    ring().markNext(generation, written, next.token);
    source = next;
    from = 0;
  }
  ring().markEnded(generation);
}

/** Starts a new generation at `seconds` of `source` and streams from there. */
async function startStream(source: Source | null, seconds: number): Promise<number> {
  const token = ++streamToken;
  const startFrame = Math.max(0, Math.round(seconds * engineRate));
  const generation = ring().beginGeneration(startFrame, source?.token ?? 0);
  const started = performance.now();
  while (!ring().isAcknowledged(generation)) {
    if (performance.now() - started > 3000) throw new Error('The audio engine is not running');
    await sleep(1);
  }
  if (source) {
    void stream(source, startFrame, generation, token).catch((error: unknown) => {
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

/** Stops the stream: answers for its files are not taken any more. */
function stopStream(): void {
  streamToken++;
  current = null;
  answer = null;
}

/** Stops the stream and opens the file to play; a newer request meanwhile replaces this one. */
async function openInstead(file: File, token: number): Promise<Source> {
  stopStream();
  const request = streamToken;
  const source = await open(file, token);
  if (request !== streamToken) throw new Error('Replaced by a newer request');
  return source;
}

/** Plays `file` (known by `token`) from `startSeconds`; `next` follows it without a gap. */
async function load(args: {
  file: File;
  startSeconds: number;
  token: number;
  next: NextFile | null;
}): Promise<LoadResult> {
  const source = await openInstead(args.file, args.token);
  setAnswer(source.token, args.next);
  const generation = await startStream(source, args.startSeconds);
  return {
    generation,
    duration: source.duration,
    sampleRate: source.track.sampleRate,
    channels: source.track.numberOfChannels,
    codec: source.track.codec ?? 'unknown',
  };
}

/** Plays the file of `token` from `seconds` (opened again if it was closed meanwhile). */
async function seek(args: {
  seconds: number;
  token: number;
  file: File;
  next: NextFile | null;
}): Promise<number> {
  const source = await openInstead(args.file, args.token);
  setAnswer(source.token, args.next);
  return startStream(source, args.seconds);
}

/**
 * What follows the file with token `after` (null: nothing, the stream ends there). False when
 * it comes too late: the stream is not in that file any more.
 */
function queueNext(args: { after: number; next: NextFile | null }): boolean {
  if (current?.token !== args.after) return false;
  setAnswer(args.after, args.next);
  return true;
}

/** Stops streaming and empties the ring. */
async function unload(): Promise<void> {
  stopStream();
  for (const source of sources.values()) source.input.dispose();
  sources.clear();
  await startStream(null, 0);
}

exposeWorker({ init, load, seek, queueNext, unload });
