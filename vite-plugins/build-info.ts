import type { Plugin } from 'vite';

/**
 * The version of a build: the major and minor version of package.json, then the day and the time
 * it was built, in UTC: "0.9" built on 3 October 2026 at 14:32 is "0.9.20261003.1432".
 */
export function appVersion(base: string, builtAt: Date): string {
  const [major = '0', minor = '0'] = base.split('.');
  const two = (value: number) => String(value).padStart(2, '0');
  const day = `${builtAt.getUTCFullYear()}${two(builtAt.getUTCMonth() + 1)}${two(builtAt.getUTCDate())}`;
  const time = `${two(builtAt.getUTCHours())}${two(builtAt.getUTCMinutes())}`;
  return `${major}.${minor}.${day}.${time}`;
}

/**
 * Names and versions each build (NF-09). The app knows its build as `__BUILD_ID__`, its version
 * as `__APP_VERSION__` (see {@link appVersion}) and when it was built as `__BUILT_AT__`; the build
 * writes all three to `version.json` as well. A tab opened before a deploy compares them, to
 * learn that a newer build is out (and that its own worker files may be gone from the server).
 * The name tells builds apart even within the same minute.
 */
export function buildInfo(
  base: string,
  builtAt = new Date(),
  id = `${builtAt.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
): Plugin {
  const version = appVersion(base, builtAt);
  return {
    name: 'build-info',
    config: () => ({
      define: {
        __BUILD_ID__: JSON.stringify(id),
        __APP_VERSION__: JSON.stringify(version),
        __BUILT_AT__: JSON.stringify(builtAt.toISOString()),
      },
    }),
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ build: id, version, builtAt: builtAt.toISOString() }),
      });
    },
  };
}
