import type { Input, InputAudioTrack } from 'mediabunny';
import { sleep } from '../../util/format';
import { exposeWorker } from '../../util/worker-rpc';
import { decodeAtRate, openInput } from '../decode-stream';
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
 *
 * A file may play only a range (its in and out markers): the stream starts at the in marker and
 * cuts at the out marker. A cut in the middle of the music crosses into what follows over a few
 * milliseconds, and a start in the middle of the music fades in, so neither clicks.
 */

export interface LoadResult {
  generation: number;
  duration: number;
  sampleRate: number;
  channels: number;
  codec: string;
}

/** A file to follow another one, from the main thread: from `start` to `end` seconds of it. */
export interface NextFile {
  file: File;
  token: number;
  /** Where it starts (its in marker; 0 for the start of the file). */
  start: number;
  /** Where it ends (its out marker), or null for the end of the file. */
  end: number | null;
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
  /** The range of the next file, in engine frames (null: to its end). */
  start: number;
  end: number | null;
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
/** Length of the crossfade at a cut in the middle of the music (seconds). */
const CROSSFADE_SECONDS = 0.01;

let producer: AudioRingProducer | null = null;
let engineRate = 48000;
const sources = new Map<number, Source>();
const openings = new Map<number, Promise<Source>>();
/** The file whose answer is still open: the stream is decoding it or waiting at its end. */
let current: Source | null = null;
/** Where the current file stops (engine frames; null: at its end); the main thread may move it. */
let currentEnd: number | null = null;
/** Frame of the current file up to which the stream has taken its audio. */
let currentPosition = 0;
/** True once the stream holds back the frames before the current end for the crossfade. */
let holding = false;
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
  const input = openInput(file);
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

/** Seconds to engine frames (null stays null). */
function toFrames(seconds: number): number;
function toFrames(seconds: number | null): number | null;
function toFrames(seconds: number | null): number | null {
  return seconds === null ? null : Math.max(0, Math.round(seconds * engineRate));
}

/** Sets what follows the file with token `after`. */
function setAnswer(after: number, next: NextFile | null): void {
  answer = {
    after,
    token: next?.token ?? -1,
    start: toFrames(next?.start ?? 0),
    end: toFrames(next?.end ?? null),
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

/** Stereo frames held back or mixed at a cut. */
class Tail {
  readonly planes: Float32Array[];
  length = 0;

  constructor(frames: number) {
    this.planes = [new Float32Array(frames), new Float32Array(frames)];
  }

  get capacity(): number {
    return this.planes[0]!.length;
  }
}

/** Gain of the incoming side of an equal-power crossfade at frame `i` of `frames`. */
function fadeGain(i: number, frames: number): number {
  return Math.sin(((i + 0.5) / frames) * (Math.PI / 2));
}

/**
 * Decodes `first` from `startFrame` (to `endFrame`, or its end) into the ring, then the files
 * that follow it.
 */
async function stream(
  first: Source,
  startFrame: number,
  endFrame: number | null,
  generation: number,
  token: number,
): Promise<void> {
  const commit = COMMIT_SECONDS * engineRate;
  const reserve = ANSWER_RESERVE_SECONDS * engineRate;
  const crossfade = Math.max(1, Math.round(CROSSFADE_SECONDS * engineRate));
  // What the last file held back at its out marker, and what this one holds back at its own.
  let incoming = new Tail(crossfade);
  let outgoing = new Tail(crossfade);
  let source = first;
  let from = startFrame;
  let end = endFrame;
  let firstFile = true;
  let written = 0;
  const write = async (planes: Float32Array[]) => {
    if (planes[0]!.length === 0) return true;
    if (!(await writeAll(planes, token))) return false;
    written += planes[0]!.length;
    return true;
  };
  for (;;) {
    if (token !== streamToken) return;
    current = source;
    currentEnd = end;
    currentPosition = from;
    holding = false;
    outgoing.length = 0;
    // A start in the middle of the music (an in marker) crosses from what the last file held
    // back, or fades in. The first file of a stream is faded in by the tempo stage.
    const fadeIn = !firstFile && incoming.length === 0 && from > 0 ? crossfade : 0;
    for await (const decoded of decodeAtRate(source.track, source.resampler, from)) {
      if (token !== streamToken) return;
      const limit = currentEnd;
      const position = currentPosition;
      let count = decoded[0]!.length;
      if (limit !== null) count = Math.max(0, Math.min(count, limit - position));
      if (count === 0) break;
      // Two planes of their own: the fades change them in place (a mono file gets a copy).
      const planes = [
        decoded[0]!.subarray(0, count),
        decoded[1]?.subarray(0, count) ?? decoded[0]!.slice(0, count),
      ];
      // Taken before writing: a new end the main thread sends meanwhile must lie beyond it.
      currentPosition = position + count;
      const offset = position - from;
      const cross = incoming.length > 0 ? incoming.length : fadeIn;
      for (let i = offset; i < Math.min(cross, offset + count); i++) {
        const gain = fadeGain(i, cross);
        const fade = Math.sqrt(1 - gain * gain);
        for (let c = 0; c < 2; c++) {
          const plane = planes[c]!;
          const held = incoming.length > 0 ? incoming.planes[c]![i]! * fade : 0;
          plane[i - offset] = plane[i - offset]! * gain + held;
        }
      }
      // The frames just before the out marker are held back for the crossfade.
      const holdFrom = limit === null ? Infinity : limit - outgoing.capacity;
      const keep = Math.max(0, Math.min(count, holdFrom - position));
      if (!(await write(planes.map((plane) => plane.subarray(0, keep))))) return;
      if (keep < count) {
        holding = true;
        for (let c = 0; c < 2; c++) {
          outgoing.planes[c]!.set(planes[c]!.subarray(keep, count), outgoing.length);
        }
        outgoing.length += count - keep;
      }
      if (limit !== null && currentPosition >= limit) break;
    }
    if (token !== streamToken) return;
    firstFile = false;
    // What follows is taken late; without an answer the stream ends when the ring runs low.
    for (;;) {
      if (token !== streamToken) return;
      const buffered = ring().bufferedFrames;
      if (answer?.after === source.token ? buffered <= commit : buffered < reserve) break;
      await sleep(10);
    }
    const taken = answer?.after === source.token ? answer : null;
    // Taken: a later answer for this file comes too late.
    answer = null;
    current = null;
    const next = taken ? await taken.source : null;
    if (token !== streamToken) return;
    if (!next || !taken) {
      // The end of the queue at an out marker: what was held back fades out.
      const planes = outgoing.planes.map((plane) => plane.subarray(0, outgoing.length));
      for (let i = 0; i < outgoing.length; i++) {
        const gain = fadeGain(outgoing.length - 1 - i, outgoing.length);
        for (const plane of planes) plane[i] = plane[i]! * gain;
      }
      if (!(await write(planes))) return;
      break;
    }
    // Gapless: the next file follows right after the last frame written of this one.
    ring().markNext(generation, written, next.token, taken.start);
    [incoming, outgoing] = [outgoing, incoming];
    source = next;
    from = taken.start;
    end = taken.end;
  }
  ring().markEnded(generation);
}

/** Starts a new generation at `seconds` of `source` and streams from there (to `end`). */
async function startStream(
  source: Source | null,
  seconds: number,
  end: number | null = null,
): Promise<number> {
  const token = ++streamToken;
  const startFrame = toFrames(seconds);
  const generation = ring().beginGeneration(startFrame, source?.token ?? 0);
  const started = performance.now();
  while (!ring().isAcknowledged(generation)) {
    if (performance.now() - started > 3000) throw new Error('The audio engine is not running');
    await sleep(1);
  }
  if (source) {
    void stream(source, startFrame, toFrames(end), generation, token).catch((error: unknown) => {
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
  currentEnd = null;
  holding = false;
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

/**
 * Plays `file` (known by `token`) from `startSeconds` to `end` (null: its end); `next` follows
 * it without a gap.
 */
async function load(args: {
  file: File;
  startSeconds: number;
  token: number;
  end: number | null;
  next: NextFile | null;
}): Promise<LoadResult> {
  const source = await openInstead(args.file, args.token);
  setAnswer(source.token, args.next);
  const generation = await startStream(source, args.startSeconds, args.end);
  return {
    generation,
    duration: source.duration,
    sampleRate: source.track.sampleRate,
    channels: source.track.numberOfChannels,
    codec: source.track.codec ?? 'unknown',
  };
}

/**
 * Plays the file of `token` from `seconds` to `end` (opened again if it was closed meanwhile).
 */
async function seek(args: {
  seconds: number;
  token: number;
  file: File;
  end: number | null;
  next: NextFile | null;
}): Promise<number> {
  const source = await openInstead(args.file, args.token);
  setAnswer(source.token, args.next);
  return startStream(source, args.seconds, args.end);
}

/**
 * Moves where the playing file with `token` stops (seconds; null: at its end). False when it
 * comes too late: the stream has taken audio past the new end, or cuts at the old one already.
 */
function setEnd(args: { token: number; end: number | null }): boolean {
  if (current?.token !== args.token || holding) return false;
  const end = toFrames(args.end);
  const crossfade = Math.round(CROSSFADE_SECONDS * engineRate);
  if (end !== null && end - crossfade < currentPosition) return false;
  currentEnd = end;
  return true;
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

exposeWorker({ init, load, seek, setEnd, queueNext, unload });
