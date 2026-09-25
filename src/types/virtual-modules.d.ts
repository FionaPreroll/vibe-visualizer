declare module 'virtual:signalsmith-stretch-wasm' {
  /** The Signalsmith Stretch WebAssembly binary, base64-encoded. */
  export const wasmBase64: string;
  /** Maps C function names (e.g. `_process`) to the minified WASM export names. */
  export const exportNames: Record<string, string>;
  /** Maps Emscripten runtime function names to the minified WASM import names. */
  export const importNames: Record<string, string>;
}
