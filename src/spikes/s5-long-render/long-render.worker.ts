import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSource,
  BlobSource,
  CanvasSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type EncodedPacket,
  type StreamTargetChunk,
  type VideoCodec,
} from 'mediabunny';
import { renderTestSignal } from '../../core/audio/test-signal';
import { sleep } from '../../core/util/format';
import { exposeWorker } from '../../core/util/worker-rpc';

/**
 * Spike S5: a long export written in resumable pieces to the Origin Private File System.
 * 1. The audio track is encoded in one go (fast; avoids AAC gaps at segment borders).
 * 2. Video is rendered in segments; a manifest records every finished segment.
 * 3. The segments are joined with the audio track by copying packets (no re-encoding).
 */

const JOB_DIRECTORY = 's5-long-render';
const AUDIO_RATE = 48000;

export interface JobParams {
  durationSeconds: number;
  segmentSeconds: number;
  fps: number;
  width: number;
  height: number;
  /** Artificial delay per frame; lets automated tests interrupt a render midway. */
  frameDelayMs?: number;
}

export interface Manifest {
  params: JobParams;
  videoCodec: VideoCodec;
  audioCodec: AudioCodec;
  audioDone: boolean;
  segmentsDone: number[];
  resumeCount: number;
  finalized: boolean;
  createdAt: string;
}

export type Progress =
  | { phase: 'audio'; done: number; total: number }
  | {
      phase: 'video';
      segment: number;
      segments: number;
      frames: number;
      totalFrames: number;
      fps: number;
    }
  | { phase: 'join'; done: number; total: number };

export interface ValidationResult {
  duration: number;
  videoPackets: number;
  expectedFrames: number;
  audioDuration: number;
  bytes: number;
  joinMs: number;
}

// FileSystemSyncAccessHandle lives in the worker lib only.
interface SyncAccessHandle {
  write(buffer: AllowSharedBufferSource, options?: { at?: number }): number;
  truncate(size: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

type SyncFileHandle = FileSystemFileHandle & {
  createSyncAccessHandle(): Promise<SyncAccessHandle>;
};

async function jobDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(JOB_DIRECTORY, { create: true });
}

async function readManifest(): Promise<Manifest | null> {
  try {
    const dir = await jobDirectory();
    const file = await (await dir.getFileHandle('manifest.json')).getFile();
    return JSON.parse(await file.text()) as Manifest;
  } catch {
    return null;
  }
}

async function writeManifest(manifest: Manifest): Promise<void> {
  const handle = await openSync('manifest.json');
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  handle.write(bytes, { at: 0 });
  handle.flush();
  handle.close();
}

/** Opens (and truncates) a file for fast synchronous writes. */
async function openSync(name: string): Promise<SyncAccessHandle> {
  const dir = await jobDirectory();
  const file = (await dir.getFileHandle(name, { create: true })) as SyncFileHandle;
  const handle = await file.createSyncAccessHandle();
  handle.truncate(0);
  return handle;
}

/** Mediabunny StreamTarget → OPFS sync access handle (supports positioned writes). */
async function opfsTarget(name: string): Promise<StreamTarget> {
  const handle = await openSync(name);
  const writable = new WritableStream<StreamTargetChunk>({
    write(chunk) {
      handle.write(chunk.data, { at: chunk.position });
    },
    close() {
      handle.flush();
      handle.close();
    },
    abort() {
      handle.close();
    },
  });
  return new StreamTarget(writable);
}

async function readFile(name: string): Promise<File> {
  const dir = await jobDirectory();
  return (await dir.getFileHandle(name)).getFile();
}

async function status(): Promise<Manifest | null> {
  return readManifest();
}

async function clear(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(JOB_DIRECTORY, { recursive: true }).catch(() => undefined);
}

async function start(params: JobParams, progress: (p: Progress) => void): Promise<Manifest> {
  await clear();
  const videoCodec: VideoCodec = (await canEncodeVideo('avc', {
    width: params.width,
    height: params.height,
  }))
    ? 'avc'
    : 'vp9';
  let audioCodec: AudioCodec = 'aac';
  if (!(await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: AUDIO_RATE }))) {
    const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
    registerAacEncoder();
    if (!(await canEncodeAudio('aac'))) audioCodec = 'opus';
  }
  const manifest: Manifest = {
    params,
    videoCodec,
    audioCodec,
    audioDone: false,
    segmentsDone: [],
    resumeCount: 0,
    finalized: false,
    createdAt: new Date().toISOString(),
  };
  await writeManifest(manifest);
  return run(manifest, progress);
}

async function resume(_args: unknown, progress: (p: Progress) => void): Promise<Manifest> {
  const manifest = await readManifest();
  if (!manifest) throw new Error('No unfinished render found');
  if (manifest.audioCodec === 'aac' && !(await canEncodeAudio('aac'))) {
    const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
    registerAacEncoder();
  }
  manifest.resumeCount++;
  await writeManifest(manifest);
  return run(manifest, progress);
}

async function encodeAudio(manifest: Manifest, progress: (p: Progress) => void) {
  const total = Math.round(manifest.params.durationSeconds * AUDIO_RATE);
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: await opfsTarget('audio.mp4'),
  });
  const source = new AudioSampleSource({ codec: manifest.audioCodec, bitrate: 96_000 });
  output.addAudioTrack(source);
  await output.start();
  const chunk = 48_000;
  const data = new Float32Array(chunk * 2);
  for (let frame = 0; frame < total; frame += chunk) {
    const frames = Math.min(chunk, total - frame);
    const planes = [data.subarray(0, frames), data.subarray(frames, frames * 2)];
    renderTestSignal(planes, frame, frames, AUDIO_RATE, { beepEverySecond: true });
    const sample = new AudioSample({
      data: data.subarray(0, frames * 2),
      format: 'f32-planar',
      numberOfChannels: 2,
      sampleRate: AUDIO_RATE,
      timestamp: frame / AUDIO_RATE,
    });
    await source.add(sample);
    sample.close();
    if (frame % (chunk * 60) === 0) progress({ phase: 'audio', done: frame, total });
  }
  await output.finalize();
}

function drawFrame(ctx: OffscreenCanvasRenderingContext2D, time: number, segment: number) {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = `hsl(${(time * 3) % 360} 60% 18%)`;
  ctx.fillRect(0, 0, width, height);
  if (time % 1 < 0.5) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(width * 0.4, height * 0.72, width * 0.2, height * 0.08);
  }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = `bold ${Math.round(height * 0.16)}px monospace`;
  const h = Math.floor(time / 3600);
  const m = Math.floor((time % 3600) / 60);
  const s = Math.floor(time % 60);
  ctx.fillText(
    `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
    width / 2,
    height * 0.45,
  );
  ctx.font = `${Math.round(height * 0.07)}px sans-serif`;
  ctx.fillText(`segment ${segment + 1}`, width / 2, height * 0.6);
}

async function renderSegment(manifest: Manifest, segment: number, progress: (p: Progress) => void) {
  const { params } = manifest;
  const segments = Math.ceil(params.durationSeconds / params.segmentSeconds);
  const firstFrame = Math.round(segment * params.segmentSeconds * params.fps);
  const endFrame = Math.min(
    Math.round((segment + 1) * params.segmentSeconds * params.fps),
    Math.round(params.durationSeconds * params.fps),
  );
  const totalFrames = Math.round(params.durationSeconds * params.fps);
  const canvas = new OffscreenCanvas(params.width, params.height);
  const ctx = canvas.getContext('2d')!;
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: await opfsTarget(`video-${segment}.mp4`),
  });
  const source = new CanvasSource(canvas, {
    codec: manifest.videoCodec,
    bitrate: 250_000,
    keyFrameInterval: 5,
  });
  output.addVideoTrack(source, { frameRate: params.fps });
  await output.start();
  const started = performance.now();
  for (let frame = firstFrame; frame < endFrame; frame++) {
    const time = frame / params.fps;
    drawFrame(ctx, time, segment);
    // Segments start at 0; the join step adds the segment offset.
    await source.add((frame - firstFrame) / params.fps, 1 / params.fps);
    if (params.frameDelayMs) await sleep(params.frameDelayMs);
    if (frame === firstFrame || frame % 100 === 0) {
      const done = frame - firstFrame + 1;
      progress({
        phase: 'video',
        segment,
        segments,
        frames: frame,
        totalFrames,
        fps: done / ((performance.now() - started) / 1000),
      });
    }
  }
  await output.finalize();
}

async function run(manifest: Manifest, progress: (p: Progress) => void): Promise<Manifest> {
  if (!manifest.audioDone) {
    await encodeAudio(manifest, progress);
    manifest.audioDone = true;
    await writeManifest(manifest);
  }
  const segments = Math.ceil(manifest.params.durationSeconds / manifest.params.segmentSeconds);
  for (let segment = 0; segment < segments; segment++) {
    if (manifest.segmentsDone.includes(segment)) continue;
    await renderSegment(manifest, segment, progress);
    manifest.segmentsDone.push(segment);
    await writeManifest(manifest);
  }
  return manifest;
}

/** Yields packets of both tracks, interleaved by timestamp, each track in decode order. */
async function* interleave(
  a: AsyncGenerator<EncodedPacket>,
  b: AsyncGenerator<EncodedPacket>,
): AsyncGenerator<{ track: 'a' | 'b'; packet: EncodedPacket }> {
  let nextA = await a.next();
  let nextB = await b.next();
  while (!nextA.done || !nextB.done) {
    if (!nextA.done && (nextB.done || nextA.value.timestamp <= nextB.value.timestamp)) {
      yield { track: 'a', packet: nextA.value };
      nextA = await a.next();
    } else if (!nextB.done) {
      yield { track: 'b', packet: nextB.value };
      nextB = await b.next();
    }
  }
}

/** Joins the video segments and the audio track into one MP4 without re-encoding. */
async function join(
  args: { target: 'opfs' | FileSystemFileHandle },
  progress: (p: Progress) => void,
): Promise<ValidationResult> {
  const manifest = await readManifest();
  if (!manifest) throw new Error('No render found');
  const { params } = manifest;
  const segments = Math.ceil(params.durationSeconds / params.segmentSeconds);
  if (!manifest.audioDone || manifest.segmentsDone.length < segments) {
    throw new Error('The render is not complete yet');
  }
  const started = performance.now();

  const target =
    args.target === 'opfs'
      ? await opfsTarget('final.mp4')
      : new StreamTarget(await args.target.createWritable());
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target });
  const videoSource = new EncodedVideoPacketSource(manifest.videoCodec);
  const audioSource = new EncodedAudioPacketSource(manifest.audioCodec);
  output.addVideoTrack(videoSource, { frameRate: params.fps });
  output.addAudioTrack(audioSource);
  await output.start();

  const audioInput = new Input({
    source: new BlobSource(await readFile('audio.mp4')),
    formats: ALL_FORMATS,
  });
  const audioTrack = (await audioInput.getPrimaryAudioTrack())!;
  const audioConfig = await audioTrack.getDecoderConfig();
  let videoConfig: VideoDecoderConfig | null = null;

  async function* videoPackets(): AsyncGenerator<EncodedPacket> {
    let sequence = 0;
    for (let segment = 0; segment < segments; segment++) {
      const input = new Input({
        source: new BlobSource(await readFile(`video-${segment}.mp4`)),
        formats: ALL_FORMATS,
      });
      const track = (await input.getPrimaryVideoTrack())!;
      videoConfig ??= await track.getDecoderConfig();
      const offset = segment * params.segmentSeconds;
      for await (const packet of new EncodedPacketSink(track).packets()) {
        yield packet.clone({ timestamp: packet.timestamp + offset, sequenceNumber: sequence++ });
      }
      input.dispose();
      progress({ phase: 'join', done: segment + 1, total: segments });
    }
  }

  let firstVideo = true;
  let firstAudio = true;
  for await (const { track, packet } of interleave(
    videoPackets(),
    new EncodedPacketSink(audioTrack).packets(),
  )) {
    if (track === 'a') {
      await videoSource.add(packet, firstVideo ? { decoderConfig: videoConfig! } : undefined);
      firstVideo = false;
    } else {
      await audioSource.add(packet, firstAudio ? { decoderConfig: audioConfig! } : undefined);
      firstAudio = false;
    }
  }
  await output.finalize();
  audioInput.dispose();
  const joinMs = performance.now() - started;

  manifest.finalized = true;
  await writeManifest(manifest);

  // Validate the result by reading it back.
  const finalFile =
    args.target === 'opfs' ? await readFile('final.mp4') : await args.target.getFile();
  const result = new Input({ source: new BlobSource(finalFile), formats: ALL_FORMATS });
  const duration = await result.computeDuration();
  const video = (await result.getPrimaryVideoTrack())!;
  let videoPacketCount = 0;
  for await (const packet of new EncodedPacketSink(video).packets(undefined, undefined, {
    metadataOnly: true,
  })) {
    if (packet.byteLength > 0) videoPacketCount++;
  }
  const audio = (await result.getPrimaryAudioTrack())!;
  const audioDuration = await result.computeDuration([audio]);
  result.dispose();

  // The segments are no longer needed.
  const dir = await jobDirectory();
  for (let segment = 0; segment < segments; segment++) {
    await dir.removeEntry(`video-${segment}.mp4`).catch(() => undefined);
  }

  return {
    duration,
    videoPackets: videoPacketCount,
    expectedFrames: Math.round(params.durationSeconds * params.fps),
    audioDuration,
    bytes: finalFile.size,
    joinMs,
  };
}

exposeWorker({ status, clear, start, resume, join });
