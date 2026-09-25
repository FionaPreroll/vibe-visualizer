/** FNV-1a (32 bit) over the raw bytes of the given arrays. Used to compare outputs bit by bit. */
export function hashFloat32(...arrays: Float32Array[]): string {
  let h = 0x811c9dc5;
  for (const array of arrays) {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i]!;
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Largest absolute sample difference between two equally long signals. */
export function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return Infinity;
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!);
    if (d > max) max = d;
  }
  return max;
}
