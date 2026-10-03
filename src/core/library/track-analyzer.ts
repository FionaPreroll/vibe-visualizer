import type { BeatGrid, TempoRangeId } from '../analysis/beat-grid';
import type { TrackLoudness } from '../analysis/track-loudness';
import { applyGridEdit, NO_GRID_EDIT, sameGridEdit, type GridEdit } from '../analysis/grid-edit';
import { WAVEFORM_RATE, WAVEFORM_STRIDE, type Waveform } from '../analysis/waveform';
import { WorkerClient } from '../util/worker-rpc';
import { sameGrid, type GridRequest, type TrackAnalysisResult } from './analysis-cache';
import type { AnalysisProgress } from './track-analysis.worker';
import TrackAnalysisWorker from './track-analysis.worker.ts?worker';

export interface TrackAnalysisState {
  status: 'waiting' | 'running' | 'done' | 'failed';
  /** Seconds analysed so far: the waveform reaches this far. */
  seconds: number;
  waveform: Waveform | null;
  /** The beat grid, with the user's correction (TR-11) applied. */
  grid: BeatGrid | null;
  /** The tempo the user gave for the grid (TMP-06), or null: the grid found it itself. */
  tempo: number | null;
  /** The tempo range the grid was found in (AN-12). */
  range: TempoRangeId;
  /** How loud the track gets, for the auto-gain of the visuals; null: not known (yet). */
  loudness: TrackLoudness | null;
}

export type TrackAnalyses = ReadonlyMap<string, TrackAnalysisState>;

/**
 * Main-thread face of the track analysis (TR-03, AN-07): a queue of files to analyse one after
 * the other in a worker (the track that plays first), and the results by fingerprint, as a
 * Svelte store. A new tempo for a track (TMP-06) or a new tempo range (AN-12) queues it again;
 * its waveform and grid stay until the new grid is there. The user's correction of a grid
 * (TR-11) is applied here, so everything that uses the grid gets it corrected.
 */
export class TrackAnalyzer {
  private client: WorkerClient | null = null;
  private states: TrackAnalyses = new Map();
  private readonly files = new Map<string, File>();
  /** What each track's grid should be computed with: the tempo given (TMP-06) or the range. */
  private readonly wanted = new Map<string, GridRequest>();
  /** The grids as computed, and the correction of each (TR-11). */
  private readonly computed = new Map<string, BeatGrid>();
  private readonly edits = new Map<string, GridEdit>();
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
   * Analyses `file` once per fingerprint, with the grid at the tempo given (TMP-06) or at the
   * tempo it finds in the range (AN-12); another tempo or range computes the grid again.
   * `first` moves it to the front of the queue.
   */
  request(
    fingerprint: string,
    file: File,
    first = false,
    grid: GridRequest = { tempo: null, range: 'auto' },
  ): void {
    const state = this.states.get(fingerprint);
    const retempo = state?.status === 'done' && !sameGrid(state, grid);
    this.wanted.set(fingerprint, grid);
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
      this.set(fingerprint, {
        status: 'waiting',
        seconds: 0,
        waveform: null,
        grid: null,
        loudness: null,
        ...grid,
      });
    }
    this.queue = first ? [fingerprint, ...this.queue] : [...this.queue, fingerprint];
    void this.pump();
  }

  /** The correction of the grid of `fingerprint` (TR-11), for its grid now and later ones. */
  setEdit(fingerprint: string, edit: GridEdit): void {
    if (sameGridEdit(this.edits.get(fingerprint) ?? NO_GRID_EDIT, edit)) return;
    this.edits.set(fingerprint, edit);
    const computed = this.computed.get(fingerprint);
    if (computed) this.update(fingerprint, { grid: applyGridEdit(computed, edit) });
  }

  /** Drops the analysis of `fingerprint` (its track left the queue). */
  forget(fingerprint: string): void {
    this.queue = this.queue.filter((entry) => entry !== fingerprint);
    this.files.delete(fingerprint);
    this.wanted.delete(fingerprint);
    this.computed.delete(fingerprint);
    this.edits.delete(fingerprint);
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
    const grid = this.wanted.get(fingerprint) ?? { tempo: null, range: 'auto' };
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
        { file, fingerprint, ...grid },
        { onProgress },
      );
      if (this.states.has(fingerprint)) this.computed.set(fingerprint, result.grid);
      this.update(fingerprint, {
        status: 'done',
        seconds: result.duration,
        waveform: result.waveform,
        grid: applyGridEdit(result.grid, this.edits.get(fingerprint) ?? NO_GRID_EDIT),
        tempo: result.tempo,
        range: result.range,
        loudness: result.loudness,
      });
    } catch {
      // A grid that could not be redone keeps the one it had.
      this.update(fingerprint, again ? { status: 'done' } : { status: 'failed' });
    } finally {
      this.running = null;
      // The tempo or range changed meanwhile: once more.
      const wanted = this.wanted.get(fingerprint);
      const state = this.states.get(fingerprint);
      if (state?.status === 'done' && wanted && !sameGrid(state, wanted)) {
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
