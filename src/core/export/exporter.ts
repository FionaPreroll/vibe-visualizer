import type { BeatGrid } from '../analysis/beat-grid';
import type { SoundSettings } from '../audio/dsp/sound-settings';
import { decodeImage, type StoredImages } from '../render/visual-assets';
import { newerBuild } from '../env/version';
import { keepStorage } from '../state/keep-storage';
import { errorMessage } from '../util/format';
import { WorkerClient } from '../util/worker-rpc';
import {
  CANCELLED,
  coverFile,
  JOB_IMAGES,
  OUTPUT_FILE,
  partChapters,
  partsSeconds,
  uniqueName,
  type Chapter,
  type ExportCodecs,
  type ExportManifest,
  type ExportPart,
  type ExportVisuals,
} from './export-job';
import type {
  ExportProgress,
  ExportResult,
  ImageInput,
  ResumeArgs,
  StartArgs,
} from './export.worker';
import ExportWorker from './export.worker.ts?worker';
import { clearJob, clearShelf, readJobFile, readManifest, readShelfFile } from './job-store';
import type { VideoFormat } from './video-format';

/**
 * Said when the export fails while a newer build of the app is out (NF-09): a tab from before
 * a deploy may no longer find the files of its worker on the server.
 */
const UPDATED = 'A new version of the app came out meanwhile: reload the page';

/**
 * Main-thread face of the export (EX-01…07, EX-15): starts, pauses, cancels and resumes the
 * export worker, keeps the machine awake while it runs (EX-06), and finds an export that was
 * interrupted by a reload or a crash.
 */

/** A track of a video: its part, its file, its beat grid and its cover art. */
export interface RequestPart {
  part: ExportPart;
  file: File;
  /** The file's beat grid, if it has been analysed (AN-07). */
  grid: BeatGrid | null;
  /** The cover art, to show as the logo (LS-15); null: the logo image. */
  cover: Blob | null;
}

export interface ExportRequest {
  /** The tracks of the video, in order (EX-05). */
  parts: RequestPart[];
  format: VideoFormat;
  visuals: ExportVisuals;
  /** Tempo and effects (EX-02). */
  sound: SoundSettings;
  /** Seconds of the fades at the start and the end (EX-16). */
  fade: number;
  images: StoredImages;
  /** The file to write (Chromium); null downloads the video at the end. */
  destination: FileSystemFileHandle | null;
  fileName: string;
  /** Shorter segments (tests). */
  segmentSeconds?: number;
}

/** A finished video of a batch (EX-09). */
export interface BatchVideo {
  fileName: string;
  bytes: number;
  /** Download link when it waits in browser storage; null when it was saved into the folder. */
  url: string | null;
}

export interface RunningExport {
  fileName: string;
  format: VideoFormat;
  /** Seconds of video. */
  duration: number;
  phase: 'starting' | 'audio' | 'video' | 'join';
  /** 0…1 for the whole export. */
  progress: number;
  /** Rendering speed as a multiple of real time. */
  speed: number | null;
  /** Estimated seconds left. */
  remaining: number | null;
  preview: ImageBitmap | null;
  paused: boolean;
  /** In a batch (EX-09): which video this is (from 0) of how many. */
  batch: { index: number; count: number } | null;
}

export type ExportState =
  | { status: 'idle' }
  /** An export stopped before it was finished (a reload, a crash); it can resume. */
  | { status: 'interrupted'; manifest: ExportManifest }
  | { status: 'running'; job: RunningExport }
  | {
      status: 'done';
      fileName: string;
      bytes: number;
      /** Download link when the video is in browser storage; null when it was saved to a file. */
      url: string | null;
      /** Wall-clock seconds the export took; null for one found in storage. */
      seconds: number | null;
      /** Seconds of video. */
      duration: number;
      /** Where each track starts in the video (EX-14). */
      chapters: Chapter[];
      /** The videos of a batch (EX-09), of the `planned` ones; empty for a single video. */
      videos: BatchVideo[];
      planned: number;
    }
  | {
      status: 'failed';
      message: string;
      resumable: boolean;
      /** The videos of a batch finished before (EX-09). */
      videos: BatchVideo[];
    };

/** A batch of videos (EX-09): its requests, the one being made, and the videos finished. */
interface Batch {
  requests: Omit<ExportRequest, 'destination'>[];
  /** Where the videos go (Chromium); null: into browser storage, to be downloaded. */
  folder: FileSystemDirectoryHandle | null;
  index: number;
  videos: BatchVideo[];
  /** The file names used so far. */
  names: Set<string>;
  seconds: number;
  duration: number;
}

/** Shares of the phases in the overall progress. */
const WEIGHTS = { audio: 0.08, video: 0.87, join: 0.05 };

export class Exporter {
  private client: WorkerClient | null = null;
  private current: ExportState = { status: 'idle' };
  private readonly listeners = new Set<(state: ExportState) => void>();
  private wakeLock: WakeLockSentinel | null = null;
  private downloadUrls: string[] = [];
  private cancelling = false;
  /** A batch was cancelled: no more of its videos start. */
  private batchCancelled = false;
  /** The batch being made (EX-09); kept after a failure, so that resuming goes on with it. */
  private batch: Batch | null = null;
  /** Resolves once an interrupted or finished export in storage has been looked for. */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.findStoredJob();
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  get state(): ExportState {
    return this.current;
  }

  /** Svelte store contract. */
  subscribe(listener: (state: ExportState) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  /** The codecs this browser would use for `format` (EX-04). */
  async probe(format: VideoFormat): Promise<ExportCodecs> {
    try {
      return await this.worker().call<ExportCodecs>('probe', format);
    } catch (error) {
      // A worker that could not start stays dead: the next look starts a new one.
      if (this.current.status !== 'running') this.terminate();
      if ((await newerBuild()) !== true) throw error;
      throw new Error(`${errorMessage(error)} ${UPDATED}.`, { cause: error });
    }
  }

  async start(request: ExportRequest): Promise<void> {
    if (this.current.status === 'running') throw new Error('An export is already running.');
    this.batch = null;
    this.cancelling = false;
    this.releaseDownloads();
    await clearShelf();
    const outcome = await this.render(request, null);
    if (!outcome) return;
    const { result, duration } = outcome;
    const url = result.destination === 'download' ? await this.createDownload(result.output) : null;
    this.set({
      status: 'done',
      fileName: result.fileName,
      bytes: result.bytes,
      url,
      seconds: result.seconds,
      duration,
      chapters: result.chapters,
      videos: [],
      planned: 1,
    });
  }

  /**
   * Several videos one after the other (EX-09), one for each request: into new files in
   * `folder` (Chromium), or else into browser storage, to be downloaded. A cancelled batch
   * keeps the videos finished before; after a failure, resuming the video goes on with the rest.
   */
  async startBatch(
    requests: Omit<ExportRequest, 'destination'>[],
    folder: FileSystemDirectoryHandle | null,
  ): Promise<void> {
    if (this.current.status === 'running') throw new Error('An export is already running.');
    this.cancelling = false;
    this.batchCancelled = false;
    this.releaseDownloads();
    await clearShelf();
    this.batch = {
      requests,
      folder,
      index: 0,
      videos: [],
      names: new Set(),
      seconds: 0,
      duration: 0,
    };
    await this.continueBatch(this.batch);
  }

  /** Renders the videos of `batch` from its current one on. */
  private async continueBatch(batch: Batch): Promise<void> {
    const count = batch.requests.length;
    while (batch.index < count && !this.batchCancelled) {
      const request = batch.requests[batch.index]!;
      let outcome: Awaited<ReturnType<Exporter['render']>>;
      try {
        // Each video gets a name of its own, also where two tracks have the same one.
        const { folder } = batch;
        const fileName = folder
          ? await freeName(folder, request.fileName)
          : uniqueName(request.fileName, batch.names);
        batch.names.add(fileName);
        outcome = await this.render(
          { ...request, fileName, destination: null, folder, output: folder ? null : fileName },
          { index: batch.index, count },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.set({ status: 'failed', message, resumable: false, videos: batch.videos });
        return;
      }
      if (!outcome) {
        // A failure shows with the videos finished before, and can resume; after a cancel,
        // those videos are the result.
        if (this.current.status === 'failed') {
          this.set({ ...this.current, videos: batch.videos });
          return;
        }
        break;
      }
      await this.addToBatch(batch, outcome.result, outcome.duration);
    }
    this.batch = null;
    const { videos } = batch;
    if (videos.length === 0) {
      this.set({ status: 'idle' });
      return;
    }
    this.set({
      status: 'done',
      fileName: `${videos.length} video${videos.length === 1 ? '' : 's'}`,
      bytes: videos.reduce((sum, video) => sum + video.bytes, 0),
      url: null,
      seconds: batch.seconds,
      duration: batch.duration,
      chapters: [],
      videos,
      planned: count,
    });
  }

  /** A video of `batch` is finished: it is listed, and the batch moves on to the next. */
  private async addToBatch(batch: Batch, result: ExportResult, duration: number): Promise<void> {
    const url = result.destination === 'download' ? await this.createDownload(result.output) : null;
    batch.videos.push({ fileName: result.fileName, bytes: result.bytes, url });
    batch.seconds += result.seconds;
    batch.duration += duration;
    batch.index++;
  }

  /** Renders one video; null if it was cancelled or failed (the state says which). */
  private async render(
    request: ExportRequest & Pick<StartArgs, 'folder' | 'output'>,
    batch: RunningExport['batch'],
  ): Promise<{ result: ExportResult; duration: number } | null> {
    const images: StartArgs['images'] = { background: null, logo: null };
    const covers: StartArgs['covers'] = request.parts.map(() => null);
    const transfer: Transferable[] = [];
    const decode = async (blob: Blob): Promise<ImageInput> => {
      const input = { blob, bitmap: await decodeImage(blob) };
      transfer.push(input.bitmap);
      return input;
    };
    if (request.visuals.mode === 'logoSpectrum') {
      for (const kind of JOB_IMAGES) {
        const blob = request.images[kind]?.blob;
        if (blob) images[kind] = await decode(blob);
      }
      for (const [index, { cover }] of request.parts.entries()) {
        if (cover) covers[index] = await decode(cover).catch(() => null);
      }
    }
    const parts = request.parts.map((entry) => entry.part);
    const args: StartArgs = {
      parts,
      files: request.parts.map((entry) => entry.file),
      format: request.format,
      visuals: request.visuals,
      sound: request.sound,
      fade: request.fade,
      grids: request.parts.map((entry) => entry.grid),
      images,
      covers,
      destination: request.destination,
      fileName: request.fileName,
      folder: request.folder ?? null,
      output: request.output ?? null,
      segmentSeconds: request.segmentSeconds,
    };
    const duration = partsSeconds(parts, request.sound);
    const result = await this.run('start', args, transfer, request, duration, batch);
    return result ? { result, duration } : null;
  }

  /**
   * Continues an interrupted export; `files` (those of its parts, in order) are only needed if
   * its audio was not finished.
   */
  async resume(files: (File | null)[], destination: FileSystemFileHandle | null): Promise<void> {
    if (this.current.status !== 'interrupted' && this.current.status !== 'failed') return;
    const manifest = await readManifest();
    if (!manifest || manifest.progress.finished) {
      this.set({ status: 'idle' });
      return;
    }
    const images: ResumeArgs['images'] = { background: null, logo: null };
    const transfer: Transferable[] = [];
    for (const kind of JOB_IMAGES) {
      const bitmap = await jobImage(manifest, `image-${kind}`, manifest.images[kind]);
      images[kind] = bitmap;
      if (bitmap) transfer.push(bitmap);
    }
    const covers: ResumeArgs['covers'] = [];
    for (const [index, type] of manifest.images.covers.entries()) {
      const bitmap = await jobImage(manifest, coverFile(index), type);
      covers.push(bitmap);
      if (bitmap) transfer.push(bitmap);
    }
    const batch = this.batch;
    // A video of a batch that failed goes into the batch's folder, as it would have.
    const folder = !destination && manifest.destination === 'file' ? (batch?.folder ?? null) : null;
    const args: ResumeArgs = { files, images, covers, destination, folder };
    const duration = manifest.timing.frames / manifest.format.fps;
    const position = batch ? { index: batch.index, count: batch.requests.length } : null;
    this.cancelling = false;
    this.batchCancelled = false;
    const result = await this.run('resume', args, transfer, manifest, duration, position);
    if (!result) {
      const state = this.state;
      if (batch && state.status === 'failed') this.set({ ...state, videos: batch.videos });
      if (batch && state.status === 'idle') {
        // Cancelled: the batch ends with the videos it has.
        this.batchCancelled = true;
        await this.continueBatch(batch);
      }
      return;
    }
    if (batch) {
      // The video of a batch that failed: the batch goes on with the next one.
      await this.addToBatch(batch, result, duration);
      await this.continueBatch(batch);
      return;
    }
    const url = result.destination === 'download' ? await this.createDownload(result.output) : null;
    this.set({
      status: 'done',
      fileName: result.fileName,
      bytes: result.bytes,
      url,
      seconds: result.seconds,
      duration,
      chapters: result.chapters,
      videos: [],
      planned: 1,
    });
  }

  /** The folder of the batch being made (EX-09), if its videos go into one. */
  get batchFolder(): FileSystemDirectoryHandle | null {
    return this.batch?.folder ?? null;
  }

  pause(): void {
    if (this.current.status !== 'running') return;
    void this.client?.call('pause');
    this.update({ paused: true, speed: null, remaining: null });
  }

  unpause(): void {
    if (this.current.status !== 'running') return;
    void this.client?.call('unpause');
    this.update({ paused: false });
  }

  /** Stops the export (and the rest of a batch) and deletes what it wrote. */
  async cancel(): Promise<void> {
    if (this.current.status !== 'running') {
      await this.discard();
      return;
    }
    this.cancelling = true;
    this.batchCancelled = true;
    // The worker stops at its next frame; if it hangs (a stuck encoder), it is terminated.
    const client = this.client;
    setTimeout(() => {
      if (this.cancelling && this.client === client) this.terminate();
    }, 5000);
    await client?.call('cancel').catch(() => undefined);
  }

  /** Forgets an interrupted, failed or finished export (or batch) and frees its storage. */
  async discard(): Promise<void> {
    this.batch = null;
    this.releaseDownloads();
    this.terminate();
    await removeJob();
    await clearShelf();
    this.set({ status: 'idle' });
  }

  /** Closes the "done" message; a downloadable video stays until the next export. */
  dismiss(): void {
    if (this.current.status === 'done' || this.current.status === 'failed') {
      this.batch = null;
      this.set({ status: 'idle' });
    }
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.terminate();
    this.releaseDownloads();
    void this.wakeLock?.release();
  }

  /**
   * Runs the worker's export; its result, or null when it was cancelled (the state is idle) or
   * failed (the state says why).
   */
  private async run(
    method: 'start' | 'resume',
    args: StartArgs | ResumeArgs,
    transfer: Transferable[],
    job: { fileName: string; format: VideoFormat },
    duration: number,
    batch: RunningExport['batch'],
  ): Promise<ExportResult | null> {
    const client = this.worker();
    this.set({
      status: 'running',
      job: {
        fileName: job.fileName,
        format: job.format,
        duration,
        phase: 'starting',
        progress: 0,
        speed: null,
        remaining: null,
        preview: null,
        paused: false,
        batch,
      },
    });
    void this.keepAwake();
    // Its segments wait in browser storage until it is finished.
    void keepStorage();
    try {
      return await client.call<ExportResult>(method, args, {
        transfer,
        onProgress: (update: ExportProgress) => this.onProgress(update),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === CANCELLED || this.cancelling) {
        this.terminate();
        await removeJob();
        this.set({ status: 'idle' });
      } else {
        const manifest = await readManifest();
        const resumable = manifest !== null && !manifest.progress.finished;
        const updated = (await newerBuild()) === true;
        this.set({
          status: 'failed',
          message: updated
            ? `${message} ${UPDATED}, then ${resumable ? 'resume' : 'start'} the export again.`
            : message,
          resumable,
          videos: [],
        });
      }
      return null;
    } finally {
      this.cancelling = false;
      void this.wakeLock?.release();
      this.wakeLock = null;
    }
  }

  private onProgress(update: ExportProgress): void {
    if (this.current.status !== 'running') {
      if (update.phase === 'video') update.preview?.close();
      return;
    }
    const job = this.current.job;
    const fraction = update.total > 0 ? update.done / update.total : 0;
    if (update.phase === 'audio') {
      this.update({ phase: 'audio', progress: WEIGHTS.audio * fraction });
    } else if (update.phase === 'video') {
      const fps = job.format.fps;
      const rate = update.framesPerSecond;
      const changes: Partial<RunningExport> = {
        phase: 'video',
        progress: WEIGHTS.audio + WEIGHTS.video * fraction,
        speed: rate > 0 && !job.paused ? rate / fps : null,
        remaining: rate > 0 && !job.paused ? (update.total - update.done) / rate : null,
      };
      if (update.preview) {
        job.preview?.close();
        changes.preview = update.preview;
      }
      this.update(changes);
    } else {
      this.update({
        phase: 'join',
        progress: WEIGHTS.audio + WEIGHTS.video + WEIGHTS.join * fraction,
        remaining: null,
      });
    }
  }

  private update(changes: Partial<RunningExport>): void {
    if (this.current.status !== 'running') return;
    this.set({ status: 'running', job: { ...this.current.job, ...changes } });
  }

  private set(state: ExportState): void {
    const previous = this.current;
    if (previous.status === 'running' && state.status !== 'running') previous.job.preview?.close();
    this.current = state;
    for (const listener of this.listeners) listener(state);
  }

  private worker(): WorkerClient {
    this.client ??= new WorkerClient(new ExportWorker());
    return this.client;
  }

  private terminate(): void {
    this.client?.terminate();
    this.client = null;
  }

  /**
   * A download link for a finished video in browser storage: the job's own, or `output` among
   * the videos of a batch.
   */
  private async createDownload(output: string | null = null): Promise<string> {
    const file = output ? await readShelfFile(output) : await readJobFile(OUTPUT_FILE);
    const url = URL.createObjectURL(file);
    this.downloadUrls.push(url);
    return url;
  }

  private releaseDownloads(): void {
    for (const url of this.downloadUrls) URL.revokeObjectURL(url);
    this.downloadUrls = [];
  }

  private async findStoredJob(): Promise<void> {
    const manifest = await readManifest();
    if (!manifest || this.current.status !== 'idle') return;
    if (!manifest.progress.finished) {
      this.set({ status: 'interrupted', manifest });
      return;
    }
    // A finished video that was not downloaded before the page was closed.
    try {
      const url = await this.createDownload(manifest.output ?? null);
      this.set({
        status: 'done',
        fileName: manifest.fileName,
        bytes: manifest.progress.bytes ?? 0,
        url,
        seconds: null,
        duration: manifest.timing.frames / manifest.format.fps,
        chapters: partChapters(manifest.parts, manifest.timing, manifest.sound),
        videos: [],
        planned: 1,
      });
    } catch {
      await removeJob();
    }
  }

  /** Keeps the screen (and so the machine) awake while exporting (EX-06). */
  private async keepAwake(): Promise<void> {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // Not allowed (e.g. battery saver): the export still runs.
    }
  }

  /** Browsers release the wake lock when the page is hidden; take it again on return. */
  private readonly onVisibility = () => {
    if (document.visibilityState === 'visible' && this.current.status === 'running') {
      void this.keepAwake();
    }
  };
}

/** A name for a new file in `folder`: `name`, or a numbered one where that file exists. */
async function freeName(folder: FileSystemDirectoryHandle, name: string): Promise<string> {
  const taken = new Set<string>();
  for (let candidate = name; ; candidate = uniqueName(name, taken)) {
    try {
      await folder.getFileHandle(candidate);
      taken.add(candidate);
    } catch {
      return candidate;
    }
  }
}

/** Deletes the job; retries while a terminated worker still holds its files. */
async function removeJob(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    await clearJob();
    if (!(await readManifest())) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** An image stored with an export job (`name`, of MIME type `type`), decoded for rendering. */
async function jobImage(
  manifest: ExportManifest,
  name: string,
  type: string | null | undefined,
): Promise<ImageBitmap | null> {
  if (!type || manifest.visuals.mode !== 'logoSpectrum') return null;
  try {
    const file = await readJobFile(name);
    return await decodeImage(file.slice(0, file.size, type));
  } catch {
    return null;
  }
}

/** Whether the browser can write the video straight into a file you pick (Chromium). */
export function canPickFile(): boolean {
  return 'showSaveFilePicker' in window;
}

/** Whether the browser can write the videos of a batch into a folder you pick (Chromium). */
export function canPickFolder(): boolean {
  return 'showDirectoryPicker' in window;
}

/** Asks for the folder of a batch's videos; throws an AbortError when you cancel the dialog. */
export function pickFolder(): Promise<FileSystemDirectoryHandle> {
  const host = window as unknown as {
    showDirectoryPicker(options: {
      id?: string;
      mode?: 'read' | 'readwrite';
      startIn?: string;
    }): Promise<FileSystemDirectoryHandle>;
  };
  return host.showDirectoryPicker({ id: 'videos', mode: 'readwrite', startIn: 'videos' });
}

/** Asks where to save the video; throws an AbortError when you cancel the dialog. */
export function pickFile(
  fileName: string,
  container: 'mp4' | 'webm',
): Promise<FileSystemFileHandle> {
  const host = window as unknown as {
    showSaveFilePicker(options: {
      suggestedName: string;
      types: { description: string; accept: Record<string, string[]> }[];
    }): Promise<FileSystemFileHandle>;
  };
  return host.showSaveFilePicker({
    suggestedName: fileName,
    types: [
      {
        description: container === 'mp4' ? 'MP4 video' : 'WebM video',
        accept: { [`video/${container}`]: [`.${container}`] },
      },
    ],
  });
}
