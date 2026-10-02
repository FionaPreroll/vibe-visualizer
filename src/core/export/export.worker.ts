import {
  AudioSample,
  AudioSampleSource,
  CanvasSource,
  canEncodeAudio,
  canEncodeVideo,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  WebMOutputFormat,
  type EncodedPacket,
  type StreamTargetChunk,
} from 'mediabunny';
import { Analyzer } from '../analysis/analyzer';
import type { BeatGrid } from '../analysis/beat-grid';
import { FeatureSampler } from '../analysis/feature-timeline';
import { F } from '../analysis/features';
import { GridBeats } from '../analysis/grid-beats';
import { decodeGrid, encodeGrid } from '../library/analysis-cache';
import { openInput } from '../audio/decode-stream';
import { DspCore } from '../audio/dsp/dsp-core';
import type { SoundSettings } from '../audio/dsp/sound-settings';
import { SignalsmithStretch } from '../audio/stretch/signalsmith-stretch';
import { PictureFade } from '../render/fade';
import { sanitizeKaleido, type KaleidoSettings } from '../render/kaleido-settings';
import { KaleidoscopeScene } from '../render/kaleidoscope';
import { LogoSpectrumScene } from '../render/logo-spectrum';
import { TrackOverlay } from '../render/overlay';
import { sanitizeOverlay } from '../render/overlay-settings';
import { PresetAutomation, SWITCHING_SEEDS } from '../render/preset-automation';
import { sanitizeAutoPresets } from '../render/preset-director';
import {
  decodeSnapshot,
  encodeSnapshot,
  joinSnapshots,
  splitSnapshot,
  type Scene,
  type SceneInput,
  type SceneSnapshot,
} from '../render/scene';
import { morphKaleido, morphLogoSpectrum } from '../render/settings-morph';
import { sanitizeSettings } from '../render/visual-settings';
import { exposeWorker } from '../util/worker-rpc';
import {
  CANCELLED,
  coverFile,
  EXPORT_RATE,
  fadeAt,
  FEATURE_FIELDS,
  gridFile,
  JOB_IMAGES,
  OUTPUT_FILE,
  partAt,
  partChapters,
  partTrack,
  planParts,
  frameTime,
  type Chapter,
  type JobImage,
  type ExportCodecs,
  type ExportManifest,
  type ExportPart,
  type ExportVisuals,
} from './export-job';
import { DecodedSource } from './decoded-source';
import { joinedStream } from './joined-stream';
import { FeatureFeed } from './feature-feed';
import { clearJob, JobWriter, readJobFile, readManifest, RecordWriter } from './job-store';
import { avcCodecString, type VideoFormat } from './video-format';

/**
 * Renders an export (EX-01…07, EX-15) in a worker, independent of the screen:
 *
 * 1. Audio pass: decode the parts of the tracks (plus an analysis pre-roll), joined as the
 *    player joins the queue (EX-05), convert to 48 kHz and play them through the sound chain
 *    like the live engine (tempo and effects), analyse them and store the analysis, and encode
 *    the audio, with its fades (EX-16).
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
  /** The tracks of the video in order, and the file of each (EX-05). */
  parts: ExportPart[];
  files: File[];
  format: VideoFormat;
  visuals: ExportVisuals;
  sound: SoundSettings;
  /** Seconds of the fades at the start and the end (EX-16); 0: none. */
  fade: number;
  /** Each part's beat grid (AN-07), if its file has been analysed: the beats come from it. */
  grids: (BeatGrid | null)[];
  /** The Logo Spectrum's images. */
  images: Record<JobImage, ImageInput | null>;
  /** Each part's cover art, shown as the logo (LS-15); null: the logo image. */
  covers: (ImageInput | null)[];
  /** The file to write; null writes into browser storage for a download. */
  destination: FileSystemFileHandle | null;
  fileName: string;
  /**
   * For a video of a batch (EX-09): the folder its file goes into (Chromium), made only when
   * it is written, so that a cancelled video leaves none; or else its file among the batch's
   * videos in browser storage.
   */
  folder?: FileSystemDirectoryHandle | null;
  output?: string | null;
  /** Shorter segments for tests. */
  segmentSeconds?: number;
}

export interface ResumeArgs {
  /** The files of the parts; only needed when the audio pass was not finished. */
  files: (File | null)[];
  images: Record<JobImage, ImageBitmap | null>;
  covers: (ImageBitmap | null)[];
  destination: FileSystemFileHandle | null;
  /** The folder of a batch (EX-09), for its video that failed. */
  folder?: FileSystemDirectoryHandle | null;
}

export interface ExportResult {
  fileName: string;
  bytes: number;
  destination: 'file' | 'download';
  /** Wall-clock seconds of this run. */
  seconds: number;
  /** Where each track starts in the video (EX-14). */
  chapters: Chapter[];
  /** The video's file among a batch's videos in storage (EX-09); null: the job's own. */
  output: string | null;
}

/** The pictures the video pass shows: the Logo Spectrum's images and each part's cover. */
interface Pictures {
  images: Record<JobImage, ImageBitmap | null>;
  covers: (ImageBitmap | null)[];
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
/** Frames per call of the sound chain: the live engine's render quantum. */
const BLOCK = 128;
/** Blocks per decode check and pause check. */
const BLOCKS_PER_STEP = 16;
/** Audio samples per encoded chunk. */
const ENCODE_CHUNK = 8192;
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
    const logoSpectrum = args.visuals.mode === 'logoSpectrum';
    const manifest: ExportManifest = {
      version: 3,
      sequence: 0,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      parts: args.parts,
      format: args.format,
      codecs: await probe(args.format),
      visuals: args.visuals,
      sound: args.sound,
      fade: args.fade,
      images: {
        background: args.images.background?.blob.type ?? null,
        logo: args.images.logo?.blob.type ?? null,
        covers: args.parts.map((_, i) => (logoSpectrum ? args.covers[i]?.blob.type : null) ?? null),
      },
      timing: planParts(args.parts, args.format.fps, analyzer.hop, args.sound, args.segmentSeconds),
      destination: args.destination || args.folder ? 'file' : 'download',
      fileName: args.fileName,
      output: args.destination || args.folder ? null : (args.output ?? null),
      progress: { audioDone: false, segmentsDone: 0, finished: false, bytes: null },
      resumeCount: 0,
    };
    if (logoSpectrum) {
      for (const kind of JOB_IMAGES) {
        const image = args.images[kind];
        if (image) await store.writeFile(`image-${kind}`, image.blob);
      }
      for (const [index, cover] of args.covers.entries()) {
        if (cover) await store.writeFile(coverFile(index), cover.blob);
      }
    }
    // Kept for a resume during the audio pass.
    for (const [index, grid] of args.grids.entries()) {
      if (grid) await store.writeFile(gridFile(index), new Uint8Array(encodeGrid(grid)));
    }
    await store.writeManifest(manifest);
    const pictures: Pictures = {
      images: {
        background: args.images.background?.bitmap ?? null,
        logo: args.images.logo?.bitmap ?? null,
      },
      covers: args.parts.map((_, i) => (logoSpectrum ? args.covers[i]?.bitmap : null) ?? null),
    };
    const target = { file: args.destination, folder: args.folder ?? null };
    return await run(store, manifest, args.files, pictures, target, progress, analyzer);
  } finally {
    running = false;
    for (const kind of JOB_IMAGES) args.images[kind]?.bitmap.close();
    for (const cover of args.covers) cover?.bitmap.close();
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
    if (!manifest.progress.audioDone) {
      const missing = manifest.parts.filter((_, i) => !args.files[i]);
      if (missing.length > 0) {
        const names = [...new Set(missing.map((part) => part.source.name))].join(', ');
        throw new Error(`To resume, add ${names} again.`);
      }
    }
    const store = await JobWriter.open();
    manifest.resumeCount++;
    manifest.destination = args.destination || args.folder ? 'file' : 'download';
    await store.writeManifest(manifest);
    const pictures = { images: args.images, covers: args.covers };
    const target = { file: args.destination, folder: args.folder ?? null };
    return await run(store, manifest, args.files, pictures, target, progress);
  } finally {
    running = false;
    for (const kind of JOB_IMAGES) args.images[kind]?.close();
    for (const cover of args.covers) cover?.close();
  }
}

async function run(
  store: JobWriter,
  manifest: ExportManifest,
  files: (File | null)[],
  pictures: Pictures,
  target: { file: FileSystemFileHandle | null; folder: FileSystemDirectoryHandle | null },
  progress: (update: ExportProgress) => void,
  analyzer = new Analyzer(EXPORT_RATE),
): Promise<ExportResult> {
  const started = performance.now();
  if (manifest.codecs.aacEncoder === 'wasm') await ensureWasmAac();
  if (!manifest.progress.audioDone) {
    const grids = await Promise.all(
      manifest.parts.map((_, index) =>
        readJobFile(gridFile(index))
          .then(async (stored) => decodeGrid(await stored.arrayBuffer()))
          .catch(() => null),
      ),
    );
    await audioPass(store, manifest, files as File[], analyzer, grids, progress);
    manifest.progress.audioDone = true;
    await store.writeManifest(manifest);
  }
  if (manifest.progress.segmentsDone < manifest.timing.segments) {
    await videoPass(store, manifest, pictures, progress);
  }
  // The file of a batch's video in its folder is only made now (EX-09).
  const destination =
    target.file ??
    (await target.folder?.getFileHandle(manifest.fileName, { create: true })) ??
    null;
  const bytes = await join(store, manifest, destination, progress);
  // Only the finished file (for a download) and the manifest stay.
  const jobFiles = [
    ...JOB_IMAGES.map((kind) => `image-${kind}`),
    ...manifest.parts.flatMap((_, index) => [coverFile(index), gridFile(index)]),
  ];
  for (const name of ['audio.mp4', 'features.bin', ...jobFiles]) {
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
    chapters: partChapters(manifest.parts, manifest.timing, manifest.sound),
    output: destination ? null : (manifest.output ?? null),
  };
}

/**
 * Pass 1: decode the parts, play them through the sound chain, analyse them (stored for the
 * video pass) and encode the audio. The chain runs in the live engine's blocks, with the
 * analysis between the filter and the delay, so the export sounds and reacts like playback.
 * The parts are joined as the player joins them; where each one starts, as decoded, goes into
 * the plan.
 */
async function audioPass(
  store: JobWriter,
  manifest: ExportManifest,
  files: File[],
  analyzer: Analyzer,
  grids: (BeatGrid | null)[],
  progress: (update: ExportProgress) => void,
): Promise<void> {
  const { timing, codecs, format, sound, parts } = manifest;
  // With a file's beat grid, the beats come from it, as during playback.
  const gridBeats = grids.map((grid) => {
    const beats = new GridBeats();
    beats.set(grid);
    return beats;
  });
  // The frame of its file each part starts at, and where in the stream it starts.
  const partFrom = parts.map((part, i) =>
    i === 0 ? timing.sourceStart : Math.round(part.range.start * EXPORT_RATE),
  );
  const starts = [...timing.partStarts];
  const records = new RecordWriter(await store.open('features.bin'), FEATURE_FIELDS);
  let output: Output | null = null;
  let decoded: DecodedSource | null = null;
  try {
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

    const stretch = sound.tempoMode === 'keylock' ? new SignalsmithStretch(2, EXPORT_RATE) : null;
    const dsp = new DspCore(EXPORT_RATE, stretch);
    dsp.setSettings(sound);
    dsp.snap();
    dsp.reset();
    const stream = joinedStream(
      parts.map((part, i) => ({
        file: files[i]!,
        from: partFrom[i]!,
        end: part.cut ? Math.round(part.range.end * EXPORT_RATE) : null,
      })),
      (index, frame) => (starts[index] = frame),
    );
    decoded = new DecodedSource(stream[Symbol.asyncIterator]());
    // What one step of blocks can take from the source, with the key lock's look-ahead.
    const lookAhead = Math.ceil(BLOCK * BLOCKS_PER_STEP * sound.rate * 1.1) + 16384;

    const encodeStart = timing.audioStart;
    const encodeEnd = timing.audioStart + timing.audioFrames;
    const total = Math.max(
      encodeEnd,
      timing.analysisStart + (timing.analysisFrames + 1) * timing.hop,
    );
    const pending = [new Float32Array(ENCODE_CHUNK), new Float32Array(ENCODE_CHUNK)];
    // The sound fades in and out with the picture (EX-16).
    const fadeFrames = Math.round(manifest.fade * EXPORT_RATE);
    const length = timing.audioFrames / EXPORT_RATE;
    const fadeEncoded = (start: number, count: number, at: number) => {
      for (let i = 0; i < count; i++) {
        const frame = at + i - encodeStart;
        if (frame >= fadeFrames && frame < timing.audioFrames - fadeFrames) continue;
        const gain = fadeAt(manifest.fade, frame / EXPORT_RATE, length);
        pending[0]![start + i]! *= gain;
        pending[1]![start + i]! *= gain;
      }
    };
    let pendingStart = encodeStart;
    let pendingFrames = 0;
    const flush = async () => {
      if (pendingFrames === 0) return;
      const data = new Float32Array(pendingFrames * 2);
      data.set(pending[0]!.subarray(0, pendingFrames), 0);
      data.set(pending[1]!.subarray(0, pendingFrames), pendingFrames);
      const sample = new AudioSample({
        data,
        format: 'f32-planar',
        numberOfChannels: 2,
        sampleRate: EXPORT_RATE,
        timestamp: (pendingStart - encodeStart) / EXPORT_RATE,
      });
      await source.add(sample);
      sample.close();
      pendingStart += pendingFrames;
      pendingFrames = 0;
    };

    const block = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    let stored = 0;
    let rendered = 0;
    let reported = 0;
    const onFrame = (offset: number) => {
      // Output frame o of the music plays stream frame o × rate, in the part that has it.
      const at = (rendered + offset) * sound.rate;
      let index = 0;
      while (index + 1 < starts.length && starts[index + 1]! <= at) index++;
      const beats = gridBeats[index];
      if (beats?.active) {
        const frame = partFrom[index]! + (index === 0 ? at : at - starts[index]!);
        beats.apply(analyzer.frame, frame / EXPORT_RATE, sound.rate);
      }
      if (stored++ < timing.analysisFrames) records.add(analyzer.frame);
    };
    while (stored < timing.analysisFrames || rendered < encodeEnd) {
      await gate();
      await decoded.ensure(lookAhead);
      for (let step = 0; step < BLOCKS_PER_STEP; step++) {
        dsp.renderMusic(decoded, block, BLOCK);
        analyzer.process(block[0]!, block[1]!, BLOCK, onFrame);
        dsp.setBeat(analyzer.frame[F.bpm]!, analyzer.frame[F.beatConfidence]!);
        dsp.renderEffects(block, BLOCK);
        // The part of this block inside the range goes to the encoder.
        const from = Math.max(rendered, encodeStart);
        const to = Math.min(rendered + BLOCK, encodeEnd);
        for (let frame = from; frame < to;) {
          const count = Math.min(to - frame, ENCODE_CHUNK - pendingFrames);
          const offset = frame - rendered;
          pending[0]!.set(block[0]!.subarray(offset, offset + count), pendingFrames);
          pending[1]!.set(block[1]!.subarray(offset, offset + count), pendingFrames);
          if (fadeFrames > 0) fadeEncoded(pendingFrames, count, frame);
          pendingFrames += count;
          frame += count;
          if (pendingFrames === ENCODE_CHUNK) await flush();
        }
        rendered += BLOCK;
      }
      if (performance.now() - reported > REPORT_INTERVAL_MS) {
        reported = performance.now();
        progress({ phase: 'audio', done: Math.min(rendered, total), total });
      }
    }
    await flush();
    await output.finalize();
    output = null;
    // Where the parts start, as decoded: the overlay and the chapters follow them.
    timing.partStarts = starts;
  } finally {
    records.close();
    await decoded?.close().catch(() => undefined);
    await output?.cancel().catch(() => undefined);
  }
}

/** The automatic preset switching of the video (PR-02), frame by frame as in the preview. */
interface Switching {
  /** One frame: gives the scene the settings the switching and its morph have now. */
  frame(dt: number, features: Float32Array): void;
  /** The scene's snapshot with the switching's state added. */
  save(snapshot: SceneSnapshot): SceneSnapshot;
  /** Continues from such a snapshot (the scene gets its settings); returns the scene's part. */
  restore(snapshot: SceneSnapshot): SceneSnapshot;
}

function createSwitching<T>(
  automation: PresetAutomation<T>,
  apply: (settings: T) => void,
): Switching {
  return {
    frame(dt, features) {
      const { settings } = automation.frame(dt, features);
      if (settings) apply(settings);
    },
    save(snapshot) {
      const { values, morph } = automation.saveState();
      return {
        values: { ...snapshot.values, ...values },
        buffers: [...snapshot.buffers, new TextEncoder().encode(morph)],
      };
    },
    restore(snapshot) {
      const morph = snapshot.buffers.at(-1);
      if (!(morph instanceof Uint8Array)) throw new Error('The saved preset switching is missing.');
      automation.restoreState(snapshot.values, new TextDecoder().decode(morph));
      apply(automation.current);
      return { values: snapshot.values, buffers: snapshot.buffers.slice(0, -1) };
    },
  };
}

/**
 * The Logo Spectrum with the Kaleidoscope behind it (VE-08): drawn as in the preview, with one
 * snapshot for both (the layer's values prefixed, its buffers last).
 */
class LayeredScene implements Scene {
  /** The Kaleidoscope look the layer was given last. */
  private shown: KaleidoSettings | null = null;

  /** `fallback`: the Kaleidoscope's own look, for looks without one behind them. */
  constructor(
    private readonly front: LogoSpectrumScene,
    private readonly layer: KaleidoscopeScene,
    private readonly fallback: KaleidoSettings,
  ) {}

  get floatTargets(): boolean {
    return this.front.floatTargets;
  }

  resize(width: number, height: number): void {
    this.front.resize(width, height);
    this.layer.resize(width, height);
  }

  setReduceFlashing(on: boolean): void {
    this.front.setReduceFlashing(on);
  }

  render(input: SceneInput): void {
    // The look behind is the one of the settings shown now, through the switching's morph.
    const look = this.front.layerLook ?? this.fallback;
    if (look !== this.shown) {
      this.layer.setSettings(look);
      this.shown = look;
    }
    this.front.setBackgroundLayer(this.front.wantsLayer ? this.layer.renderLayer(input) : null);
    this.front.render(input);
  }

  saveState(): SceneSnapshot {
    return joinSnapshots(this.front.saveState(), this.layer.saveState(), 'layer.');
  }

  restoreState(snapshot: SceneSnapshot): void {
    const [front, layer] = splitSnapshot(snapshot, 'layer.');
    this.front.restoreState(front);
    this.layer.restoreState(layer);
  }

  dispose(): void {
    this.front.dispose();
    this.layer.dispose();
  }
}

/**
 * The scene of the video, its preset switching, and the Logo Spectrum (for the cover art of
 * each part) when it shows that.
 */
function createScene(
  gl: WebGL2RenderingContext,
  visuals: ExportVisuals,
  images: ResumeArgs['images'],
): { scene: Scene; switching: Switching | null; logo: LogoSpectrumScene | null } {
  const config = visuals.auto?.config.on ? sanitizeAutoPresets(visuals.auto.config) : null;
  if (visuals.mode === 'logoSpectrum') {
    const front = new LogoSpectrumScene(gl);
    const settings = sanitizeSettings(visuals.settings);
    front.setSettings(settings);
    front.setImage('background', images.background);
    front.setImage('logo', images.logo);
    let scene: Scene = front;
    if (visuals.layer) {
      const layer = new KaleidoscopeScene(gl);
      const fallback = sanitizeKaleido(visuals.layer);
      layer.setSettings(fallback);
      scene = new LayeredScene(front, layer, fallback);
    }
    if (!config || !visuals.auto) return { scene, switching: null, logo: front };
    const automation = new PresetAutomation(
      morphLogoSpectrum,
      settings,
      SWITCHING_SEEDS.logoSpectrum,
    );
    automation.setAuto(config, visuals.auto.presets.map(sanitizeSettings));
    const switching = createSwitching(automation, (next) => front.setSettings(next));
    return { scene, switching, logo: front };
  }
  const scene = new KaleidoscopeScene(gl);
  const settings = sanitizeKaleido(visuals.settings);
  scene.setSettings(settings);
  if (!config || !visuals.auto) return { scene, switching: null, logo: null };
  const automation = new PresetAutomation(morphKaleido, settings, SWITCHING_SEEDS.kaleidoscope);
  automation.setAuto(config, visuals.auto.presets.map(sanitizeKaleido));
  const switching = createSwitching(automation, (next) => scene.setSettings(next));
  return { scene, switching, logo: null };
}

/**
 * Pass 2: render and encode the video in segments, from the stored analysis. Over the scene
 * come the track overlay of the part heard, and the fades.
 */
async function videoPass(
  store: JobWriter,
  manifest: ExportManifest,
  pictures: Pictures,
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
  const { scene, switching, logo } = createScene(gl, manifest.visuals, pictures.images);
  // Each part's cover art as the logo (LS-15); it goes with the job only when it is shown so.
  const covers = pictures.covers;
  logo?.setCoverLogo(covers.some((cover) => cover !== null));
  let shownPart = -1;
  // The track overlay (LS-18, LS-19), over the picture: it has no state of its own, its text
  // follows from the frame's place in its part.
  const overlaySettings = manifest.visuals.overlay
    ? sanitizeOverlay(manifest.visuals.overlay)
    : null;
  const overlay = overlaySettings?.on ? new TrackOverlay(gl) : null;
  const tracks = manifest.parts.map(partTrack);
  // The picture fades in and out with the sound (EX-16).
  const fade = manifest.fade > 0 ? new PictureFade(gl) : null;
  const seconds = timing.frames / fps;
  try {
    scene.resize(format.width, format.height);
    scene.setReduceFlashing(manifest.visuals.reduceFlashing === true);
    if (overlay && overlaySettings) {
      overlay.setSettings(overlaySettings);
      overlay.resize(format.width, format.height);
      await overlay.ready();
    }
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
      const snapshot = decodeSnapshot(await state.arrayBuffer());
      // The switching first: the scene continues with the settings it had.
      scene.restoreState(switching ? switching.restore(snapshot) : snapshot);
      const previous = frameTime(timing, fps, n - 1);
      feed.seek(previous);
      sampler.resetTo(previous);
    }

    const render = async (frame: number) => {
      if (lost) throw new Error('The graphics context was lost.');
      const at = frameTime(timing, fps, frame);
      await feed.ensure(at);
      sampler.sample(at, features);
      // The switching counts from the first frame of the video, not in the pre-roll.
      if (frame >= 0) switching?.frame(1 / fps, features);
      const heard = partAt(manifest, fps, frame);
      if (heard.index !== shownPart) {
        shownPart = heard.index;
        logo?.setCover(covers[heard.index] ?? null);
      }
      // The music plays on in a video: what turns with it turns at the tempo (LS-16).
      const played = manifest.sound.rate / fps;
      scene.render({ time: (frame + timing.preRollFrames) / fps, dt: 1 / fps, features, played });
      overlay?.draw(tracks[heard.index]!, heard.seconds, manifest.sound.rate);
      fade?.draw(fadeAt(manifest.fade, frame / fps, seconds), format.width, format.height);
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
        const snapshot = scene.saveState();
        await store.writeFile(
          `state-${segment + 1}.bin`,
          encodeSnapshot(switching ? switching.save(snapshot) : snapshot),
        );
      }
      await store.remove(`state-${segment}.bin`);
      manifest.progress.segmentsDone = segment + 1;
      await store.writeManifest(manifest);
    }
  } finally {
    scene.dispose();
    overlay?.dispose();
    fade?.dispose();
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
  // A video of a batch waits among the others to be downloaded (EX-09).
  const shelf = !destination && manifest.output ? await JobWriter.shelf() : null;
  if (destination) {
    const file = await destination.createWritable();
    target = new StreamTarget(
      new WritableStream<StreamTargetChunk>({
        write: (chunk) => file.write({ type: 'write', position: chunk.position, data: chunk.data }),
        close: () => (abandon ? file.abort() : file.close()),
        abort: () => file.abort(),
      }),
    );
  } else if (shelf) {
    target = await shelf.target(manifest.output!);
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

  const audioInput = openInput(await store.file('audio.mp4'));
  try {
    const audioTrack = await audioInput.getPrimaryAudioTrack();
    if (!audioTrack) throw new Error('The encoded audio is missing.');
    const audioConfig = await audioTrack.getDecoderConfig();
    let videoConfig: VideoDecoderConfig | null = null;

    async function* videoPackets(): AsyncGenerator<EncodedPacket> {
      let sequence = 0;
      for (let segment = 0; segment < timing.segments; segment++) {
        const input = openInput(await store.file(`video-${segment}.mp4`));
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
  const written = destination
    ? await destination.getFile()
    : await (shelf ?? store).file(shelf ? manifest.output! : OUTPUT_FILE);
  return written.size;
}

/** Deletes the job (after cancelling, or when you discard an unfinished export). */
async function discard(): Promise<void> {
  if (running) throw new Error('The export is still running.');
  await clearJob();
}

exposeWorker({ probe, start, resume, pause, unpause, cancel, discard });
