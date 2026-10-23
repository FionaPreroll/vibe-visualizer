import type { SoundSettings } from '../audio/dsp/sound-settings';
import type { StoredQueue } from '../library/queue-store';
import type { KaleidoSettings } from '../render/kaleido-settings';
import type { LogoSpectrumSettings } from '../render/visual-settings';
import type { Settings, Track, TrackData } from '../state/app-state';
import { watch, type AppParts } from '../state/select';

/** Where the state is kept: the browser's storage in the app, a fake one in the tests. */
export interface StateStorage {
  saveSettings(settings: Settings): void;
  saveSound(sound: SoundSettings): void;
  saveVisuals(visuals: LogoSpectrumSettings): void;
  saveKaleido(kaleido: KaleidoSettings): void;
  saveTrackData(fingerprint: string, data: TrackData): void;
  saveQueue(queue: StoredQueue): Promise<void>;
  /** Writes what waits to be written, at once. */
  flushWrites(): void;
}

/** How long the queue waits for more changes before it is saved (ms): they come in bursts. */
export const QUEUE_SAVE_DELAY = 400;

/**
 * Keeps what is stored in step with the state (#55): the settings, the sound, the looks and the
 * details of each file (TR-05) when they change, the queue (SRC-05) soon after its changes, and
 * only once the queue of the last visit is back.
 */
export class StateSync {
  private readonly stops: (() => void)[];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    parts: AppParts,
    private readonly storage: StateStorage,
    /** The queue as it is stored, now. */
    private readonly queue: () => StoredQueue,
    /** Resolves once the queue of the last visit is back: it is not overwritten before. */
    private readonly restored: Promise<void>,
  ) {
    this.stops = [
      watch(parts.settings, (now) => storage.saveSettings(now)),
      watch(parts.sound, (now) => storage.saveSound(now)),
      watch(parts.visuals, (now) => storage.saveVisuals(now)),
      watch(parts.kaleido, (now) => storage.saveKaleido(now)),
      watch(parts.tracks, (now, before) => {
        this.saveTrackData(before, now);
        this.saveQueueSoon();
      }),
      watch(parts.currentId, () => this.saveQueueSoon()),
    ];
  }

  /** Saves what waits, at once: the page is hidden, and may not come back. */
  flush(): void {
    this.storage.flushWrites();
    if (this.timer !== undefined) void this.saveQueue();
  }

  /** Stops following the state, once what waits is saved. */
  dispose(): void {
    for (const stop of this.stops) stop();
    this.flush();
  }

  private saveQueueSoon(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.saveQueue(), QUEUE_SAVE_DELAY);
  }

  private async saveQueue(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.restored;
    await this.storage.saveQueue(this.queue());
  }

  /** The details of the files whose cues, markers, tempo, grid, names or colours changed. */
  private saveTrackData(previous: readonly Track[], next: readonly Track[]): void {
    const before = new Map(previous.map((track) => [track.id, track]));
    for (const track of next) {
      if (!track.fingerprint) continue;
      const old = before.get(track.id);
      const unchanged =
        old?.fingerprint === track.fingerprint &&
        old.cues === track.cues &&
        old.marks === track.marks &&
        old.tempo === track.tempo &&
        old.fixedTempo === track.fixedTempo &&
        old.gridEdit === track.gridEdit &&
        old.edit === track.edit &&
        old.colors === track.colors &&
        old.look === track.look;
      if (!unchanged) {
        const { cues, marks, tempo, fixedTempo, gridEdit, edit, colors, look } = track;
        this.storage.saveTrackData(track.fingerprint, {
          cues,
          marks,
          tempo,
          fixedTempo,
          gridEdit,
          edit,
          colors,
          look,
        });
      }
    }
  }
}
