import { hintRange, TEMPO_HINT_RANGE, TEMPO_RANGES } from '../analysis/beat-grid';
import type { AudioEngine } from '../audio/engine/audio-engine';
import type { InputDevice, LiveSourceKind, OpenedInput } from '../audio/live-input';
import type { AppAction, AppState } from '../state/app-state';
import { select, watch } from '../state/select';
import type { Store } from '../state/store';
import { errorMessage } from '../util/format';

/** What live input needs of the engine: the AudioEngine, or a fake one. */
export type LiveEngine = Pick<
  AudioEngine,
  'start' | 'connectInput' | 'disconnectInput' | 'monitorInput' | 'tempoRange'
>;

/** Opens and closes the inputs: the browser's (core/audio/live-input.ts), or fake ones. */
export interface InputOpener {
  openDevice(device: InputDevice | null): Promise<OpenedInput>;
  openDisplay(): Promise<OpenedInput>;
  closeInput(stream: MediaStream): void;
}

/**
 * Live input as the source of the music (#55): an audio input or a shared tab or screen
 * (IN-01, IN-02), heard through the app when asked (IN-04), with a tempo given for its beat
 * tracking (TMP-06). The live beat tracking also follows the files until their grid is there:
 * its range comes from here too.
 */
export class LiveSource {
  /** The input while it is the source. */
  private input: OpenedInput | null = null;
  /** Increases with every start or stop of live input; stale attempts are dropped. */
  private token = 0;
  private readonly stops: (() => void)[];

  constructor(
    private readonly store: Store<AppState, AppAction>,
    private readonly engine: LiveEngine,
    private readonly inputs: InputOpener,
    /** Pauses the queue, which live input replaces. */
    private readonly pauseQueue: () => void,
  ) {
    this.updateTrackerRange();
    this.stops = [
      watch(
        select(store, (state) => state.live),
        () => this.updateTrackerRange(),
      ),
      watch(
        select(store, (state) => state.settings.bpmRange),
        () => this.updateTrackerRange(),
      ),
    ];
  }

  /** True while live input is the source (the transport is idle then). */
  get active(): boolean {
    return this.store.state.live.status !== 'off';
  }

  /** The audio input used last, or null for the default input. */
  get lastDevice(): InputDevice | null {
    const { inputDevice, inputDeviceLabel } = this.store.state.settings;
    return inputDevice ? { id: inputDevice, label: inputDeviceLabel } : null;
  }

  /**
   * Makes live input the source (IN-01, IN-02): an audio input (`device`: that input, or the
   * default one for null) or a tab or the screen (`display`). The queue pauses. Call from a
   * user gesture: the browser asks for permission.
   */
  async start(kind: LiveSourceKind, device: InputDevice | null = null): Promise<void> {
    const token = ++this.token;
    this.dispatch({ type: 'live/starting', kind });
    try {
      await this.engine.start();
      const opened =
        kind === 'device' ? await this.inputs.openDevice(device) : await this.inputs.openDisplay();
      if (token !== this.token) {
        this.inputs.closeInput(opened.stream);
        return;
      }
      const previous = this.input;
      this.pauseQueue();
      // Every new source starts unmonitored: a microphone could feed back, a shared tab
      // already plays by itself.
      this.engine.monitorInput = false;
      try {
        this.engine.connectInput(opened.stream);
      } catch (error) {
        this.inputs.closeInput(opened.stream);
        if (previous) this.engine.connectInput(previous.stream);
        // Some browsers only accept inputs at the engine's sample rate.
        throw new Error(
          error instanceof DOMException && error.name === 'NotSupportedError'
            ? 'This browser cannot use this input at 48 kHz. Set the device to 48 kHz in the system sound settings, or use Chrome.'
            : errorMessage(error),
          { cause: error },
        );
      }
      if (previous) this.inputs.closeInput(previous.stream);
      this.input = opened;
      for (const track of opened.stream.getAudioTracks()) {
        // Unplugged, or sharing stopped in the browser's bar.
        track.addEventListener('ended', () => {
          if (this.input === opened) {
            this.stop(kind === 'display' ? 'Sharing has ended.' : 'The audio input was lost.');
          }
        });
      }
      this.dispatch({ type: 'live/started', kind, label: opened.label });
      if (kind === 'device') {
        const { inputDevice, inputDeviceLabel } = this.store.state.settings;
        const id = opened.device?.id ?? '';
        const label = opened.device?.label ?? '';
        if (id !== inputDevice || label !== inputDeviceLabel) {
          this.dispatch({
            type: 'settings/changed',
            changes: { inputDevice: id, inputDeviceLabel: label },
          });
        }
      }
    } catch (error) {
      if (token !== this.token) return;
      this.dispatch({
        type: 'live/failed',
        message: errorMessage(error),
        running: this.input !== null,
      });
    }
  }

  /** Back to the queue as the source; monitoring goes off. */
  stop(reason: string | null = null): void {
    this.token++;
    this.engine.monitorInput = false;
    this.engine.disconnectInput();
    if (this.input) this.inputs.closeInput(this.input.stream);
    this.input = null;
    this.dispatch({ type: 'live/stopped', reason });
  }

  /** Hearing the live input through the app (IN-04). */
  setMonitor(monitor: boolean): void {
    this.engine.monitorInput = monitor;
    this.dispatch({ type: 'live/monitor', monitor });
  }

  /**
   * Sets the tempo (BPM) of the live input (TMP-06): the live beat tracking keeps close to it;
   * null lets it find the tempo itself. Tempos outside {@link TEMPO_HINT_RANGE} are ignored.
   */
  setTempo(bpm: number | null): void {
    if (bpm !== null && !(bpm >= TEMPO_HINT_RANGE.min && bpm <= TEMPO_HINT_RANGE.max)) return;
    const tempo = bpm === null ? null : Math.round(bpm * 100) / 100;
    if (tempo !== this.store.state.live.tempo) this.dispatch({ type: 'live/tempo', tempo });
  }

  /** Lets the input go, and stops following the state. */
  dispose(): void {
    for (const stop of this.stops) stop();
    if (this.input) this.inputs.closeInput(this.input.stream);
    this.input = null;
  }

  private dispatch(action: AppAction): void {
    this.store.dispatch(action);
  }

  /**
   * The range of the live beat tracking (for live input, and for files until their grid is
   * there): around the tempo given for the live input (TMP-06), or the tempo range (AN-12).
   */
  private updateTrackerRange(): void {
    const { live, settings } = this.store.state;
    this.engine.tempoRange =
      live.status === 'on' && live.tempo !== null
        ? hintRange(live.tempo)
        : settings.bpmRange === 'auto'
          ? null
          : TEMPO_RANGES[settings.bpmRange];
  }
}
