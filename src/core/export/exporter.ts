import type { ImageKind } from '../render/logo-spectrum';
import { decodeImage, type StoredImages } from '../render/visual-assets';
import { WorkerClient } from '../util/worker-rpc';
import {
  CANCELLED,
  OUTPUT_FILE,
  type ExportCodecs,
  type ExportManifest,
  type ExportSource,
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
import { clearJob, readJobFile, readManifest } from './job-store';
import type { VideoFormat } from './video-format';

/**
 * Main-thread face of the export (EX-01…07, EX-15): starts, pauses, cancels and resumes the
 * export worker, keeps the machine awake while it runs (EX-06), and finds an export that was
 * interrupted by a reload or a crash.
 */

export interface ExportRequest {
  file: File;
  source: ExportSource;
  range: { start: number; end: number };
  format: VideoFormat;
  visuals: ExportVisuals;
  images: StoredImages;
  /** The file to write (Chromium); null downloads the video at the end. */
  destination: FileSystemFileHandle | null;
  fileName: string;
  /** Shorter segments (tests). */
  segmentSeconds?: number;
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
      seconds: number | null;
    }
  | { status: 'failed'; message: string; resumable: boolean };

/** Shares of the phases in the overall progress. */
const WEIGHTS = { audio: 0.08, video: 0.87, join: 0.05 };

export class Exporter {
  private client: WorkerClient | null = null;
  private current: ExportState = { status: 'idle' };
  private readonly listeners = new Set<(state: ExportState) => void>();
  private wakeLock: WakeLockSentinel | null = null;
  private downloadUrl: string | null = null;
  private cancelling = false;
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
  probe(format: VideoFormat): Promise<ExportCodecs> {
    return this.worker().call<ExportCodecs>('probe', format);
  }

  async start(request: ExportRequest): Promise<void> {
    if (this.current.status === 'running') throw new Error('An export is already running.');
    this.releaseDownload();
    const images: StartArgs['images'] = { background: null, logo: null };
    const transfer: Transferable[] = [];
    if (request.visuals.mode === 'logoSpectrum') {
      for (const kind of ['background', 'logo'] as const) {
        const stored = request.images[kind];
        if (!stored) continue;
        const input: ImageInput = { blob: stored.blob, bitmap: await decodeImage(stored.blob) };
        images[kind] = input;
        transfer.push(input.bitmap);
      }
    }
    const args: StartArgs = {
      file: request.file,
      source: request.source,
      range: request.range,
      format: request.format,
      visuals: request.visuals,
      images,
      destination: request.destination,
      fileName: request.fileName,
      segmentSeconds: request.segmentSeconds,
    };
    await this.run('start', args, transfer, request.fileName, request.format, request.range);
  }

  /** Continues an interrupted export; `file` is only needed if its audio was not finished. */
  async resume(file: File | null, destination: FileSystemFileHandle | null): Promise<void> {
    if (this.current.status !== 'interrupted' && this.current.status !== 'failed') return;
    const manifest = await readManifest();
    if (!manifest || manifest.progress.finished) {
      this.set({ status: 'idle' });
      return;
    }
    const images: ResumeArgs['images'] = { background: null, logo: null };
    const transfer: Transferable[] = [];
    for (const kind of ['background', 'logo'] as const) {
      const bitmap = await jobImage(manifest, kind);
      images[kind] = bitmap;
      if (bitmap) transfer.push(bitmap);
    }
    const args: ResumeArgs = { file, images, destination };
    await this.run('resume', args, transfer, manifest.fileName, manifest.format, manifest.range);
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

  /** Stops the export and deletes what it wrote. */
  async cancel(): Promise<void> {
    if (this.current.status !== 'running') {
      await this.discard();
      return;
    }
    this.cancelling = true;
    // The worker stops at its next frame; if it hangs (a stuck encoder), it is terminated.
    const client = this.client;
    setTimeout(() => {
      if (this.cancelling && this.client === client) this.terminate();
    }, 5000);
    await client?.call('cancel').catch(() => undefined);
  }

  /** Forgets an interrupted, failed or finished export and frees its storage. */
  async discard(): Promise<void> {
    this.releaseDownload();
    this.terminate();
    await removeJob();
    this.set({ status: 'idle' });
  }

  /** Closes the "done" message; a downloadable video stays until the next export. */
  dismiss(): void {
    if (this.current.status === 'done' || this.current.status === 'failed') {
      this.set({ status: 'idle' });
    }
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.terminate();
    this.releaseDownload();
    void this.wakeLock?.release();
  }

  private async run(
    method: 'start' | 'resume',
    args: StartArgs | ResumeArgs,
    transfer: Transferable[],
    fileName: string,
    format: VideoFormat,
    range: { start: number; end: number },
  ): Promise<void> {
    const client = this.worker();
    this.set({
      status: 'running',
      job: {
        fileName,
        format,
        duration: range.end - range.start,
        phase: 'starting',
        progress: 0,
        speed: null,
        remaining: null,
        preview: null,
        paused: false,
      },
    });
    void this.keepAwake();
    try {
      const result = await client.call<ExportResult>(method, args, {
        transfer,
        onProgress: (update: ExportProgress) => this.onProgress(update),
      });
      const url = result.destination === 'download' ? await this.createDownload() : null;
      this.set({
        status: 'done',
        fileName: result.fileName,
        bytes: result.bytes,
        url,
        seconds: result.seconds,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === CANCELLED || this.cancelling) {
        this.terminate();
        await removeJob();
        this.set({ status: 'idle' });
      } else {
        const manifest = await readManifest();
        this.set({
          status: 'failed',
          message,
          resumable: manifest !== null && !manifest.progress.finished,
        });
      }
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

  /** A download link for the finished video in browser storage. */
  private async createDownload(): Promise<string> {
    this.releaseDownload();
    this.downloadUrl = URL.createObjectURL(await readJobFile(OUTPUT_FILE));
    return this.downloadUrl;
  }

  private releaseDownload(): void {
    if (this.downloadUrl) URL.revokeObjectURL(this.downloadUrl);
    this.downloadUrl = null;
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
      const url = await this.createDownload();
      this.set({
        status: 'done',
        fileName: manifest.fileName,
        bytes: manifest.progress.bytes ?? 0,
        url,
        seconds: null,
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

/** Deletes the job; retries while a terminated worker still holds its files. */
async function removeJob(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    await clearJob();
    if (!(await readManifest())) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** An image stored with an export job, decoded for rendering. */
async function jobImage(manifest: ExportManifest, kind: ImageKind): Promise<ImageBitmap | null> {
  const type = manifest.images[kind];
  if (!type || manifest.visuals.mode !== 'logoSpectrum') return null;
  try {
    const file = await readJobFile(`image-${kind}`);
    return await decodeImage(file.slice(0, file.size, type));
  } catch {
    return null;
  }
}

/** Whether the browser can write the video straight into a file you pick (Chromium). */
export function canPickFile(): boolean {
  return 'showSaveFilePicker' in window;
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
