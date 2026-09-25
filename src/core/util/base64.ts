const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(128);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

/**
 * Decodes standard base64. Self-contained because `atob` is missing in AudioWorkletGlobalScope.
 */
export function decodeBase64(input: string): Uint8Array<ArrayBuffer> {
  let end = input.length;
  while (end > 0 && input.charCodeAt(end - 1) === 61 /* = */) end--;
  const out = new Uint8Array((end * 3) >> 2);
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < end; i++) {
    buffer = (buffer << 6) | LOOKUP[input.charCodeAt(i)]!;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}
