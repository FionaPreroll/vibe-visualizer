import { StreamTarget, type StreamTargetChunk } from 'mediabunny';
import type { ExportManifest } from './export-job';

/**
 * Storage of the export job in the Origin Private File System (EX-07, EX-15): the manifest,
 * the encoded audio, the analysis, video segments, scene snapshots and the job's images.
 * Writing uses synchronous access handles, which only exist in dedicated workers; reading works
 * everywhere, so the main thread can find an interrupted job and fetch the finished file.
 */

const DIRECTORY = 'export-job';
const MANIFESTS = ['manifest-a.json', 'manifest-b.json'];

// FileSystemSyncAccessHandle is only in the worker lib; the project compiles with the DOM lib.
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

async function directory(create: boolean): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIRECTORY, { create });
}

/** The job's manifest, or null if there is none (or it cannot be read). */
export async function readManifest(): Promise<ExportManifest | null> {
  let best: ExportManifest | null = null;
  try {
    const dir = await directory(false);
    for (const name of MANIFESTS) {
      try {
        const file = await (await dir.getFileHandle(name)).getFile();
        const manifest = JSON.parse(await file.text()) as ExportManifest;
        if (manifest.version === 1 && (!best || manifest.sequence > best.sequence)) {
          best = manifest;
        }
      } catch {
        // Missing, or torn by a crash while writing: the other one is intact.
      }
    }
  } catch {
    return null;
  }
  return best;
}

/** A file of the job, for reading. */
export async function readJobFile(name: string): Promise<File> {
  const dir = await directory(false);
  return (await dir.getFileHandle(name)).getFile();
}

/** Deletes the whole job. */
export async function clearJob(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(DIRECTORY, { recursive: true }).catch(() => undefined);
}

/** Writes in the job directory (dedicated workers only). */
export class JobWriter {
  private constructor(private readonly dir: FileSystemDirectoryHandle) {}

  static async open(): Promise<JobWriter> {
    return new JobWriter(await directory(true));
  }

  /** Opens a file for synchronous writes, truncated unless `keep`. */
  async open(name: string, keep = false): Promise<SyncAccessHandle> {
    const file = (await this.dir.getFileHandle(name, { create: true })) as SyncFileHandle;
    // Right after a reload, the old page's worker may still hold the file for a moment.
    for (let attempt = 0; ; attempt++) {
      try {
        const handle = await file.createSyncAccessHandle();
        if (!keep) handle.truncate(0);
        return handle;
      } catch (error) {
        const busy = error instanceof DOMException && error.name === 'NoModificationAllowedError';
        if (!busy || attempt >= 20) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  /** Writes the manifest into the older of the two manifest files. */
  async writeManifest(manifest: ExportManifest): Promise<void> {
    manifest.sequence++;
    const handle = await this.open(MANIFESTS[manifest.sequence % 2]!);
    try {
      handle.write(new TextEncoder().encode(JSON.stringify(manifest)), { at: 0 });
      handle.flush();
    } finally {
      handle.close();
    }
  }

  async writeFile(name: string, data: Blob | Uint8Array<ArrayBuffer>): Promise<void> {
    const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
    const handle = await this.open(name);
    try {
      handle.write(bytes, { at: 0 });
      handle.flush();
    } finally {
      handle.close();
    }
  }

  /** A Mediabunny target that writes the file `name` (with seeking, as MP4 needs). */
  async target(name: string): Promise<StreamTarget> {
    const handle = await this.open(name);
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

  async file(name: string): Promise<File> {
    return (await this.dir.getFileHandle(name)).getFile();
  }

  async remove(name: string): Promise<void> {
    await this.dir.removeEntry(name).catch(() => undefined);
  }
}

/** Appends fixed-size float records to a job file, in blocks (the analysis of the export). */
export class RecordWriter {
  private readonly block: Float32Array;
  private used = 0;
  private position = 0;

  constructor(
    private readonly handle: SyncAccessHandle,
    private readonly fields: number,
    blockRecords = 1024,
  ) {
    this.block = new Float32Array(fields * blockRecords);
  }

  /** Appends the first `fields` values of `values`. */
  add(values: Float32Array): void {
    this.block.set(values.subarray(0, this.fields), this.used);
    this.used += this.fields;
    if (this.used === this.block.length) this.flush();
  }

  close(): void {
    this.flush();
    this.handle.flush();
    this.handle.close();
  }

  private flush(): void {
    if (this.used === 0) return;
    const bytes = new Uint8Array(this.block.buffer, 0, this.used * 4);
    this.position += this.handle.write(bytes, { at: this.position });
    this.used = 0;
  }
}
