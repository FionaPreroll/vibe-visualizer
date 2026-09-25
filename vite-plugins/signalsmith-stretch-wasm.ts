import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

/**
 * Exposes the WebAssembly core of the `signalsmith-stretch` package as a virtual module.
 *
 * The package only ships a ready-made AudioWorkletNode with the WASM binary embedded as base64.
 * We need the bare DSP core so the same code can run in our own AudioWorklet (live) and in a
 * worker (export). This plugin extracts the binary and the minified import/export names at build
 * time and fails loudly if a package update changes the layout.
 */
const VIRTUAL_ID = 'virtual:signalsmith-stretch-wasm';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

const EXPECTED_EXPORTS = [
  '_setBuffers',
  '_blockSamples',
  '_intervalSamples',
  '_inputLatency',
  '_outputLatency',
  '_reset',
  '_presetDefault',
  '_presetCheaper',
  '_configure',
  '_setTransposeFactor',
  '_setTransposeSemitones',
  '_setFormantFactor',
  '_setFormantSemitones',
  '_setFormantBase',
  '_seek',
  '_process',
  '_flush',
];
const EXPECTED_IMPORTS = [
  '__abort_js',
  '__emscripten_memcpy_js',
  '_emscripten_resize_heap',
  '_random_get',
];

export function extractSignalsmithStretch(source: string) {
  const wasm = /data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)/.exec(source)?.[1];
  if (!wasm) throw new Error('signalsmith-stretch: embedded WASM binary not found');

  const exportNames: Record<string, string> = {};
  for (const m of source.matchAll(/var (_\w+)=Module\["_\w+"\]=[^;]*?wasmExports\["(\w+)"\]/g)) {
    exportNames[m[1]!] = m[2]!;
  }
  const memory = /wasmMemory=wasmExports\["(\w+)"\]/.exec(source)?.[1];
  const ctors = /addOnInit\(wasmExports\["(\w+)"\]\)/.exec(source)?.[1];
  if (!memory || !ctors) throw new Error('signalsmith-stretch: memory/ctor exports not found');
  exportNames['memory'] = memory;
  exportNames['__wasm_call_ctors'] = ctors;

  const importBlock = /var wasmImports=\{([^}]*)\}/.exec(source)?.[1];
  if (!importBlock) throw new Error('signalsmith-stretch: import table not found');
  const importNames: Record<string, string> = {};
  for (const entry of importBlock.split(',')) {
    const [minified, name] = entry.split(':');
    if (minified && name) importNames[name] = minified;
  }

  const missing = [
    ...EXPECTED_EXPORTS.filter((n) => !exportNames[n]),
    ...EXPECTED_IMPORTS.filter((n) => !importNames[n]),
  ];
  if (missing.length > 0) {
    throw new Error(
      `signalsmith-stretch: unexpected package layout, missing ${missing.join(', ')}`,
    );
  }
  return { wasm, exportNames, importNames };
}

export function signalsmithStretchWasm(): Plugin {
  return {
    name: 'signalsmith-stretch-wasm',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      const require = createRequire(import.meta.url);
      const file = require.resolve('signalsmith-stretch');
      const { wasm, exportNames, importNames } = extractSignalsmithStretch(
        readFileSync(file, 'utf8'),
      );
      return [
        `export const wasmBase64 = ${JSON.stringify(wasm)};`,
        `export const exportNames = ${JSON.stringify(exportNames)};`,
        `export const importNames = ${JSON.stringify(importNames)};`,
      ].join('\n');
    },
  };
}
