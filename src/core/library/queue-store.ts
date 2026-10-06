import type { Track } from '../state/app-state';

/**
 * The queue over reloads (SRC-05), in IndexedDB: what the queue knows about each entry, and a
 * handle to its file where the browser gives one (Chromium). An entry without a handle comes
 * back without its file; adding the file again brings the entry back to life.
 */

const DB_NAME = 'vibe-visualizer';
const DB_VERSION = 1;
const STORE = 'queue';
const KEY = 'current';

/**
 * What is kept of a queue entry: what the queue shows while the file is not there. The rest
 * (the cover, whether it plays) is found out again from the file; cues are kept by file.
 */
export type StoredTrackInfo = Pick<
  Track,
  | 'fileName'
  | 'size'
  | 'title'
  | 'artist'
  | 'album'
  | 'duration'
  | 'sampleRate'
  | 'codec'
  | 'format'
  | 'fingerprint'
>;

export interface StoredEntry {
  id: string;
  info: StoredTrackInfo;
  handle: FileSystemFileHandle | null;
}

export interface StoredQueue {
  entries: StoredEntry[];
  currentId: string | null;
}

/** Access to a handle's file: yes, ask the user first, or no. */
export type Access = 'granted' | 'prompt' | 'denied';

/** Chromium: permissions on handles. */
interface PermissionHandle {
  queryPermission?: (options: { mode: 'read' }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: 'read' }) => Promise<PermissionState>;
}

let database: Promise<IDBDatabase> | null = null;
/** Deleted: from then on nothing is stored (the app reloads next). */
let forgotten = false;

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB is not available'));
    request.onblocked = () => reject(new Error('IndexedDB is blocked'));
  }).catch((error: unknown) => {
    database = null;
    throw error;
  });
  return database;
}

function run<T>(mode: IDBTransactionMode, use: (store: IDBObjectStore) => IDBRequest<T>) {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = use(transaction.objectStore(STORE));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error ?? request.error);
        transaction.onabort = () => reject(transaction.error ?? new Error('Aborted'));
      }),
  );
}

/** The queue stored last, or null (nothing stored, or storage not available). */
export async function loadQueue(): Promise<StoredQueue | null> {
  try {
    return parseQueue(await run('readonly', (store) => store.get(KEY)));
  } catch {
    return null;
  }
}

/** Stores the queue; fails quietly (storage blocked or full). */
export async function saveQueue(queue: StoredQueue): Promise<void> {
  if (forgotten) return;
  try {
    await run('readwrite', (store) => store.put(queue, KEY));
  } catch (error) {
    // A browser that cannot store handles still keeps the entries.
    if (!(error instanceof DOMException && error.name === 'DataCloneError')) return;
    const entries = queue.entries.map((entry) => ({ ...entry, handle: null }));
    await run('readwrite', (store) => store.put({ ...queue, entries }, KEY)).catch(() => undefined);
  }
}

/**
 * Deletes the stored queue (UI-12), database and all; from then on nothing is stored. Fails
 * quietly: a database another tab keeps open goes once that closes.
 */
export async function forgetQueue(): Promise<void> {
  forgotten = true;
  const open = database;
  database = null;
  (await open?.catch(() => null))?.close();
  await new Promise<void>((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** The stored queue checked field by field: it may come from an older version. */
export function parseQueue(value: unknown): StoredQueue | null {
  if (!value || typeof value !== 'object') return null;
  const { entries, currentId } = value as { entries?: unknown; currentId?: unknown };
  if (!Array.isArray(entries)) return null;
  const parsed = entries.map(parseEntry).filter((entry) => entry !== null);
  const ids = new Set(parsed.map((entry) => entry.id));
  return {
    entries: parsed,
    currentId: typeof currentId === 'string' && ids.has(currentId) ? currentId : null,
  };
}

function parseEntry(value: unknown): StoredEntry | null {
  if (!value || typeof value !== 'object') return null;
  const { id, info, handle } = value as {
    id?: unknown;
    info?: Record<string, unknown>;
    handle?: unknown;
  };
  if (typeof id !== 'string' || !info || typeof info !== 'object') return null;
  if (typeof info.fileName !== 'string' || typeof info.size !== 'number') return null;
  const text = (key: string) => (typeof info[key] === 'string' ? (info[key] as string) : null);
  const number = (key: string) =>
    typeof info[key] === 'number' && Number.isFinite(info[key]) ? (info[key] as number) : null;
  return {
    id,
    info: {
      fileName: info.fileName,
      size: info.size,
      title: text('title') ?? info.fileName,
      artist: text('artist'),
      album: text('album'),
      duration: number('duration'),
      sampleRate: number('sampleRate'),
      codec: text('codec'),
      format: text('format'),
      fingerprint: text('fingerprint'),
    },
    handle: isFileHandle(handle) ? handle : null,
  };
}

function isFileHandle(value: unknown): value is FileSystemFileHandle {
  return (
    typeof FileSystemFileHandle !== 'undefined' &&
    value instanceof FileSystemFileHandle &&
    value.kind === 'file'
  );
}

/** Whether the file behind `handle` can be read now, or the user has to allow it first. */
export async function accessOf(handle: FileSystemFileHandle): Promise<Access> {
  const query = (handle as PermissionHandle).queryPermission;
  if (typeof query !== 'function') return 'granted';
  return query.call(handle, { mode: 'read' });
}

/** Asks the user for access to the file behind `handle`; call it from a click. */
export async function requestAccess(handle: FileSystemFileHandle): Promise<boolean> {
  const request = (handle as PermissionHandle).requestPermission;
  if (typeof request !== 'function') return true;
  return (await request.call(handle, { mode: 'read' })) === 'granted';
}

/** What to keep of `track`. */
export function storedInfo(track: Track): StoredTrackInfo {
  return {
    fileName: track.fileName,
    size: track.size,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    sampleRate: track.sampleRate,
    codec: track.codec,
    format: track.format,
    fingerprint: track.fingerprint,
  };
}
