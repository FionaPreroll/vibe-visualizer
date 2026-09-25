import { sleep } from '../core/util/format';

export type MemoryMeasurement =
  { kind: 'bytes'; bytes: number } | { kind: 'unavailable' } | { kind: 'timeout' };

/**
 * Total memory of this page including its workers (Chromium, cross-origin isolated only).
 * The browser answers after its next garbage collection, which can take a while.
 */
export async function measurePageMemory(timeoutMs: number): Promise<MemoryMeasurement> {
  const perf = performance as Performance & {
    measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
  };
  if (!perf.measureUserAgentSpecificMemory || !globalThis.crossOriginIsolated) {
    return { kind: 'unavailable' };
  }
  return Promise.race([
    perf
      .measureUserAgentSpecificMemory()
      .then((result): MemoryMeasurement => ({ kind: 'bytes', bytes: result.bytes })),
    sleep(timeoutMs).then((): MemoryMeasurement => ({ kind: 'timeout' })),
  ]);
}
