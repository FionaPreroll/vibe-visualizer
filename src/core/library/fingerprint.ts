/**
 * Recognises a file by its content (TR-05, SRC-05): a hash over its size and three samples of
 * 256 KB (start, middle, end). Renaming or moving the file keeps its cues; reading it takes a
 * few milliseconds even for a three-hour mix.
 */

const SAMPLE_BYTES = 256 * 1024;

export async function fingerprint(file: Blob): Promise<string> {
  const size = file.size;
  const header = new ArrayBuffer(8);
  new DataView(header).setFloat64(0, size);
  const parts: BlobPart[] = [header];
  if (size <= 3 * SAMPLE_BYTES) {
    parts.push(file);
  } else {
    const middle = Math.floor(size / 2 - SAMPLE_BYTES / 2);
    parts.push(
      file.slice(0, SAMPLE_BYTES),
      file.slice(middle, middle + SAMPLE_BYTES),
      file.slice(size - SAMPLE_BYTES, size),
    );
  }
  const digest = await crypto.subtle.digest('SHA-256', await new Blob(parts).arrayBuffer());
  return Array.from(new Uint8Array(digest).subarray(0, 16), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
