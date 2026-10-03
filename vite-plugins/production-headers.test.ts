import { describe, expect, it } from 'vitest';
import { productionHeaders } from './production-headers';

describe('production headers', () => {
  it('are those of every path in public/_headers', () => {
    const headers = productionHeaders(
      [
        '# A comment',
        '/*',
        '  # Another',
        '  Cross-Origin-Opener-Policy: same-origin',
        "  Content-Security-Policy: default-src 'self'; img-src 'self' blob:",
        '',
        '/assets/*',
        '  Cache-Control: public, max-age=31536000, immutable',
      ].join('\n'),
    );
    expect(headers).toEqual({
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' blob:",
    });
  });

  it('isolate the app and keep what it loads to itself', () => {
    const headers = productionHeaders();
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(headers['Cross-Origin-Embedder-Policy']).toBe('require-corp');
    expect(headers['Content-Security-Policy']).toContain("default-src 'self'");
  });
});
