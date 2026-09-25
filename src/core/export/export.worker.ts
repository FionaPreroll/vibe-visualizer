import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSource,
  BlobSource,
  CanvasSource,
  canEncodeAudio,
  canEncodeVideo,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  WebMOutputFormat,
  type EncodedPacket,
  type StreamTargetChunk,
} from 'mediabunny';
import { Analyzer } from '../analysis/analyzer';
import { FeatureSampler } from '../analysis/feature-timeline';
import { F } from '../analysis/features';
import { decodeAtRate } from '../audio/decode-stream';
import { Resampler } from '../audio/resampler';
import { sanitizeKaleido } from '../render/kaleido-settings';
import { KaleidoscopeScene } from '../render/kaleidoscope';
import { LogoSpectrumScene } from '../render/logo-spectrum';
import { decodeSnapshot, encodeSnapshot, type Scene } from '../render/scene';
import { sanitizeSettings } from '../render/visual-settings';
import { exposeWorker } from '../util/worker-rpc';
import {
  CANCELLED,
  EXPORT_RATE,
  FEATURE_FIELDS,
  OUTPUT_FILE,
  frameTime,
  planTiming,
  type ExportCodecs,
  type ExportManifest,
  type ExportSource,
  type ExportVisuals,
} from './export-job';
import { FeatureFeed } from './feature-feed';
import { clearJob, JobWriter, readManifest, RecordWriter } from './job-store';
import { avcCodecString, type VideoFormat } from './video-format';

/**
 * Renders an export (EX-01…07, EX-15) in a worker, independent of the screen:
 *
 * 1. Audio pass: decode the range (plus an analysis pre-roll), convert to 48 kHz like the live
 *    engine, analyse it and store the analysis, and encode the audio.
 * 2. Video pass: render frame n at time n / fps from the stored analysis, in segments. After
 *    each segment the scene's state is saved, so an interrupted export resumes exactly.
 * 3. Join: copy the segments and the audio into one MP4 (or WebM) without re-encoding, straight
 *    into the file you picked, or into browser storage for a download.
 */

export interface ImageInput {
  /** The original file, stored with the job for resuming. */
  blob: Blob;
  /** Decoded for rendering. */
  bitmap: ImageBitmap;
}

export interface StartArgs {
  file: File;
  source: ExportSource;
  range: { start: number; end: number };
  format: VideoFormat;
  visuals: ExportVisuals;
  images: { background: ImageInput | null; logo: ImageInput | null };
  /** The file to write; null writes into browser storage for a download. */
  destination: FileSystemFileHandle | null;
  fileName: string;
  /** Shorter segments for tests. */
  segmentSeconds?: number;
}

export interface ResumeArgs {
  /** The source file; only needed when the audio pass was not finished. */
  file: File | null;
  images: { background: ImageBitmap | null; logo: ImageBitmap | null };
  destination: FileSystemFileHandle | null;
}

export interface ExportResult {
  fileName: string;
  bytes: number;
  destination: 'file' | 'download';
  /** Wall-clock seconds of this run. */
  seconds: number;
}

export type ExportProgress =
  | { phase: 'audio'; done: number; total: number }
  | {
      phase: 'video';
      done: number;
      total: number;
      /** Frames rendered per second, recently. */
      framesPerSecond: number;
      preview: ImageBitmap | null;
    }
  | { phase: 'join'; done: number; total: number };

const OPUS_BITRATE = 192_000;
const PREVIEW_WIDTH = 480;
const REPORT_INTERVAL_MS = 250;
const PREVIEW_INTERVAL_MS = 1000;

let running = false;
let paused = false;
let cancelled = false;
let wake: (() => void) | null = null;
let wasmAac = false;

/** Waits while paused; throws once cancelled. Called between frames and chunks. */
async function gate(): Promise<void> {
  while (paused && !cancelled) await new Promise<void>((resolve) => (wake = resolve));
  if (cancelled) throw new Error(CANCELLED);
}

function pause(): void {
  paused = true;
}

function unpause(): void {
  paused = false;
  wake?.();
  wake = null;
}

function cancel(): void {
  cancelled = true;
  wake?.();
  wake = null;
}

async function ensureWasmAac(): Promise<void> {
  if (wasmAac) return;
  const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
  registerAacEncoder();
  wasmAac = true;
}

/**
 * The codecs for `format` (EX-04): H.264 + AAC in MP4, with the WebAssembly AAC encoder when the
 * browser has none; VP9 + Opus in WebM only when H.264 cannot be encoded.
 */
async function probe(format: VideoFormat): Promise<ExportCodecs> {
  const { width, height, fps, videoBitrate, audioBitrate } = format;
  const quality = new Quality({ bitrate: videoBitrate });
  const avc = avcCodecString(width, height, fps, videoBitrate);
  const audioOptions = (bitrate: number) => ({
    numberOfChannels: 2,
    sampleRate: EXPORT_RATE,
    quality: new Quality({ bitrate }),
  });
  if (
    await canEncodeVideo('avc', { width, height, frameRate: fps, quality, fullCodecString: avc })
  ) {
    if (await canEncodeAudio('aac', audioOptions(audioBitrate))) {
      return codecs('avc', avc, 'aac', 'mp4', 'native');
    }
    await ensureWasmAac();
    if (await canEncodeAudio('aac', audioOptions(audioBitrate))) {
      return codecs('avc', avc, 'aac', 'mp4', 'wasm');
    }
    if (await canEncodeAudio('opus', audioOptions(OPUS_BITRATE))) {
      return codecs('avc', avc, 'opus', 'mp4', null);
    }
    throw new Error('This browser cannot encode audio (neither AAC nor Opus).');
  }
  if (await canEncodeVideo('vp9', { width, height, frameRate: fps, quality })) {
    if (await canEncodeAudio('opus', audioOptions(OPUS_BITRATE))) {
      return codecs('vp9', null, 'opus', 'webm', null);
    }
    throw new Error('This browser cannot encode Opus audio for a WebM video.');
  }
  throw new Error(`This browser cannot encode video at ${width}×${height}. Try a smaller size.`);
}

function codecs(
  video: ExportCodecs['video'],
  videoCodecString: string | null,
  audio: ExportCodecs['audio'],
  container: ExportCodecs['container'],
  aacEncoder: ExportCodecs['aacEncoder'],
): ExportCodecs {
  return { video, videoCodecString, audio, container, aacEncoder };
}

async function start(args: StartArgs, progress: (update: ExportProgress) => void) {
  if (running) throw new Error('An export is already running.');
  running = true;
  paused = false;
  cancelled = false;
  try {
    await clearJob();
    const store = await JobWriter.open();
    const analyzer = new Analyzer(EXPORT_RATE);
    const manifest: ExportManifest = {
      version: 1,
      sequence: 0,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      source: args.source,
      range: args.range,
      format: args.format,
      codecs: await probe(args.format),
      visuals: args.visuals,
      images: {
        background: args.images.background?.blob.type ?? null,
        logo: args.images.logo?.blob.type ?? null,
      },
      timing: planTiming(args.range, args.format.fps, analyzer.hop, args.segmentSeconds),
      destination: args.destination ? 'file' : 'download',
      fileName: args.fileName,
      progress: { audioDone: false, segmentsDone: 0, finished: false, bytes: null },
      resumeCount: 0,
    };
    if (args.visuals.mode === 'logoSpectrum') {
      for (const kind of ['background', 'logo'] as const) {
        const image = args.images[kind];
        if (image) await store.writeFile(`image-${kind}`, image.blob);
      }
    }
    await store.writeManifest(manifest);
    const bitmaps = {
      background: args.images.background?.bitmap ?? null,
      logo: args.images.logo?.bitmap ?? null,
    };
    return await run(store, manifest, args.file, bitmaps, args.destination, progress, analyzer);
  } finally {
    running = false;
    args.images.background?.bitmap.close();
    args.images.logo?.bitmap.close();
  }
}

async function resume(args: ResumeArgs, progress: (update: ExportProgress) => void) {
  if (running) throw new Error('An export is already running.');
  running = true;
  paused = false;
  cancelled = false;
  try {
    const manifest = await readManifest();
    if (!manifest || manifest.progress.finished) throw new Error('There is no unfinished export.');
    if (!manifest.progress.audioDone && !args.file) {
      throw new Error(`To resume, add ${manifest.source.name} again.`);
    }
    const store = await JobWriter.open();
    manifest.resumeCount++;
    manifest.destination = args.destination ? 'file' : 'download';
    await store.writeManifest(manifest);
    return await run(store, manifest, args.file, args.images, args.destination, progress);
  } finally {
    running = false;
    args.images.background?.close();
    args.images.logo?.close();
  }
}

async function run(
  store: JobWriter,
  manifest: ExportManifest,
  file: File | null,
  images: ResumeArgs['images'],
  destination: FileSystemFileHandle | null,
  progress: (update: ExportProgress) => void,
  analyzer = new Analyzer(EXPORT_RATE),
): Promise<ExportResult> {
  const started = performance.now();
  if (manifest.codecs.aacEncoder === 'wasm') await ensureWasmAac();
  if (!manifest.progress.audioDone) {
    await audioPass(store, manifest, file!, analyzer, progress);
    manifest.progress.audioDone = true;
    await store.writeManifest(manifest);
  }
  if (manifest.progress.segmentsDone < manifest.timing.segments) {
    await videoPass(store, manifest, images, progress);
  }
  const bytes = await join(store, manifest, destination, progress);
  // Only the finished file (for a download) and the manifest stay.
  for (const name of ['audio.mp4', 'features.bin', 'image-background', 'image-logo']) {
    await store.remove(name);
  }
  if (destination) {
    await clearJob();
  } else {
    manifest.progress.finished = true;
    manifest.progress.bytes = bytes;
    await store.writeManifest(manifest);
  }
  return {
    fileName: manifest.fileName,
    bytes,
    destination: manifest.destination,
    seconds: (performance.now() - started) / 1000,
  };
}

/** Pass 1: decode, analyse (stored for the video pass) and encode the audio. */
async function audioPass(
  store: JobWriter,
  manifest: ExportManifest,
  file: File,
  analyzer: Analyzer,
  progress: (update: ExportProgress) => void,
): Promise<void> {
  const { timing, codecs, format } = manifest;
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const records = new RecordWriter(await store.open('features.bin'), FEATURE_FIELDS);
  let output: Output | null = null;
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('The file contains no audio track.');
    if (!(await track.canDecode())) {
      throw new Error(`This browser cannot decode ${track.codec ?? 'this audio format'}.`);
    }
    const resampler =
      track.sampleRate === EXPORT_RATE
        ? null
        : new Resampler(Math.min(2, track.numberOfChannels), track.sampleRate, EXPORT_RATE);
    output = new Output({
      format: new Mp4OutputFormat({ fastStart: false }),
      target: await store.target('audio.mp4'),
    });
    const bitrate = codecs.audio === 'opus' ? OPUS_BITRATE : format.audioBitrate;
    const source = new AudioSampleSource({
      codec: codecs.audio,
      quality: new Quality({ bitrate }),
    });
    output.addAudioTrack(source);
    await output.start();

    const analysisEnd = timing.analysisStart + timing.analysisFrames * timing.hop;
    const encodeStart = timing.audioStart;
    const encodeEnd = timing.audioStart + timing.audioFrames;
    let position = timing.analysisStart;
    let stored = 0;
    const onFrame = () => {
      if (stored++ < timing.analysisFrames) records.add(analyzer.frame);
    };
    let reported = 0;
    const consume = async (left: Float32Array, right: Float32Array) => {
      const count = Math.min(left.length, analysisEnd - position);
      if (count <= 0) return;
      analyzer.process(left, right, count, onFrame);
      const from = Math.max(position, encodeStart);
      const to = Math.min(position + count, encodeEnd);
      if (to > from) {
        const frames = to - from;
        const offset = from - position;
        const data = new Float32Array(frames * 2);
        data.set(left.subarray(offset, offset + frames), 0);
        data.set(right.subarray(offset, offset + frames), frames);
        const sample = new AudioSample({
          data,
          format: 'f32-planar',
          numberOfChannels: 2,
          sampleRate: EXPORT_RATE,
          timestamp: (from - encodeStart) / EXPORT_RATE,
        });
        await source.add(sample);
        sample.close();
      }
      position += count;
      if (performance.now() - reported > REPORT_INTERVAL_MS) {
        reported = performance.now();
        const total = analysisEnd - timing.analysisStart;
        progress({ phase: 'audio', done: position - timing.analysisStart, total });
      }
    };
    for await (const planes of decodeAtRate(track, resampler, timing.analysisStart)) {
      await gate();
      await consume(planes[0]!, planes[1] ?? planes[0]!);
      if (position >= analysisEnd) break;
    }
    // A file that ends early (or a duration that was a little off): silence up to the end.
    const silence = new Float32Array(4096);
    while (position < analysisEnd) {
      await gate();
      await consume(silence, silence);
    }
    await output.finalize();
    output = null;
  } finally {
    records.close();
    await output?.cancel().catch(() => undefined);
    input.dispose();
  }
}

function createScene(
  gl: WebGL2RenderingContext,
  visuals: ExportVisuals,
  images: ResumeArgs['images'],
): Scene {
  if (visuals.mode === 'logoSpectrum') {
    const scene = new LogoSpectrumScene(gl);
    scene.setSettings(sanitizeSettings(visuals.settings));
    scene.setImage('background', images.background);
    scene.setImage('logo', images.logo);
    return scene;
  }
  const scene = new KaleidoscopeScene(gl);
  scene.setSettings(sanitizeKaleido(visuals.settings));
  return scene;
}

/** Pass 2: render and encode the video in segments, from the stored analysis. */
async function videoPass(
  store: JobWriter,
  manifest: ExportManifest,
  images: ResumeArgs['images'],
  progress: (update: ExportProgress) => void,
): Promise<void> {
  const { format, timing, codecs } = manifest;
  const fps = format.fps;
  const canvas = new OffscreenCanvas(format.width, format.height);
  let lost = false;
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    lost = true;
  });
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    // The encoder and the preview read the canvas after drawing.
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 is not available.');
  const scene = createScene(gl, manifest.visuals, images);
  try {
    scene.resize(format.width, format.height);
    const analysis = await store.file('features.bin');
    const feed = new FeatureFeed(async (index, count) => {
      const bytes = FEATURE_FIELDS * 4;
      const slice = analysis.slice(index * bytes, (index + count) * bytes);
      return new Float32Array(await slice.arrayBuffer());
    }, timing);
    const sampler = new FeatureSampler(feed.reader);
    const features = new Float32Array(F.size);

    const first = manifest.progress.segmentsDone;
    let n = -timing.preRollFrames;
    if (first > 0) {
      // Resume: the scene continues from the state saved after the previous segment.
      n = first * timing.segmentFrames;
      const state = await store.file(`state-${first}.bin`);
      scene.restoreState(decodeSnapshot(await state.arrayBuffer()));
      const previous = frameTime(timing, fps, n - 1);
      feed.seek(previous);
      sampler.resetTo(previous);
    }

    const render = async (frame: number) => {
      if (lost) throw new Error('The graphics context was lost.');
      const at = frameTime(timing, fps, frame);
      await feed.ensure(at);
      sampler.sample(at, features);
      scene.render({ time: (frame + timing.preRollFrames) / fps, dt: 1 / fps, features });
    };

    // The pre-roll is rendered but not encoded: trails and motion are running at frame 0.
    for (; n < 0; n++) {
      await gate();
      await render(n);
    }

    const meter = { frames: 0, since: performance.now(), rate: 0 };
    let reported = 0;
    let previewed = 0;
    for (let segment = first; segment < timing.segments; segment++) {
      const segmentStart = segment * timing.segmentFrames;
      const segmentEnd = Math.min(timing.frames, segmentStart + timing.segmentFrames);
      const output = new Output({
        format: new Mp4OutputFormat({ fastStart: false }),
        target: await store.target(`video-${segment}.mp4`),
      });
      const source = new CanvasSource(canvas, {
        codec: codecs.video,
        fullCodecString: codecs.videoCodecString ?? undefined,
        quality: new Quality({ bitrate: format.videoBitrate }),
        keyFrameInterval: 2,
      });
      output.addVideoTrack(source, { frameRate: fps });
      await output.start();
      try {
        for (n = segmentStart; n < segmentEnd; n++) {
          await gate();
          await render(n);
          // Segments start at 0; the join adds their offset.
          await source.add((n - segmentStart) / fps, 1 / fps);
          meter.frames++;
          const now = performance.now();
          if (now - meter.since >= 1000) {
            const rate = (meter.frames * 1000) / (now - meter.since);
            meter.rate = meter.rate ? meter.rate * 0.5 + rate * 0.5 : rate;
            meter.frames = 0;
            meter.since = now;
          }
          if (now - reported > REPORT_INTERVAL_MS || n === timing.frames - 1) {
            reported = now;
            let preview: ImageBitmap | null = null;
            if (now - previewed > PREVIEW_INTERVAL_MS) {
              previewed = now;
              preview = await createImageBitmap(canvas, {
                resizeWidth: PREVIEW_WIDTH,
                resizeHeight: Math.round((PREVIEW_WIDTH * format.height) / format.width),
                resizeQuality: 'medium',
              });
            }
            progress({
              phase: 'video',
              done: n + 1,
              total: timing.frames,
              framesPerSecond: meter.rate,
              preview,
            });
            preview?.close();
          }
        }
        await output.finalize();
      } catch (error) {
        await output.cancel().catch(() => undefined);
        throw error;
      }
      if (segment + 1 < timing.segments) {
        await store.writeFile(`state-${segment + 1}.bin`, encodeSnapshot(scene.saveState()));
      }
      await store.remove(`state-${segment}.bin`);
      manifest.progress.segmentsDone = segment + 1;
      await store.writeManifest(manifest);
    }
  } finally {
    scene.dispose();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** Yields packets of two tracks, interleaved by timestamp, each in decode order. */
async function* interleave(
  video: AsyncGenerator<EncodedPacket>,
  audio: AsyncGenerator<EncodedPacket>,
): AsyncGenerator<{ video: boolean; packet: EncodedPacket }> {
  let nextVideo = await video.next();
  let nextAudio = await audio.next();
  while (!nextVideo.done || !nextAudio.done) {
    if (
      !nextVideo.done &&
      (nextAudio.done || nextVideo.value.timestamp <= nextAudio.value.timestamp)
    ) {
      yield { video: true, packet: nextVideo.value };
      nextVideo = await video.next();
    } else if (!nextAudio.done) {
      yield { video: false, packet: nextAudio.value };
      nextAudio = await audio.next();
    }
  }
}

/** Pass 3: joins the video segments and the audio into the final file, without re-encoding. */
async function join(
  store: JobWriter,
  manifest: ExportManifest,
  destination: FileSystemFileHandle | null,
  progress: (update: ExportProgress) => void,
): Promise<number> {
  const { timing, codecs, format } = manifest;
  // Written straight into the picked file (EX-07). A failed or cancelled join discards what
  // was written instead of leaving a broken video there.
  let abandon = false;
  let target: StreamTarget;
  if (destination) {
    const file = await destination.createWritable();
    target = new StreamTarget(
      new WritableStream<StreamTargetChunk>({
        write: (chunk) => file.write({ type: 'write', position: chunk.position, data: chunk.data }),
        close: () => (abandon ? file.abort() : file.close()),
        abort: () => file.abort(),
      }),
    );
  } else {
    target = await store.target(OUTPUT_FILE);
  }
  const output = new Output({
    format:
      codecs.container === 'mp4'
        ? new Mp4OutputFormat({ fastStart: false })
        : new WebMOutputFormat(),
    target,
  });
  const videoSource = new EncodedVideoPacketSource(codecs.video);
  const audioSource = new EncodedAudioPacketSource(codecs.audio);
  output.addVideoTrack(videoSource, { frameRate: format.fps });
  output.addAudioTrack(audioSource);
  await output.start();

  const audioInput = new Input({
    source: new BlobSource(await store.file('audio.mp4')),
    formats: ALL_FORMATS,
  });
  try {
    const audioTrack = await audioInput.getPrimaryAudioTrack();
    if (!audioTrack) throw new Error('The encoded audio is missing.');
    const audioConfig = await audioTrack.getDecoderConfig();
    let videoConfig: VideoDecoderConfig | null = null;

    async function* videoPackets(): AsyncGenerator<EncodedPacket> {
      let sequence = 0;
      for (let segment = 0; segment < timing.segments; segment++) {
        const input = new Input({
          source: new BlobSource(await store.file(`video-${segment}.mp4`)),
          formats: ALL_FORMATS,
        });
        try {
          const track = await input.getPrimaryVideoTrack();
          if (!track) throw new Error(`Video segment ${segment + 1} is damaged.`);
          videoConfig ??= await track.getDecoderConfig();
          const offset = (segment * timing.segmentFrames) / format.fps;
          for await (const packet of new EncodedPacketSink(track).packets()) {
            yield packet.clone({
              timestamp: packet.timestamp + offset,
              sequenceNumber: sequence++,
            });
          }
        } finally {
          input.dispose();
        }
        progress({ phase: 'join', done: segment + 1, total: timing.segments });
      }
    }

    let firstVideo = true;
    let firstAudio = true;
    for await (const { video, packet } of interleave(
      videoPackets(),
      new EncodedPacketSink(audioTrack).packets(),
    )) {
      await gate();
      if (video) {
        await videoSource.add(packet, firstVideo ? { decoderConfig: videoConfig! } : undefined);
        firstVideo = false;
      } else {
        await audioSource.add(packet, firstAudio ? { decoderConfig: audioConfig! } : undefined);
        firstAudio = false;
      }
    }
    await output.finalize();
  } catch (error) {
    abandon = true;
    await output.cancel().catch(() => undefined);
    throw error;
  } finally {
    audioInput.dispose();
  }
  for (let segment = 0; segment < timing.segments; segment++) {
    await store.remove(`video-${segment}.mp4`);
  }
  return destination ? (await destination.getFile()).size : (await store.file(OUTPUT_FILE)).size;
}

/** Deletes the job (after cancelling, or when you discard an unfinished export). */
async function discard(): Promise<void> {
  if (running) throw new Error('The export is still running.');
  await clearJob();
}

exposeWorker({ probe, start, resume, pause, unpause, cancel, discard });
