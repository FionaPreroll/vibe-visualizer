import {
  ControllerHub,
  PROFILES,
  SoftTakeover,
  type AbsoluteControl,
  type AbsoluteEvent,
  type ConnectedController,
  type ControlEvent,
  type ControllerHubOptions,
} from '@fibestation/dj-controllers';
import { rateLimits } from '../audio/dsp/sound-settings';
import type { Player } from '../player/player';
import { CUE_COUNT, type AppState } from '../state/app-state';

/**
 * DJ controllers in the app (CTL-02, CTL-03): deck 1 plays, cues and sets hot cues, its CFX
 * knob is the DJ filter, the tempo slider the tempo fader, the channel fader the volume, and the
 * jog wheel seeks (faster with SHIFT). Deck 2 and the mixer's own controls do nothing yet, nor
 * do the EQ knobs (Q18). The lights follow the app: PLAY lit while playing and blinking while
 * paused, a pad lit for every hot cue that is set.
 *
 * A fader moved fast sends a hundred values a second, more than the app needs: knobs and faders
 * are passed on once per frame, with their newest value, and so is the MIDI monitor.
 */

export type ControllerStatus = 'off' | 'connecting' | 'on' | 'denied' | 'unsupported';

/** One message in the MIDI monitor. */
export interface MonitorEntry {
  id: number;
  device: string;
  /** The bytes in hex, e.g. "97 02 7F". */
  bytes: string;
  /** What it did, e.g. "deck 1 pad 3 (hotcue) pressed"; null for none. */
  control: string | null;
  /** Whether the controller's profile knows it (the coarse part of a value does nothing alone). */
  known: boolean;
}

export interface ControllerState {
  status: ControllerStatus;
  devices: readonly ConnectedController[];
  /** The newest messages first. */
  messages: readonly MonitorEntry[];
}

/** How many messages the monitor keeps. */
const MONITOR_LENGTH = 40;
/** How often knobs, faders and the monitor are passed on, at most, in ms. */
const FRAME_MS = 16;
/**
 * Seconds of the track per step of the jog wheel: a turn of its top (460 steps) is 1.8 s, as a
 * record at 33⅓ rpm. The outer ring has fewer steps per turn, so it seeks more finely.
 */
const JOG_SECONDS = 1.8 / 460;
/** With SHIFT the jog wheel seeks this much faster: a turn of the top is about 30 s. */
const JOG_SHIFT_FACTOR = 16;
/** How often the jog wheel seeks, at most, in ms; its steps in between add up. */
const JOG_SEEK_MS = 60;
/** After this long without a step, the jog wheel starts from the playback position again. */
const JOG_IDLE_MS = 300;
/** Around the centre of the CFX knob and the tempo slider: the filter off, the tempo at 0 %. */
const CENTRE = 0.01;

export class ControllerService {
  private readonly hub: ControllerHub;
  private readonly takeover = new SoftTakeover();
  private current: ControllerState;
  private readonly listeners = new Set<(state: ControllerState) => void>();
  private readonly cleanups: (() => void)[] = [];
  /** Knobs and faders not passed on yet: the newest value of each. */
  private readonly values = new Map<AbsoluteControl, AbsoluteEvent>();
  /** Monitor entries not shown yet, the oldest first. */
  private logged: MonitorEntry[] = [];
  private frame: ReturnType<typeof setTimeout> | undefined;
  /** Where the jog wheel wants the playhead, and when it said so (performance.now()). */
  private jogTarget: number | null = null;
  private jogAt = 0;
  private jogSeek: ReturnType<typeof setTimeout> | undefined;
  private jogMoved = false;
  private jogIdle: ReturnType<typeof setTimeout> | undefined;
  private nextId = 0;

  constructor(
    private readonly player: Player,
    options: Partial<ControllerHubOptions> = {},
  ) {
    this.hub = new ControllerHub({ profiles: PROFILES, ...options });
    this.current = {
      status: ControllerHub.supported || options.requestAccess ? 'off' : 'unsupported',
      devices: [],
      messages: [],
    };
    this.cleanups.push(
      this.hub.onDevices((devices) => this.update({ devices })),
      this.hub.onMessage(({ device, data, known }) => this.log(device.name, data, known)),
      this.hub.onControl((event) => {
        this.describe(event);
        this.handle(event);
      }),
      player.store.subscribe((state) => this.showLights(state)),
    );
  }

  get state(): ControllerState {
    return this.current;
  }

  /** Svelte store contract. */
  subscribe(listener: (state: ControllerState) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  /** Connects (from a click: the browser may ask for permission), and remembers it. */
  async connect(): Promise<void> {
    if (this.current.status === 'unsupported' || this.hub.started) return;
    this.update({ status: 'connecting' });
    try {
      await this.hub.start();
      this.takeover.reset();
      this.update({ status: 'on' });
      this.player.updateSettings({ controller: true });
    } catch {
      this.update({ status: 'denied' });
    }
  }

  disconnect(): void {
    this.hub.stop();
    this.update({ status: this.current.status === 'unsupported' ? 'unsupported' : 'off' });
    this.player.updateSettings({ controller: false });
  }

  /** At the start: connects again if a controller was connected and MIDI is still allowed. */
  async resume(): Promise<void> {
    if (!this.player.state.settings.controller || this.current.status === 'unsupported') return;
    try {
      const permission = await navigator.permissions.query({ name: 'midi' as PermissionName });
      if (permission.state === 'granted') await this.connect();
    } catch {
      // The browser cannot tell: the controller is connected with a click.
    }
  }

  clearMonitor(): void {
    this.logged = [];
    this.update({ messages: [] });
  }

  dispose(): void {
    clearTimeout(this.frame);
    clearTimeout(this.jogSeek);
    clearTimeout(this.jogIdle);
    for (const cleanup of this.cleanups) cleanup();
    this.hub.stop();
  }

  private handle(event: ControlEvent): void {
    // Only deck 1 for now.
    if (event.deck !== 1) return;
    if (event.kind === 'absolute') {
      // Pickup sees every value; what it lets through is passed on once per frame. Until then
      // the value waiting counts as the app's.
      const waiting = this.values.get(event.control);
      const value = waiting ? waiting.value : this.position(event.control);
      if (value === null || !this.takeover.accept(event.control, event.value, value)) return;
      this.values.set(event.control, event);
      this.schedule();
    } else if (event.kind === 'relative') {
      if (event.control === 'jog') this.jog(event.delta, event.shift);
    } else if (event.pressed) {
      if (event.control === 'play') void this.player.toggle();
      else if (event.control === 'cue') void this.player.stop();
      else if (event.control === 'pad' && event.padMode === 'hotcue' && event.index) {
        this.pad(event.index - 1, event.shift);
      }
    }
  }

  /** Like the keys 1–8: set where empty, jump where set; with SHIFT, delete. */
  private pad(index: number, shift: boolean): void {
    if (shift) {
      this.player.setCue(index, null);
      return;
    }
    // Just after the jog wheel moved, the playhead may not be there yet: the cue goes where
    // the jog wheel took it.
    const jogged = this.jogPosition();
    const empty = (this.player.currentTrack?.cues[index] ?? null) === null;
    if (jogged !== null && empty) this.player.setCue(index, jogged);
    else void this.player.cue(index);
  }

  /** Passes knobs, faders and the monitor on at the next frame. */
  private schedule(): void {
    this.frame ??= setTimeout(() => {
      this.frame = undefined;
      const values = [...this.values.values()];
      this.values.clear();
      for (const event of values) this.absolute(event);
      if (this.logged.length > 0) {
        const messages = [...this.logged.reverse(), ...this.current.messages];
        this.logged = [];
        this.update({ messages: messages.slice(0, MONITOR_LENGTH) });
      }
    }, FRAME_MS);
  }

  /** Where the app's value of a knob or fader is, as its position (0–1); null for unused ones. */
  private position(control: AbsoluteControl): number | null {
    const { sound, settings } = this.player.state;
    if (control === 'filter') return (sound.filter + 1) / 2;
    if (control === 'volume') return settings.volume;
    if (control === 'tempo') {
      const [low, high] = rateLimits(sound.tempoRange);
      return Math.min(1, Math.max(0, (sound.rate - low) / (high - low)));
    }
    return null;
  }

  private absolute(event: AbsoluteEvent): void {
    const position = event.value;
    if (event.control === 'filter') {
      this.player.updateSound({ filter: Math.abs(position - 0.5) < CENTRE ? 0 : position * 2 - 1 });
    } else if (event.control === 'tempo') {
      // The slider covers the tempo fader's range: slower at the top, faster at the bottom.
      const [low, high] = rateLimits(this.player.state.sound.tempoRange);
      const rate = Math.abs(position - 0.5) < CENTRE ? 1 : low + position * (high - low);
      this.player.updateSound({ rate });
    } else if (event.control === 'volume') {
      this.player.updateSettings({ volume: position });
    }
  }

  /** The jog wheel seeks: at once, then at most every JOG_SEEK_MS with the steps added up. */
  private jog(delta: number, shift: boolean): void {
    const track = this.player.currentTrack;
    if (!track || delta === 0 || this.player.live) return;
    const from = this.jogPosition() ?? this.player.position;
    const step = JOG_SECONDS * (shift ? JOG_SHIFT_FACTOR : 1);
    this.jogTarget = Math.max(0, Math.min(track.duration ?? Infinity, from + delta * step));
    this.jogAt = performance.now();
    clearTimeout(this.jogIdle);
    this.jogIdle = setTimeout(() => (this.jogTarget = null), JOG_IDLE_MS);
    this.seekJog();
  }

  private seekJog(): void {
    if (this.jogSeek !== undefined) {
      this.jogMoved = true;
      return;
    }
    if (this.jogTarget !== null) void this.player.seek(this.jogTarget);
    this.jogSeek = setTimeout(() => {
      this.jogSeek = undefined;
      if (!this.jogMoved) return;
      this.jogMoved = false;
      this.seekJog();
    }, JOG_SEEK_MS);
  }

  /** Where the jog wheel took the playhead, moving on with the music; null when it rests. */
  private jogPosition(): number | null {
    if (this.jogTarget === null) return null;
    const { playing, sound } = this.player.state;
    if (!playing) return this.jogTarget;
    return this.jogTarget + ((performance.now() - this.jogAt) / 1000) * sound.rate;
  }

  private showLights(state: AppState): void {
    const track = state.tracks.find((entry) => entry.id === state.currentId);
    const play = state.playing ? 'on' : track && state.live.status !== 'on' ? 'blink' : 'off';
    this.hub.setLight({ control: 'play', deck: 1 }, play);
    for (let index = 1; index <= CUE_COUNT; index++) {
      const set = (track?.cues[index - 1] ?? null) !== null ? 'on' : 'off';
      for (const shift of [false, true]) {
        this.hub.setLight({ control: 'pad', deck: 1, index, padMode: 'hotcue', shift }, set);
      }
    }
  }

  private log(device: string, data: Uint8Array, known: boolean): void {
    const bytes = [...data].map((byte) => byte.toString(16).toUpperCase().padStart(2, '0'));
    this.logged.push({ id: this.nextId++, device, bytes: bytes.join(' '), control: null, known });
    if (this.logged.length > MONITOR_LENGTH) this.logged.shift();
    this.schedule();
  }

  /** Names the control of the newest message for the monitor. */
  private describe(event: ControlEvent): void {
    const newest = this.logged.at(-1);
    if (!newest) return;
    const where = event.deck === null ? 'mixer' : `deck ${event.deck}`;
    const what =
      event.kind === 'button'
        ? `${event.control}${event.index ? ` ${event.index}` : ''}${event.padMode ? ` (${event.padMode})` : ''} ${event.pressed ? 'pressed' : 'released'}`
        : event.kind === 'absolute'
          ? `${event.control} ${event.value.toFixed(3)}`
          : `${event.control} ${event.delta > 0 ? '+' : ''}${event.delta}`;
    newest.control = `${where} ${what}${event.shift ? ' + shift' : ''}`;
  }

  private update(changes: Partial<ControllerState>): void {
    this.current = { ...this.current, ...changes };
    for (const listener of this.listeners) listener(this.current);
  }
}
