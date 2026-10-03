import { readFileSync } from 'node:fs';

/**
 * The headers that public/_headers gives every path (`/*`): the preview server sends them too,
 * so the e2e tests run with the headers of production (cross-origin isolation, the content
 * security policy).
 */
export function productionHeaders(text = readFileSync('public/_headers', 'utf8')) {
  const headers: Record<string, string> = {};
  let everyPath = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    // A path starts a block; its headers are indented.
    if (!/^\s/.test(line)) {
      everyPath = trimmed === '/*';
      continue;
    }
    const colon = trimmed.indexOf(':');
    if (everyPath && colon > 0) {
      headers[trimmed.slice(0, colon).trim()] = trimmed.slice(colon + 1).trim();
    }
  }
  return headers;
}
