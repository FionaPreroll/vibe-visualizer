import type { CapabilityReport } from '../core/env/capabilities';

export type CheckState = 'pass' | 'fail' | 'info';

export interface Check {
  label: string;
  state: CheckState;
  detail: string;
}

export type SpikeStatus = 'idle' | 'running' | 'done' | 'error';

export interface SpikeResult {
  status: SpikeStatus;
  checks: Check[];
  metrics: Record<string, string>;
  log: string[];
  error: string | null;
}

export const SPIKES = [
  { id: 'S1', title: 'Streaming audio' },
  { id: 'S2', title: 'Key lock' },
  { id: 'S3', title: 'Encoding' },
  { id: 'S4', title: 'Rendering' },
  { id: 'S5', title: 'Long render' },
] as const;

export type SpikeId = (typeof SPIKES)[number]['id'];

function emptyResult(): SpikeResult {
  return { status: 'idle', checks: [], metrics: {}, log: [], error: null };
}

class LabState {
  env = $state<CapabilityReport | null>(null);
  results = $state<Record<SpikeId, SpikeResult>>({
    S1: emptyResult(),
    S2: emptyResult(),
    S3: emptyResult(),
    S4: emptyResult(),
    S5: emptyResult(),
  });
}

export const lab = new LabState();

/** Collects the outcome of one spike run into the shared lab state. */
export class SpikeRun {
  private readonly startedAt = performance.now();

  constructor(private readonly id: SpikeId) {
    lab.results[id] = { ...emptyResult(), status: 'running' };
  }

  private get result(): SpikeResult {
    return lab.results[this.id];
  }

  log(message: string): void {
    const seconds = ((performance.now() - this.startedAt) / 1000).toFixed(1).padStart(6);
    this.result.log.push(`${seconds}s  ${message}`);
  }

  metric(name: string, value: string): void {
    this.result.metrics[name] = value;
  }

  /** Records a pass/fail check; `null` records an informational line. */
  check(label: string, passed: boolean | null, detail: string): void {
    const state: CheckState = passed === null ? 'info' : passed ? 'pass' : 'fail';
    const existing = this.result.checks.find((c) => c.label === label);
    if (existing) Object.assign(existing, { state, detail });
    else this.result.checks.push({ label, state, detail });
  }

  done(): void {
    this.result.status = 'done';
    this.log('finished');
  }

  fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.result.status = 'error';
    this.result.error = message;
    this.log(`error: ${message}`);
    console.error(error);
  }
}
