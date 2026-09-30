import type { BeatGrid } from '../analysis/beat-grid';
import { WAVEFORM_RATE, WAVEFORM_STRIDE, type Waveform } from '../analysis/waveform';
import { WorkerClient } from '../util/worker-rpc';
import { sameTempo, type TrackAnalysisResult } from './analysis-cache';
import type { AnalysisProgress } from './track-analysis.worker';
import TrackAnalysisWorker from './track-analysis.worker.ts?worker';

export interface TrackAnalysisState {
  status: 'waiting' | 'running' | 'done' | 'failed';
  /** Seconds analysed so far: the waveform reaches this far. */
  seconds: number;
  waveform: Waveform | null;
  grid: BeatGrid | null;
  /** The tempo the user gave for the grid (TMP-06), or null: the grid found it itself. */
  tempo: number | null;
}

export type TrackAnalyses = ReadonlyMap<string, TrackAnalysisState>;

/**
 * Main-thread face of the track analysis (TR-03, AN-07): a queue of files to analyse one after
 * the other in a worker (the track that plays first), and the results by fingerprint, as a
 * Svelte store. A new tempo for a track (TMP-06) queues it again; its waveform and grid stay
 * until the new grid is there.
 */
export class TrackAnalyzer {
  private client: WorkerClient | null = null;
  private states: TrackAnalyses = new Map();
  private readonly files = new Map<string, File>();
  /** The tempo each track's grid should have (TMP-06); null for the grid's own. */
  private readonly tempos = new Map<string, number | null>();
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

  /**
   * Analyses `file` once per fingerprint, with the grid at `tempo` (TMP-06) or at the tempo it
   * finds; a new tempo analyses it again. `first` moves it to the front of the queue.
   */
  request(fingerprint: string, file: File, first = false, tempo: number | null = null): void {
    const state = this.states.get(fingerprint);
    const retempo = state?.status === 'done' && !sameTempo(state.tempo, tempo);
    this.tempos.set(fingerprint, tempo);
    if (state && state.status !== 'failed' && !retempo) {
      // Waiting or running: it takes the tempo when it starts, or runs again after.
      if (state.status !== 'done') this.files.set(fingerprint, file);
      if (first && state.status === 'waiting') {
        this.queue = [fingerprint, ...this.queue.filter((entry) => entry !== fingerprint)];
      }
      return;
    }
    this.files.set(fingerprint, file);
    if (retempo) {
      this.update(fingerprint, { status: 'waiting' });
    } else {
      this.set(fingerprint, { status: 'waiting', seconds: 0, waveform: null, grid: null, tempo });
    }
    this.queue = first ? [fingerprint, ...this.queue] : [...this.queue, fingerprint];
    void this.pump();
  }

  /** Drops the analysis of `fingerprint` (its track left the queue). */
  forget(fingerprint: string): void {
    this.queue = this.queue.filter((entry) => entry !== fingerprint);
    this.files.delete(fingerprint);
    this.tempos.delete(fingerprint);
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
    const tempo = this.tempos.get(fingerprint) ?? null;
    // A new grid for a track with its waveform: the waveform stays as it is.
    const again = this.states.get(fingerprint)?.waveform !== null;
    this.update(fingerprint, { status: 'running' });
    // The waveform grows while the file is analysed.
    let data = new Uint8Array(0);
    const onProgress = (update: AnalysisProgress) => {
      if (!this.states.has(fingerprint) || again) return;
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
        { file, fingerprint, tempo },
        { onProgress },
      );
      this.update(fingerprint, {
        status: 'done',
        seconds: result.duration,
        waveform: result.waveform,
        grid: result.grid,
        tempo: result.tempo,
      });
    } catch {
      // A grid that could not be redone keeps the one it had.
      this.update(fingerprint, again ? { status: 'done' } : { status: 'failed' });
    } finally {
      this.running = null;
      // The tempo changed meanwhile: once more.
      const wanted = this.tempos.get(fingerprint) ?? null;
      const state = this.states.get(fingerprint);
      if (state?.status === 'done' && !sameTempo(state.tempo, wanted)) {
        this.update(fingerprint, { status: 'waiting' });
        this.queue = [fingerprint, ...this.queue];
      } else {
        this.files.delete(fingerprint);
      }
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
