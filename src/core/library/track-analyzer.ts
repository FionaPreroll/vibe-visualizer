import type { BeatGrid } from '../analysis/beat-grid';
import { WAVEFORM_RATE, WAVEFORM_STRIDE, type Waveform } from '../analysis/waveform';
import { WorkerClient } from '../util/worker-rpc';
import type { TrackAnalysisResult } from './analysis-cache';
import type { AnalysisProgress } from './track-analysis.worker';
import TrackAnalysisWorker from './track-analysis.worker.ts?worker';

export interface TrackAnalysisState {
  status: 'waiting' | 'running' | 'done' | 'failed';
  /** Seconds analysed so far: the waveform reaches this far. */
  seconds: number;
  waveform: Waveform | null;
  grid: BeatGrid | null;
}

export type TrackAnalyses = ReadonlyMap<string, TrackAnalysisState>;

/**
 * Main-thread face of the track analysis (TR-03, AN-07): a queue of files to analyse one after
 * the other in a worker (the track that plays first), and the results by fingerprint, as a
 * Svelte store.
 */
export class TrackAnalyzer {
  private client: WorkerClient | null = null;
  private states: TrackAnalyses = new Map();
  private readonly files = new Map<string, File>();
  private queue: string[] = [];
  private running: string | null = null;
  private readonly listeners = new Set<(states: TrackAnalyses) => void>();

  /** Svelte store contract. */
  subscribe(listener: (states: TrackAnalyses) => void): () => void {
    this.listeners.add(listener);
    listener(this.states);
    return () => this.listeners.delete(listener);
  }

  get(fingerprint: string | null): TrackAnalysisState | undefined {
    return fingerprint ? this.states.get(fingerprint) : undefined;
  }

  /** Analyses `file` once per fingerprint; `first` moves it to the front of the queue. */
  request(fingerprint: string, file: File, first = false): void {
    const state = this.states.get(fingerprint);
    if (state && state.status !== 'failed') {
      if (first && state.status === 'waiting') {
        this.queue = [fingerprint, ...this.queue.filter((entry) => entry !== fingerprint)];
      }
      return;
    }
    this.files.set(fingerprint, file);
    this.set(fingerprint, { status: 'waiting', seconds: 0, waveform: null, grid: null });
    this.queue = first ? [fingerprint, ...this.queue] : [...this.queue, fingerprint];
    void this.pump();
  }

  /** Drops the analysis of `fingerprint` (its track left the queue). */
  forget(fingerprint: string): void {
    this.queue = this.queue.filter((entry) => entry !== fingerprint);
    this.files.delete(fingerprint);
    if (this.running === fingerprint) void this.client?.call('cancel', { fingerprint });
    if (!this.states.has(fingerprint)) return;
    const states = new Map(this.states);
    states.delete(fingerprint);
    this.publish(states);
  }

  dispose(): void {
    this.client?.terminate();
    this.client = null;
  }

  private worker(): WorkerClient {
    this.client ??= new WorkerClient(new TrackAnalysisWorker());
    return this.client;
  }

  private async pump(): Promise<void> {
    if (this.running !== null) return;
    const fingerprint = this.queue.shift();
    if (fingerprint === undefined) return;
    const file = this.files.get(fingerprint);
    if (!file) return this.pump();
    this.running = fingerprint;
    this.update(fingerprint, { status: 'running' });
    // The waveform grows while the file is analysed.
    let data = new Uint8Array(0);
    const onProgress = (update: AnalysisProgress) => {
      if (!this.states.has(fingerprint)) return;
      const end = update.from * WAVEFORM_STRIDE + update.data.length;
      if (end > data.length) {
        const grown = new Uint8Array(Math.max(end, data.length * 2));
        grown.set(data);
        data = grown;
      }
      data.set(update.data, update.from * WAVEFORM_STRIDE);
      this.update(fingerprint, {
        seconds: update.seconds,
        waveform: { rate: WAVEFORM_RATE, length: end / WAVEFORM_STRIDE, data },
      });
    };
    try {
      const result = await this.worker().call<TrackAnalysisResult>(
        'analyse',
        { file, fingerprint },
        { onProgress },
      );
      this.update(fingerprint, {
        status: 'done',
        seconds: result.duration,
        waveform: result.waveform,
        grid: result.grid,
      });
    } catch {
      this.update(fingerprint, { status: 'failed' });
    } finally {
      this.files.delete(fingerprint);
      this.running = null;
      void this.pump();
    }
  }

  private set(fingerprint: string, state: TrackAnalysisState): void {
    const states = new Map(this.states);
    states.set(fingerprint, state);
    this.publish(states);
  }

  /** Changes a known entry (entries that were forgotten meanwhile stay gone). */
  private update(fingerprint: string, changes: Partial<TrackAnalysisState>): void {
    const state = this.states.get(fingerprint);
    if (state) this.set(fingerprint, { ...state, ...changes });
  }

  private publish(states: TrackAnalyses): void {
    this.states = states;
    for (const listener of this.listeners) listener(states);
  }
}
