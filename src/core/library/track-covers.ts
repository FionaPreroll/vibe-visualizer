import { decodeImage, IMAGE_TYPES } from '../render/visual-assets';

/**
 * Cover images the user gives tracks (LS-21): one per file, by its fingerprint, in the Origin
 * Private File System, so they survive reloads and go into backups. They take the place of the
 * cover art in the file (LS-15) wherever a cover shows. Main thread only (decoding SVG needs an
 * image element).
 */

/** The directory of the covers in the Origin Private File System: a file per fingerprint. */
export const COVER_DIRECTORY = 'track-covers';
/** A cover's file name: the fingerprint of its track's file. */
export const COVER_FILE = /^[\w-]+$/;
/** Covers are scaled down to this many pixels on their longer side: plenty for a logo in 4K. */
export const COVER_SIZE = 1024;

/**
 * The image in `file`, checked and made a cover: at most {@link COVER_SIZE} on its longer side,
 * as WebP (PNG in a browser that cannot write WebP). Throws a message for the user.
 */
export async function prepareCover(file: File): Promise<Blob> {
  if (!IMAGE_TYPES.includes(file.type)) {
    throw new Error(`${file.name}: please use a PNG, JPEG, WebP or SVG image.`);
  }
  const bitmap = await decodeImage(file).catch(() => {
    throw new Error(`${file.name} cannot be read as an image.`);
  });
  try {
    const scale = Math.min(1, COVER_SIZE / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    );
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
  } finally {
    bitmap.close();
  }
}

async function coverDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(COVER_DIRECTORY, { create: true });
  } catch {
    return null; // no Origin Private File System (e.g. in a private window)
  }
}

/** The cover the user gave the file of `fingerprint`, or null. */
export async function readCover(fingerprint: string): Promise<Blob | null> {
  if (!COVER_FILE.test(fingerprint)) return null;
  const directory = await coverDirectory();
  const handle = await directory?.getFileHandle(fingerprint).catch(() => null);
  return handle ? await handle.getFile() : null;
}

/**
 * Keeps `cover` for the file of `fingerprint`, or removes the one it had (null). Without the
 * Origin Private File System, or with the storage full, the cover stays for this session only.
 */
export async function writeCover(fingerprint: string, cover: Blob | null): Promise<void> {
  if (!COVER_FILE.test(fingerprint)) return;
  const directory = await coverDirectory();
  if (!directory) return;
  if (!cover) {
    await directory.removeEntry(fingerprint).catch(() => undefined);
    return;
  }
  try {
    const handle = await directory.getFileHandle(fingerprint, { create: true });
    const writable = await handle.createWritable();
    await writable.write(cover);
    await writable.close();
  } catch {
    // Storage full or blocked: the cover stays for this session.
  }
}
