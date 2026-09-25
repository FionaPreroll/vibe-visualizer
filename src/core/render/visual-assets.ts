import type { ImageKind } from './logo-spectrum';

/**
 * The user's background and logo images (LS-01, LS-12). They are kept in the Origin Private
 * File System, so they survive reloads; if that is not available, only for the session.
 * Main thread only (decoding SVG needs an image element).
 */

export interface StoredImage {
  name: string;
  blob: Blob;
  /** Object URL for previews in the UI. */
  url: string;
}

export type StoredImages = Record<ImageKind, StoredImage | null>;

const DIRECTORY = 'visual-assets';
const NAMES_KEY = 'vibe-visualizer:assets:v1';
/** Larger images are scaled down: GPUs limit texture sizes, and it saves memory. */
const MAX_SIZE = 4096;

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/** Straight alpha and upright: the render shaders expect exactly this. */
const BITMAP_OPTIONS: ImageBitmapOptions = {
  imageOrientation: 'from-image',
  premultiplyAlpha: 'none',
};

export class VisualAssets {
  private images: StoredImages = { background: null, logo: null };
  private readonly listeners = new Set<(images: StoredImages) => void>();
  /** Resolves once stored images are loaded. */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.load();
  }

  get current(): StoredImages {
    return this.images;
  }

  /** Svelte store contract. */
  subscribe(listener: (images: StoredImages) => void): () => void {
    this.listeners.add(listener);
    listener(this.images);
    return () => this.listeners.delete(listener);
  }

  /** Replaces an image (null: back to the neutral default). */
  async set(kind: ImageKind, file: File | null): Promise<void> {
    if (file && !IMAGE_TYPES.includes(file.type)) {
      throw new Error(`${file.name}: please use a PNG, JPEG, WebP or SVG image.`);
    }
    if (file) await decodeImage(file).then((bitmap) => bitmap.close());
    this.update(kind, file ? { name: file.name, blob: file } : null);
    const names = readNames();
    names[kind] = file?.name ?? null;
    localStorage.setItem(NAMES_KEY, JSON.stringify(names));
    try {
      const directory = await assetDirectory();
      if (file) {
        const handle = await directory.getFileHandle(kind, { create: true });
        const writable = await handle.createWritable();
        await writable.write(file);
        await writable.close();
      } else {
        await directory.removeEntry(kind).catch(() => undefined);
      }
    } catch {
      // No persistent storage: the image stays for this session.
    }
  }

  private update(kind: ImageKind, image: { name: string; blob: Blob } | null): void {
    const previous = this.images[kind];
    if (previous) URL.revokeObjectURL(previous.url);
    this.images = {
      ...this.images,
      [kind]: image ? { ...image, url: URL.createObjectURL(image.blob) } : null,
    };
    for (const listener of this.listeners) listener(this.images);
  }

  private async load(): Promise<void> {
    const names = readNames();
    try {
      const directory = await assetDirectory();
      for (const kind of ['background', 'logo'] as const) {
        const name = names[kind];
        if (!name) continue;
        const handle = await directory.getFileHandle(kind).catch(() => null);
        if (!handle) continue;
        const file = await handle.getFile();
        this.update(kind, { name, blob: file.slice(0, file.size, typeForName(name)) });
      }
    } catch {
      // Nothing stored or no storage.
    }
  }
}

function readNames(): Record<ImageKind, string | null> {
  try {
    const stored = JSON.parse(localStorage.getItem(NAMES_KEY) ?? '{}') as Record<string, unknown>;
    const name = (value: unknown) => (typeof value === 'string' ? value : null);
    return { background: name(stored['background']), logo: name(stored['logo']) };
  } catch {
    return { background: null, logo: null };
  }
}

async function assetDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIRECTORY, { create: true });
}

function typeForName(name: string): string {
  const extension = name.toLowerCase().split('.').pop();
  switch (extension) {
    case 'svg':
      return 'image/svg+xml';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
}

/** Decodes an image file into a bitmap for the GPU, scaled to at most 4096 px. */
export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  if (blob.type === 'image/svg+xml') return decodeSvg(blob);
  const bitmap = await createImageBitmap(blob, BITMAP_OPTIONS);
  const scale = Math.min(1, MAX_SIZE / Math.max(bitmap.width, bitmap.height));
  if (scale >= 1) return bitmap;
  const resized = await createImageBitmap(bitmap, {
    ...BITMAP_OPTIONS,
    resizeWidth: Math.round(bitmap.width * scale),
    resizeHeight: Math.round(bitmap.height * scale),
    resizeQuality: 'high',
  });
  bitmap.close();
  return resized;
}

/** SVGs are drawn at 1024 px on their longer side (createImageBitmap cannot decode them). */
async function decodeSvg(blob: Blob): Promise<ImageBitmap> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = image.naturalWidth || 1024;
    const height = image.naturalHeight || 1024;
    const scale = 1024 / Math.max(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await createImageBitmap(canvas, BITMAP_OPTIONS);
  } finally {
    URL.revokeObjectURL(url);
  }
}
