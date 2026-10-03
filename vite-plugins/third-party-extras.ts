import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { Notice } from './third-party-notices.ts';

/**
 * The parts of others that are not packages of their own: code compiled into the WebAssembly of
 * two packages. Their licence texts are in licenses/<project>/, as the projects publish them.
 */
const text = (path: string) => ({
  file: path.split('/').at(-1)!,
  text: readFileSync(join('licenses', path), 'utf8').trim(),
});

/**
 * FFmpeg's AAC encoder, compiled into the WebAssembly of @mediabunny/aac-encoder. FFmpeg is under
 * the LGPL 2.1 or later: the notice says so, comes with the licence, says where the source is
 * and offers it. Its version is read from the package, so it stays right after an update.
 */
export function ffmpegNotice(contact: string): Notice {
  const dir = join('node_modules', '@mediabunny', 'aac-encoder');
  const { version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    version: string;
  };
  const bundle = readFileSync(join(dir, 'dist', 'bundles', 'mediabunny-aac-encoder.mjs'), 'utf8');
  const libavcodec = /Lavc(\d+\.\d+\.\d+)/.exec(bundle)?.[1];
  if (!libavcodec) throw new Error('No libavcodec version in @mediabunny/aac-encoder');
  const recipe = `https://github.com/Vanilagy/mediabunny/tree/v${version}/packages/aac-encoder`;
  return {
    name: 'FFmpeg',
    version: `libavcodec ${libavcodec}`,
    license: 'LGPL-2.1-or-later',
    url: 'https://github.com/FFmpeg/FFmpeg',
    note: [
      `This app uses code of FFmpeg, licensed under the GNU Lesser General Public License, version 2.1 or later: its AAC encoder (libavcodec ${libavcodec}, with libavutil), compiled to WebAssembly in @mediabunny/aac-encoder ${version}. It encodes the sound of MP4 exports in browsers without an AAC encoder of their own, and it is loaded only then.`,
      `It is built from FFmpeg's source with only the AAC encoder and without FFmpeg's GPL and non-free parts, as described in ${recipe}; the source of the bridge between the encoder and FFmpeg (src/bridge.c) comes with that package.`,
      `The source code of FFmpeg: https://github.com/FFmpeg/FFmpeg. On request, we send you the source code of FFmpeg that this app uses, for three years after the app last served it: write to ${contact}.`,
    ].join('\n\n'),
    texts: [text('ffmpeg/COPYING.LGPLv2.1'), text('ffmpeg/LICENSE.md')],
  };
}

/** The runtime and C library that both WebAssembly modules are compiled with. */
export function emscriptenNotice(): Notice {
  return {
    name: 'Emscripten',
    version: '',
    license: 'MIT OR NCSA',
    url: 'https://github.com/emscripten-core/emscripten',
    note: 'The runtime and the C library (musl) that the WebAssembly of the AAC encoder (@mediabunny/aac-encoder) and of Signalsmith Stretch are compiled with.',
    texts: [text('emscripten/LICENSE'), text('musl/COPYRIGHT')],
  };
}

/** The directory of package `name`, as `from` (a package directory) finds it. */
function packageDir(name: string, from: string): string {
  let dir = dirname(createRequire(resolve(from, 'package.json')).resolve(name));
  while (!readFileOrNull(join(dir, 'package.json'))?.includes(`"name": "${name}"`)) {
    const up = dirname(dir);
    if (up === dir) throw new Error(`No package ${name} from ${from}`);
    dir = up;
  }
  return dir;
}

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function versionOf(dir: string): string {
  return (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string })
    .version;
}

/**
 * The few lines of the build tools in the app's scripts: Vite's module preload helper and
 * Rolldown's runtime helpers. Vite's licence file also holds the licences of the code it bundles
 * for itself, which stays in the build tool; only its own licence goes here.
 */
export function buildToolNotices(): Notice[] {
  const vite = join('node_modules', 'vite');
  const rolldown = packageDir('rolldown', vite);
  const viteLicense = readFileSync(join(vite, 'LICENSE.md'), 'utf8');
  const own = viteLicense.split(/^# Licenses of bundled dependencies/m)[0]!.trim();
  return [
    {
      name: 'Vite',
      version: versionOf(vite),
      license: 'MIT',
      url: 'https://github.com/vitejs/vite',
      note: "Its module preload helper is in the app's main script.",
      texts: [{ file: 'LICENSE.md (Vite core)', text: own }],
    },
    {
      name: 'Rolldown',
      version: versionOf(rolldown),
      license: 'MIT',
      url: 'https://github.com/rolldown/rolldown',
      note: "Its runtime helpers are in the app's scripts.",
      texts: [{ file: 'LICENSE', text: readFileSync(join(rolldown, 'LICENSE'), 'utf8').trim() }],
    },
  ];
}

/** Licence texts that packages do not ship, from their projects. */
export const PACKAGE_TEXTS: Record<string, string[]> = {
  // The licence section of its README.
  'fft.js': [join('licenses', 'fft.js', 'LICENSE')],
  'signalsmith-stretch': [join('licenses', 'signalsmith-stretch', 'LICENSE.txt')],
};
