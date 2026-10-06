import { ANALYSIS_DIRECTORY } from '../library/analysis-cache';
import { forgetQueue } from '../library/queue-store';
import { COVER_DIRECTORY, COVER_FILE } from '../library/track-covers';
import { ASSET_DIRECTORY } from '../render/visual-assets';
import { setSaving, STORAGE_PREFIX, TRACK_PREFIX } from './persistence';

/**
 * What the app keeps in this browser, by kind, and deleting it (UI-12): the analysis of tracks
 * (by fingerprint), the details of tracks (their cues, markers, tempos, names, colours and looks
 * in localStorage, and covers of the user's), the rest (settings, presets, images, controllers),
 * and everything at once. What belongs to a track in the queue stays unless all goes: the app
 * holds it while the track is there, and would write it back.
 */

/** Directories of exports in the Origin Private File System (see the export's job store). */
const EXPORT_DIRECTORIES = ['export-job', 'export-videos'];
/** A file of the track analysis: a fingerprint, ".bin". */
const ANALYSIS_FILE = /^([\w-]+)\.bin$/;

/** Some of what the app keeps: how many (tracks, files) and how many bytes. */
export interface StoredPart {
  count: number;
  bytes: number;
}

/** What the app keeps in this browser. */
export interface StorageSummary {
  /** The track analysis, of all tracks and of those not in the queue. */
  analysis: StoredPart & { unused: StoredPart };
  /** Tracks with details or a cover of the user's, all and those not in the queue. */
  tracks: StoredPart & { unused: StoredPart };
  /** An unfinished export, and videos waiting to be downloaded (files). */
  exports: StoredPart;
  /** The settings, presets, images and controllers (entries and images). */
  rest: StoredPart;
  /** All the browser counts for this site (the total of it, with its overhead); null: unknown. */
  total: number | null;
}

/** A file in the Origin Private File System: its name and size. */
export interface StoredFile {
  name: string;
  bytes: number;
}

const EMPTY: StoredPart = { count: 0, bytes: 0 };

/** Bytes an entry of localStorage takes: its key and value, in UTF-16. */
export function entryBytes(key: string, value: string): number {
  return (key.length + value.length) * 2;
}

/**
 * The details of tracks in `entries` (the app's localStorage entries) and `covers` (cover
 * files), by fingerprint, with their bytes.
 */
export function trackBytes(
  entries: Record<string, string>,
  covers: readonly StoredFile[],
): Map<string, number> {
  const tracks = new Map<string, number>();
  for (const [key, value] of Object.entries(entries)) {
    if (!key.startsWith(TRACK_PREFIX)) continue;
    const fingerprint = key.slice(TRACK_PREFIX.length);
    tracks.set(fingerprint, (tracks.get(fingerprint) ?? 0) + entryBytes(key, value));
  }
  for (const { name, bytes } of covers) {
    if (COVER_FILE.test(name)) tracks.set(name, (tracks.get(name) ?? 0) + bytes);
  }
  return tracks;
}

/** The analysis files in `files`, by fingerprint, with their bytes. */
export function analysisBytes(files: readonly StoredFile[]): Map<string, number> {
  const tracks = new Map<string, number>();
  for (const { name, bytes } of files) {
    const fingerprint = ANALYSIS_FILE.exec(name)?.[1];
    if (fingerprint) tracks.set(fingerprint, bytes);
  }
  return tracks;
}

/** All of `tracks`, and those not in the queue (`inQueue`: fingerprints). */
export function split(
  tracks: ReadonlyMap<string, number>,
  inQueue: ReadonlySet<string>,
): StoredPart & { unused: StoredPart } {
  let bytes = 0;
  const unused = { count: 0, bytes: 0 };
  for (const [fingerprint, size] of tracks) {
    bytes += size;
    if (inQueue.has(fingerprint)) continue;
    unused.count++;
    unused.bytes += size;
  }
  return { count: tracks.size, bytes, unused };
}

/** "3.4 MB", "820 KB", "12 bytes" */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} byte${bytes === 1 ? '' : 's'}`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** The app's entries in localStorage. */
function appEntries(): Record<string, string> {
  const entries: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = key?.startsWith(STORAGE_PREFIX) ? localStorage.getItem(key) : null;
      if (key && value !== null) entries[key] = value;
    }
  } catch {
    // Storage blocked.
  }
  return entries;
}

async function root(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await navigator.storage.getDirectory();
  } catch {
    return null; // no Origin Private File System (e.g. a private window)
  }
}

async function subdirectory(name: string): Promise<FileSystemDirectoryHandle | null> {
  return (await root())?.getDirectoryHandle(name).catch(() => null) ?? null;
}

type Entries = AsyncIterable<[string, FileSystemHandle]>;

/** The files in `dir`, and in its directories when `deep`. */
async function files(dir: FileSystemDirectoryHandle | null, deep = false): Promise<StoredFile[]> {
  const found: StoredFile[] = [];
  if (!dir) return found;
  for await (const [name, handle] of dir as unknown as Entries) {
    if (handle.kind === 'file') {
      const file = await (handle as FileSystemFileHandle).getFile().catch(() => null);
      if (file) found.push({ name, bytes: file.size });
    } else if (deep) {
      found.push(...(await files(handle as FileSystemDirectoryHandle, true)));
    }
  }
  return found;
}

const sum = (list: readonly StoredFile[]) => list.reduce((total, file) => total + file.bytes, 0);

/** What the app keeps in this browser now; `inQueue`: the fingerprints of the queue's tracks. */
export async function summarizeStorage(inQueue: ReadonlySet<string>): Promise<StorageSummary> {
  const entries = appEntries();
  const covers = await files(await subdirectory(COVER_DIRECTORY));
  const analysis = await files(await subdirectory(ANALYSIS_DIRECTORY));
  const exports = (
    await Promise.all(EXPORT_DIRECTORIES.map(async (name) => files(await subdirectory(name), true)))
  ).flat();
  const images = await files(await subdirectory(ASSET_DIRECTORY));
  const rest = Object.entries(entries).filter(([key]) => !key.startsWith(TRACK_PREFIX));
  let total: number | null = null;
  try {
    total = (await navigator.storage.estimate()).usage ?? null;
  } catch {
    // Not told.
  }
  return {
    analysis: split(analysisBytes(analysis), inQueue),
    tracks: split(trackBytes(entries, covers), inQueue),
    exports: exports.length > 0 ? { count: exports.length, bytes: sum(exports) } : EMPTY,
    rest: {
      count: rest.length + images.length,
      bytes: rest.reduce((total, [key, value]) => total + entryBytes(key, value), 0) + sum(images),
    },
    total,
  };
}

/**
 * Deletes the analysis of the tracks not in the queue, or of all (`all`): a track is analysed
 * again when it is loaded next (those in the queue keep theirs until the app reloads). Returns
 * what went.
 */
export async function deleteAnalysis(
  inQueue: ReadonlySet<string>,
  all: boolean,
): Promise<StoredPart> {
  const dir = await subdirectory(ANALYSIS_DIRECTORY);
  const gone = { count: 0, bytes: 0 };
  if (!dir) return gone;
  for (const [fingerprint, bytes] of analysisBytes(await files(dir))) {
    if (!all && inQueue.has(fingerprint)) continue;
    const removed = await dir.removeEntry(`${fingerprint}.bin`).then(
      () => true,
      () => false,
    );
    if (!removed) continue;
    gone.count++;
    gone.bytes += bytes;
  }
  return gone;
}

/** Deletes the details and covers of the tracks not in the queue. Returns what went. */
export async function deleteTrackDetails(inQueue: ReadonlySet<string>): Promise<StoredPart> {
  const dir = await subdirectory(COVER_DIRECTORY);
  const tracks = trackBytes(appEntries(), await files(dir));
  const gone = { count: 0, bytes: 0 };
  for (const [fingerprint, bytes] of tracks) {
    if (inQueue.has(fingerprint)) continue;
    try {
      localStorage.removeItem(TRACK_PREFIX + fingerprint);
    } catch {
      continue; // storage blocked
    }
    await dir?.removeEntry(fingerprint).catch(() => undefined);
    gone.count++;
    gone.bytes += bytes;
  }
  return gone;
}

/**
 * Deletes everything the app keeps in this browser: its localStorage entries, its files and the
 * queue. From then on, the running app stores nothing: reload it next.
 */
export async function deleteEverything(): Promise<void> {
  setSaving(false);
  try {
    for (const key of Object.keys(appEntries())) localStorage.removeItem(key);
  } catch {
    // Storage blocked: nothing was kept there either.
  }
  const top = await root();
  if (top) {
    const names: string[] = [];
    for await (const [name] of top as unknown as Entries) names.push(name);
    for (const name of names)
      await top.removeEntry(name, { recursive: true }).catch(() => undefined);
  }
  await forgetQueue();
}
