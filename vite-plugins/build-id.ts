import type { Plugin } from 'vite';

/**
 * Names each build (NF-09). The app knows its build as `__BUILD_ID__`, and the build writes it
 * to `version.json` as well: a tab opened before a deploy compares the two, to learn that a
 * newer build is out (and that its own worker files may be gone from the server).
 */
export function buildId(
  id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
): Plugin {
  return {
    name: 'build-id',
    config: () => ({ define: { __BUILD_ID__: JSON.stringify(id) } }),
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ build: id }),
      });
    },
  };
}
