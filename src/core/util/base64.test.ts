import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64 } from './base64';

describe('base64', () => {
  it('encodes and decodes bytes, also many at once', () => {
    expect(encodeBase64(new Uint8Array([102, 111, 111, 98, 97]))).toBe('Zm9vYmE=');
    expect([...decodeBase64('Zm9vYmE=')]).toEqual([102, 111, 111, 98, 97]);
    const bytes = Uint8Array.from({ length: 100_003 }, (_, i) => (i * 7919) % 256);
    const text = encodeBase64(bytes);
    expect(text).toBe(btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')));
    expect(decodeBase64(text)).toEqual(bytes);
  });
});
