import { sleep } from '../core/util/format';

export type MemoryMeasurement =
  { kind: 'bytes'; bytes: number } | { kind: 'unavailable'; reason: string } | { kind: 'timeout' };

/**
 * Total memory of this page including its workers (Chromium, cross-origin isolated only).
 * The browser answers after its next garbage collection, which can take a while.
 */
export async function measurePageMemory(timeoutMs: number): Promise<MemoryMeasurement> {
  const perf = performance as Performance & {
    measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
  };
  if (!perf.measureUserAgentSpecificMemory || !globalThis.crossOriginIsolated) {
    return { kind: 'unavailable', reason: 'not supported by this browser (Chrome only)' };
  }
  // The API can exist and still refuse to run (e.g. in headless browsers).
  const measurement = perf
    .measureUserAgentSpecificMemory()
    .then((result): MemoryMeasurement => ({ kind: 'bytes', bytes: result.bytes }))
    .catch((error: unknown): MemoryMeasurement => ({
      kind: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
    }));
  return Promise.race([
    measurement,
    sleep(timeoutMs).then((): MemoryMeasurement => ({ kind: 'timeout' })),
  ]);
}
