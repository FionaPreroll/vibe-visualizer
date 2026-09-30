import type { BeatGrid } from '../analysis/beat-grid';
import { WAVEFORM_STRIDE, type Waveform } from '../analysis/waveform';

/**
 * The result of a track analysis, and its cache in the Origin Private File System: one file
 * per track (by fingerprint), so a track that was analysed once shows its waveform and beat
 * grid at once after a reload. The oldest files go when there are too many.
 */

export interface TrackAnalysisResult {
  fingerprint: string;
  /** Seconds of audio analysed. */
  duration: number;
  waveform: Waveform;
  grid: BeatGrid;
  /** The tempo the user gave for the grid (TMP-06), or null: the grid found the tempo itself. */
  tempo: number | null;
}

/**
 * Tempos (BPM) that give the same grid: both null, or equal within a hundredth of a BPM (the
 * cache stores them as float32).
 */
export function sameTempo(a: number | null, b: number | null): boolean {
  return a === null || b === null ? a === b : Math.abs(a - b) < 0.01;
}

const DIRECTORY = 'track-analysis';
const MAGIC = 0x56564741; // "VVGA"
const VERSION = 2;
/** Cached tracks kept; the least recently written go first. */
const MAX_ENTRIES = 60;
const HEADER_BYTES = 32;

/**
 * Serialises a result: a header, the waveform, then the beats, their confidence and their
 * positions in the bar.
 */
export function encodeAnalysis(result: TrackAnalysisResult): ArrayBuffer {
  const waveformBytes = result.waveform.length * WAVEFORM_STRIDE;
  const beats = result.grid.beats.length;
  const beatsOffset = align(HEADER_BYTES + waveformBytes, 8);
  const confidenceOffset = beatsOffset + beats * 8;
  const barOffset = confidenceOffset + beats * 4;
  const buffer = new ArrayBuffer(barOffset + beats);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, VERSION, true);
  view.setUint32(8, result.waveform.rate, true);
  view.setUint32(12, result.waveform.length, true);
  view.setUint32(16, beats, true);
  view.setFloat32(20, result.tempo ?? 0, true);
  view.setFloat64(24, result.duration, true);
  new Uint8Array(buffer, HEADER_BYTES, waveformBytes).set(
    result.waveform.data.subarray(0, waveformBytes),
  );
  new Float64Array(buffer, beatsOffset, beats).set(result.grid.beats);
  new Float32Array(buffer, confidenceOffset, beats).set(result.grid.confidence);
  new Uint8Array(buffer, barOffset, beats).set(result.grid.beatInBar ?? countBars(beats));
  return buffer;
}

/** Positions in bars of four from the first beat on, for a grid without bars. */
function countBars(beats: number): Uint8Array {
  return Uint8Array.from({ length: beats }, (_, k) => k % 4);
}

/** The result stored in `buffer`, or null if it is not a (current) analysis. */
export function decodeAnalysis(
  buffer: ArrayBuffer,
  fingerprint: string,
): TrackAnalysisResult | null {
  if (buffer.byteLength < HEADER_BYTES) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== VERSION) return null;
  const rate = view.getUint32(8, true);
  const length = view.getUint32(12, true);
  const beats = view.getUint32(16, true);
  const tempo = view.getFloat32(20, true);
  const duration = view.getFloat64(24, true);
  const waveformBytes = length * WAVEFORM_STRIDE;
  const beatsOffset = align(HEADER_BYTES + waveformBytes, 8);
  const confidenceOffset = beatsOffset + beats * 8;
  const barOffset = confidenceOffset + beats * 4;
  if (buffer.byteLength < barOffset + beats) return null;
  return {
    fingerprint,
    duration,
    waveform: {
      rate,
      length,
      data: new Uint8Array(buffer.slice(HEADER_BYTES, HEADER_BYTES + waveformBytes)),
    },
    grid: {
      beats: new Float64Array(buffer.slice(beatsOffset, beatsOffset + beats * 8)),
      confidence: new Float32Array(buffer.slice(confidenceOffset, barOffset)),
      beatInBar: new Uint8Array(buffer.slice(barOffset, barOffset + beats)),
    },
    tempo: tempo > 0 ? tempo : null,
  };
}

function align(value: number, to: number): number {
  return Math.ceil(value / to) * to;
}

/** A beat grid alone (stored with an export job): the count, the beats, their confidence. */
export function encodeGrid(grid: BeatGrid): ArrayBuffer {
  const count = grid.beats.length;
  const buffer = new ArrayBuffer(8 + count * 12);
  new DataView(buffer).setUint32(0, count, true);
  new Float64Array(buffer, 8, count).set(grid.beats);
  new Float32Array(buffer, 8 + count * 8, count).set(grid.confidence);
  return buffer;
}

export function decodeGrid(buffer: ArrayBuffer): BeatGrid | null {
  if (buffer.byteLength < 8) return null;
  const count = new DataView(buffer).getUint32(0, true);
  if (buffer.byteLength < 8 + count * 12) return null;
  return {
    beats: new Float64Array(buffer.slice(8, 8 + count * 8)),
    confidence: new Float32Array(buffer.slice(8 + count * 8, 8 + count * 12)),
  };
}

async function directory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(DIRECTORY, { create: true });
  } catch {
    return null; // no Origin Private File System (e.g. a private window)
  }
}

export async function readCachedAnalysis(fingerprint: string): Promise<TrackAnalysisResult | null> {
  const dir = await directory();
  if (!dir) return null;
  try {
    const file = await (await dir.getFileHandle(`${fingerprint}.bin`)).getFile();
    return decodeAnalysis(await file.arrayBuffer(), fingerprint);
  } catch {
    return null;
  }
}

/** Stores a result (best effort: a full disk or a missing file system only loses the cache). */
export async function writeCachedAnalysis(result: TrackAnalysisResult): Promise<void> {
  const dir = await directory();
  if (!dir) return;
  try {
    const handle = await dir.getFileHandle(`${result.fingerprint}.bin`, { create: true });
    const writable = await handle.createWritable();
    await writable.write(encodeAnalysis(result));
    await writable.close();
    await prune(dir);
  } catch {
    // The analysis is still used for this session.
  }
}

/** Removes the oldest entries beyond {@link MAX_ENTRIES}. */
async function prune(dir: FileSystemDirectoryHandle): Promise<void> {
  const entries: { name: string; modified: number }[] = [];
  for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    if (handle.kind !== 'file') continue;
    const file = await (handle as FileSystemFileHandle).getFile();
    entries.push({ name, modified: file.lastModified });
  }
  if (entries.length <= MAX_ENTRIES) return;
  entries.sort((a, b) => a.modified - b.modified);
  for (const entry of entries.slice(0, entries.length - MAX_ENTRIES)) {
    await dir.removeEntry(entry.name).catch(() => undefined);
  }
}
