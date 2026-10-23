import { TEMPO_HINT_RANGE, type BeatGrid } from '../analysis/beat-grid';
import {
  clampShift,
  downbeatAt,
  NO_GRID_EDIT,
  sameGridEdit,
  shiftBars,
  type GridEdit,
} from '../analysis/grid-edit';
import type { TrackAnalyzer } from '../library/track-analyzer';
import type { AppAction, AppState, Track } from '../state/app-state';
import type { Store } from '../state/store';

/** What the editor needs of the analysis of the tracks: the TrackAnalyzer, or a fake one. */
export type GridAnalysis = Pick<TrackAnalyzer, 'get' | 'request' | 'setEdit'>;

/**
 * The beat grid of each file as the user wants it (#55): at the tempo given for the file
 * (TMP-06) or found in the tempo range (AN-12), with one tempo throughout or not (TR-12), and
 * with the corrections of the grid of the track playing (TR-11). The analysis computes a grid
 * anew for a new tempo; a correction applies to the grid it has.
 */
export class GridEditor {
  constructor(
    private readonly store: Store<AppState, AppAction>,
    private readonly analysis: GridAnalysis,
    /** The file of a queue entry, while the browser gives it. */
    private readonly fileOf: (id: string) => File | undefined,
    /** Where the playhead is (seconds). */
    private readonly position: () => number,
  ) {}

  /**
   * The waveform and beat grid of a file: analysed in the background (the one that plays
   * first), with the tempo given for it (TMP-06) or in the tempo range (AN-12), and its grid
   * corrected as the user did (TR-11).
   */
  analyse(fingerprint: string, file: File, first: boolean): void {
    const track = this.state.tracks.find((entry) => entry.fingerprint === fingerprint);
    this.analysis.setEdit(fingerprint, track?.gridEdit ?? NO_GRID_EDIT);
    this.analysis.request(fingerprint, file, first, {
      tempo: track?.tempo ?? null,
      range: this.state.settings.bpmRange,
      fixed: track?.fixedTempo ?? false,
    });
  }

  /**
   * Sets the tempo (BPM) of the beat grid of track `id` and of every other entry of its file
   * (TMP-06), e.g. double the tempo found; null lets the grid find the tempo again. The grid is
   * computed anew in the background; tempos outside {@link TEMPO_HINT_RANGE} are ignored.
   */
  setTempo(id: string, bpm: number | null): void {
    const track = this.state.tracks.find((entry) => entry.id === id);
    const fingerprint = track?.fingerprint;
    if (!fingerprint) return;
    if (bpm !== null && !(bpm >= TEMPO_HINT_RANGE.min && bpm <= TEMPO_HINT_RANGE.max)) return;
    const tempo = bpm === null ? null : Math.round(bpm * 100) / 100;
    if (tempo === track.tempo) return;
    this.store.dispatch({ type: 'tracks/tempo', fingerprint, tempo });
    this.analyseAgain(track);
  }

  /**
   * One tempo throughout for track `id` and every other entry of its file (TR-12), or not: its
   * beat grid is computed anew, straight from the start to the end, with bars that keep their
   * place.
   */
  setFixedTempo(id: string, fixed: boolean): void {
    const track = this.state.tracks.find((entry) => entry.id === id);
    const fingerprint = track?.fingerprint;
    if (!fingerprint || track.fixedTempo === fixed) return;
    this.store.dispatch({ type: 'tracks/fixed', fingerprint, fixed });
    this.analyseAgain(track);
  }

  /** New grids in the new tempo range (AN-12) for the files without a tempo given. */
  regridAll(): void {
    const done = new Set<string>();
    const current = this.currentTrack;
    const tracks = current ? [current, ...this.state.tracks] : this.state.tracks;
    for (const track of tracks) {
      const file = this.fileOf(track.id);
      if (!track.fingerprint || !file || done.has(track.fingerprint)) continue;
      done.add(track.fingerprint);
      if (track.tempo === null) this.analyse(track.fingerprint, file, track === current);
    }
  }

  /** The beat nearest to the playhead becomes the first of its bar (TR-11). */
  setDownbeat(): void {
    this.edit((grid, edit) => downbeatAt(grid, edit, this.position()));
  }

  /** The bars start one beat later (1) or earlier (-1) (TR-11). */
  moveBars(direction: -1 | 1): void {
    this.edit((grid, edit) => shiftBars(grid, edit, this.position(), direction));
  }

  /** Moves the beat grid by `seconds` (TR-11): later for a positive value. */
  nudge(seconds: number): void {
    this.edit((_, edit) => ({ ...edit, shift: clampShift(edit.shift + seconds) }));
  }

  /**
   * Moves the beat grid to `shift` seconds from where the analysis put it (TR-11), as it is
   * dragged; `commit` once the drag ends.
   */
  shift(shift: number, commit: boolean): void {
    this.edit((_, edit) => ({ ...edit, shift: clampShift(shift) }), commit);
  }

  /** The beat grid of the current track as the analysis found it (TR-11). */
  reset(): void {
    this.edit(() => NO_GRID_EDIT);
  }

  private get state(): AppState {
    return this.store.state;
  }

  private get currentTrack(): Track | null {
    const { tracks, currentId } = this.state;
    return tracks.find((track) => track.id === currentId) ?? null;
  }

  /** The grid of the file of `track` once more, with what is given for the file now. */
  private analyseAgain(track: Track): void {
    const { fingerprint } = track;
    const entry = this.state.tracks.find(
      (other) => other.fingerprint === fingerprint && this.fileOf(other.id) !== undefined,
    );
    const file = entry ? this.fileOf(entry.id) : undefined;
    if (fingerprint && file) this.analyse(fingerprint, file, track.id === this.state.currentId);
  }

  /**
   * Corrects the beat grid of the current track (TR-11), for every entry of its file: `change`
   * gives the new correction from the corrected grid and the correction so far. With `commit`
   * false only the grid follows (while the grid is dragged); the correction is kept once it is
   * committed.
   */
  private edit(change: (grid: BeatGrid, edit: GridEdit) => GridEdit, commit = true): void {
    const track = this.currentTrack;
    const fingerprint = track?.fingerprint;
    const grid = this.analysis.get(fingerprint ?? null)?.grid;
    if (!track || !fingerprint || !grid) return;
    const edit = change(grid, track.gridEdit);
    this.analysis.setEdit(fingerprint, edit);
    if (commit && !sameGridEdit(edit, track.gridEdit)) {
      this.store.dispatch({ type: 'tracks/grid', fingerprint, edit });
    }
  }
}
