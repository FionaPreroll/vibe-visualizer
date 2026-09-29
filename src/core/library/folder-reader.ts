/**
 * Turns what the user drops or picks into queue entries (SRC-01, SRC-03): loose files as they
 * come, folders read recursively in natural order (so "2 …" comes before "10 …"; a folder's
 * own files before its subfolders). Where the browser gives file handles (Chromium), they come
 * along, so the queue keeps its files over a reload (SRC-05).
 */

export interface QueueEntry {
  file: File;
  /** Access to the file after a reload (Chromium), or null. */
  handle: FileSystemFileHandle | null;
  /** The folder the file was found in (a path from the added folder on); null for loose files. */
  folder: string | null;
}

/** File name endings of audio files: in folders, other files (covers, playlists) are skipped. */
const AUDIO_EXTENSIONS = [
  'mp3',
  'm4a',
  'm4b',
  'aac',
  'flac',
  'ogg',
  'oga',
  'opus',
  'wav',
  'aif',
  'aiff',
  'aifc',
  'webm',
  'weba',
  'mka',
  'mp4',
  'caf',
  'wma',
  'ape',
  'wv',
];
const AUDIO_EXTENSION_SET = new Set(AUDIO_EXTENSIONS);

/** For file pickers: the audio files the browser can usually play. */
export const AUDIO_ACCEPT = [
  '.mp3',
  '.m4a',
  '.aac',
  '.flac',
  '.ogg',
  '.opus',
  '.wav',
  '.aif',
  '.aiff',
  '.webm',
];

export function isAudioFile(name: string, type = ''): boolean {
  if (type.startsWith('audio/')) return true;
  const dot = name.lastIndexOf('.');
  return dot > 0 && AUDIO_EXTENSION_SET.has(name.slice(dot + 1).toLowerCase());
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Orders paths (folder names, then the file name) naturally, with a folder's own files before
 * its subfolders.
 */
export function comparePaths(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const aFile = i === a.length - 1;
    const bFile = i === b.length - 1;
    if (aFile !== bFile) return aFile ? -1 : 1;
    const order = collator.compare(a[i]!, b[i]!);
    if (order !== 0) return order;
  }
  return a.length - b.length;
}

interface Found {
  path: string[];
  file: File;
  handle: FileSystemFileHandle | null;
}

/** The audio files found, in order, as entries (their folder: the path without the file). */
function toEntries(found: Found[]): QueueEntry[] {
  return found
    .sort((a, b) => comparePaths(a.path, b.path))
    .map(({ path, file, handle }) => ({ file, handle, folder: path.slice(0, -1).join('/') }));
}

/** Chromium: a dropped item as a handle, which keeps access over a reload. */
interface HandleItem {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
}

/**
 * The entries of a drop, in the order of the dropped items (a folder's files where the folder
 * was). Call it during the drop event: the dropped items are only available then (reading
 * them goes on afterwards).
 */
export function entriesFromDrop(data: DataTransfer): Promise<QueueEntry[]> {
  const items = [...data.items].filter((item) => item.kind === 'file');
  const handles = items.map(
    (item) => (item as HandleItem).getAsFileSystemHandle?.().catch(() => null) ?? null,
  );
  const entries = items.map((item) => item.webkitGetAsEntry());
  const files = items.map((item) => item.getAsFile());
  return (async () => {
    const result: QueueEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const handle = await handles[i];
      const entry = entries[i];
      if (handle?.kind === 'directory') {
        result.push(...(await readDirectory(handle as FileSystemDirectoryHandle)));
      } else if (handle?.kind === 'file') {
        const fileHandle = handle as FileSystemFileHandle;
        result.push({ file: await fileHandle.getFile(), handle: fileHandle, folder: null });
      } else if (entry?.isDirectory) {
        result.push(...(await readDirectoryEntry(entry as FileSystemDirectoryEntry)));
      } else if (files[i]) {
        result.push({ file: files[i]!, handle: null, folder: null });
      }
    }
    return result;
  })();
}

/** The audio files in `directory` and its subfolders, with handles. */
export async function readDirectory(directory: FileSystemDirectoryHandle): Promise<QueueEntry[]> {
  const found: Found[] = [];
  const walk = async (folder: FileSystemDirectoryHandle, path: string[]) => {
    for await (const child of folder.values()) {
      if (child.kind === 'directory') await walk(child, [...path, child.name]);
      else if (isAudioFile(child.name)) {
        found.push({ path: [...path, child.name], file: await child.getFile(), handle: child });
      }
    }
  };
  await walk(directory, [directory.name]);
  return toEntries(found);
}

/** The audio files in a dropped folder where the browser gives no handles. */
async function readDirectoryEntry(directory: FileSystemDirectoryEntry): Promise<QueueEntry[]> {
  const found: Found[] = [];
  const walk = async (folder: FileSystemDirectoryEntry, path: string[]) => {
    const reader = folder.createReader();
    // The entries come in batches (of 100 in Chromium) until an empty one.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (batch.length === 0) break;
      for (const child of batch) {
        if (child.isDirectory) {
          await walk(child as FileSystemDirectoryEntry, [...path, child.name]);
        } else if (isAudioFile(child.name)) {
          const file = await new Promise<File>((resolve, reject) =>
            (child as FileSystemFileEntry).file(resolve, reject),
          );
          found.push({ path: [...path, child.name], file, handle: null });
        }
      }
    }
  };
  await walk(directory, [directory.name]);
  return toEntries(found);
}

/**
 * The entries of a file input: loose files as given, or (with `webkitdirectory`) the audio
 * files of the picked folder.
 */
export function entriesFromFiles(files: Iterable<File>): QueueEntry[] {
  const list = [...files];
  if (!list.some((file) => file.webkitRelativePath)) {
    return list.map((file) => ({ file, handle: null, folder: null }));
  }
  return toEntries(
    list
      .filter((file) => isAudioFile(file.name, file.type))
      .map((file) => ({ path: file.webkitRelativePath.split('/'), file, handle: null })),
  );
}

/** Chromium's pickers, which give handles. */
interface PickerWindow {
  showOpenFilePicker?: (options: {
    multiple?: boolean;
    id?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle[]>;
  showDirectoryPicker?: (options: {
    id?: string;
    mode?: 'read';
  }) => Promise<FileSystemDirectoryHandle>;
}

/** True when the pickers with handles are there (Chromium). */
export function hasHandlePickers(): boolean {
  const picker = window as unknown as PickerWindow;
  return (
    typeof picker.showOpenFilePicker === 'function' &&
    typeof picker.showDirectoryPicker === 'function'
  );
}

/**
 * Picks audio files, with handles; an empty list when cancelled, null when the picker cannot
 * be used here (then use a file input).
 */
export async function pickFiles(): Promise<QueueEntry[] | null> {
  const picker = (window as unknown as PickerWindow).showOpenFilePicker;
  if (!picker) return null;
  try {
    const handles = await picker({
      multiple: true,
      id: 'vibe-audio',
      types: [{ description: 'Audio files', accept: { 'audio/*': AUDIO_ACCEPT } }],
    });
    return await Promise.all(
      handles.map(async (handle) => ({ file: await handle.getFile(), handle, folder: null })),
    );
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError' ? [] : null;
  }
}

/** Picks a folder and reads its audio files, like {@link pickFiles}. */
export async function pickFolder(): Promise<QueueEntry[] | null> {
  const picker = (window as unknown as PickerWindow).showDirectoryPicker;
  if (!picker) return null;
  let directory: FileSystemDirectoryHandle;
  try {
    directory = await picker({ id: 'vibe-folder', mode: 'read' });
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError' ? [] : null;
  }
  return readDirectory(directory);
}
