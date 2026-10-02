import { ANALYSIS_DIRECTORY } from '../library/analysis-cache';
import type { ImageKind } from '../render/logo-spectrum';
import { ASSET_DIRECTORY } from '../render/visual-assets';
import { decodeBase64, encodeBase64 } from '../util/base64';
import {
  KALEIDO_PRESETS_KEY,
  PRESETS_KEY,
  setSaving,
  STORAGE_PREFIX,
  TRACK_PREFIX,
} from './persistence';

/**
 * A backup of everything the app keeps in this browser (UI-06), as one file: the settings,
 * presets, the cues, markers, tempos and names of the tracks (localStorage), the background and
 * logo images, and the track analysis if asked for (waveforms and beat grids: without it, each
 * track is analysed anew). Not in it: the music files and the queue (the browser cannot hand
 * those on), and videos. Restoring replaces all of it; the app reloads then.
 */

const APP = 'vibe-visualizer';
const KIND = 'backup';
const VERSION = 1;
const IMAGE_KINDS: readonly ImageKind[] = ['background', 'logo'];
/** A file of the track analysis: a fingerprint, ".bin". */
const ANALYSIS_FILE = /^[\w-]+\.bin$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export interface Backup {
  app: typeof APP;
  kind: typeof KIND;
  version: number;
  /** When it was made (ISO 8601). */
  created: string;
  /** The app's entries in localStorage, as they were stored. */
  storage: Record<string, string>;
  /** The user's images, base64. */
  images: Partial<Record<ImageKind, string>>;
  /** The track analysis by file name, base64; absent: not in this backup. */
  analysis?: Record<string, string>;
}

export interface BackupSummary {
  created: Date | null;
  /** The user's own presets, of both modes. */
  presets: number;
  /** Tracks with cues, markers, a tempo or names. */
  tracks: number;
  images: number;
  /** Tracks with their analysis; null: the analysis is not in the backup. */
  analysis: number | null;
}

/** The app's entries in `storage`. */
export function readEntries(storage: Storage): Record<string, string> {
  const entries: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    const value = key?.startsWith(STORAGE_PREFIX) ? storage.getItem(key) : null;
    if (key && value !== null) entries[key] = value;
  }
  return entries;
}

/** Replaces the app's entries in `storage`: all or none (storage full: as it was). */
export function replaceEntries(storage: Storage, entries: Record<string, string>): void {
  const before = readEntries(storage);
  const put = (values: Record<string, string>) => {
    for (const key of Object.keys(readEntries(storage))) storage.removeItem(key);
    for (const [key, value] of Object.entries(values)) storage.setItem(key, value);
  };
  try {
    put(entries);
  } catch (error) {
    put(before);
    throw error;
  }
}

/** The values of `value` that are strings under keys `valid` accepts. */
function strings(value: unknown, valid: (key: string) => boolean): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => valid(entry[0]) && typeof entry[1] === 'string',
    ),
  );
}

/** The backup in a file's text, checked; throws a message for the user for anything else. */
export function parseBackup(text: string): Backup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This file is not a backup: it is not valid JSON.');
  }
  const input = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
    string,
    unknown
  >;
  if (input['app'] !== APP || input['kind'] !== KIND) {
    throw new Error('This file is not a backup of the app.');
  }
  const version = input['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error('This backup is damaged.');
  }
  if (version > VERSION) {
    throw new Error('This backup comes from a newer version of the app: reload the app first.');
  }
  const images = strings(input['images'], (key) => (IMAGE_KINDS as string[]).includes(key));
  const analysis =
    input['analysis'] === undefined
      ? undefined
      : strings(input['analysis'], (key) => ANALYSIS_FILE.test(key));
  const binary = [...Object.values(images), ...Object.values(analysis ?? {})];
  if (!binary.every((data) => BASE64.test(data))) throw new Error('This backup is damaged.');
  return {
    app: APP,
    kind: KIND,
    version,
    created: typeof input['created'] === 'string' ? input['created'] : '',
    storage: strings(input['storage'], (key) => key.startsWith(STORAGE_PREFIX)),
    images,
    ...(analysis ? { analysis } : {}),
  };
}

/** What is in a backup, to say so before it is restored. */
export function summarizeBackup(backup: Backup): BackupSummary {
  const count = (key: string) => {
    try {
      const list: unknown = JSON.parse(backup.storage[key] ?? '[]');
      return Array.isArray(list) ? list.length : 0;
    } catch {
      return 0;
    }
  };
  const created = new Date(backup.created);
  return {
    created: backup.created && !Number.isNaN(created.getTime()) ? created : null,
    presets: count(PRESETS_KEY) + count(KALEIDO_PRESETS_KEY),
    tracks: Object.keys(backup.storage).filter((key) => key.startsWith(TRACK_PREFIX)).length,
    images: Object.keys(backup.images).length,
    analysis: backup.analysis ? Object.keys(backup.analysis).length : null,
  };
}

/** "the settings, 2 presets and the cues, markers, tempos and names of 3 tracks" */
export function describeBackup(summary: BackupSummary): string {
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts = ['the settings'];
  if (summary.presets > 0) parts.push(count(summary.presets, 'preset'));
  if (summary.tracks > 0) {
    parts.push(`the cues, markers, tempos and names of ${count(summary.tracks, 'track')}`);
  }
  if (summary.images > 0) parts.push(count(summary.images, 'image'));
  if (summary.analysis) parts.push(`the analysis of ${count(summary.analysis, 'track')}`);
  const last = parts.pop()!;
  return parts.length > 0 ? `${parts.join(', ')} and ${last}` : last;
}

/** "FibeStation backup 2026-10-02.json" */
export function backupFileName(appName: string, date: Date): string {
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-');
  const name = Array.from(appName.trim() || 'FibeStation', (char) =>
    char < ' ' || '\\/:*?"<>|'.includes(char) ? '_' : char,
  ).join('');
  return `${name} backup ${day}.json`;
}

async function directory(name: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(name, { create: true });
  } catch {
    return null; // no Origin Private File System (e.g. a private window)
  }
}

async function readFiles(
  dir: FileSystemDirectoryHandle,
  wanted: (name: string) => boolean,
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    if (handle.kind !== 'file' || !wanted(name)) continue;
    const file = await (handle as FileSystemFileHandle).getFile();
    files[name] = encodeBase64(new Uint8Array(await file.arrayBuffer()));
  }
  return files;
}

async function writeFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(bytes);
  await writable.close();
}

/** A backup of what the app keeps in this browser now, with the track analysis or without. */
export async function createBackup(
  options: { analysis: boolean },
  now = new Date(),
): Promise<Backup> {
  const assets = await directory(ASSET_DIRECTORY);
  const images = assets
    ? await readFiles(assets, (name) => (IMAGE_KINDS as string[]).includes(name))
    : {};
  const cache = options.analysis ? await directory(ANALYSIS_DIRECTORY) : null;
  const analysis = cache ? await readFiles(cache, (name) => ANALYSIS_FILE.test(name)) : null;
  return {
    app: APP,
    kind: KIND,
    version: VERSION,
    created: now.toISOString(),
    storage: readEntries(localStorage),
    images,
    ...(options.analysis ? { analysis: analysis ?? {} } : {}),
  };
}

/**
 * Replaces what the app keeps in this browser with `backup`; reload the app next. The analysis
 * of tracks already here stays (it is the same for the same file). From then on, the running
 * app stores nothing, so that it does not write its own state over the backup.
 */
export async function restoreBackup(backup: Backup): Promise<void> {
  // All decoded first: a damaged file changes nothing.
  const images = IMAGE_KINDS.map((kind) => {
    const data = backup.images[kind];
    return { kind, bytes: data === undefined ? null : decodeBase64(data) };
  });
  const analysis = Object.entries(backup.analysis ?? {}).map(([name, data]) => ({
    name,
    bytes: decodeBase64(data),
  }));
  const assets = await directory(ASSET_DIRECTORY);
  if (assets) {
    for (const { kind, bytes } of images) {
      if (bytes) await writeFile(assets, kind, bytes);
      else await assets.removeEntry(kind).catch(() => undefined);
    }
  }
  const cache = analysis.length > 0 ? await directory(ANALYSIS_DIRECTORY) : null;
  if (cache) for (const { name, bytes } of analysis) await writeFile(cache, name, bytes);
  setSaving(false);
  try {
    replaceEntries(localStorage, backup.storage);
  } catch (error) {
    setSaving(true);
    throw error;
  }
}
