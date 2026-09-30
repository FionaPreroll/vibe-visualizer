import {
  ControllerHub,
  PROFILES,
  SoftTakeover,
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
 * knob is the DJ filter, the tempo slider the tempo fader, the channel fader the volume and the
 * jog wheel nudges. Deck 2 and the mixer's own controls do nothing yet, nor do the EQ knobs
 * (Q18). The lights follow the app: PLAY lit while playing and blinking while paused, a pad lit
 * for every hot cue that is set.
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
/** How long a nudge lasts after the jog wheel stopped moving, in ms. */
const JOG_RELEASE_MS = 150;
/** Around the centre of the CFX knob and the tempo slider: the filter off, the tempo at 0 %. */
const CENTRE = 0.01;

export class ControllerService {
  private readonly hub: ControllerHub;
  private readonly takeover = new SoftTakeover();
  private current: ControllerState;
  private readonly listeners = new Set<(state: ControllerState) => void>();
  private readonly cleanups: (() => void)[] = [];
  private jogTimer: ReturnType<typeof setTimeout> | undefined;
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
    this.update({ messages: [] });
  }

  dispose(): void {
    clearTimeout(this.jogTimer);
    for (const cleanup of this.cleanups) cleanup();
    this.hub.stop();
  }

  private handle(event: ControlEvent): void {
    // Only deck 1 for now.
    if (event.deck !== 1) return;
    if (event.kind === 'absolute') {
      this.absolute(event);
    } else if (event.kind === 'relative') {
      if (event.control === 'jog') this.jog(event.delta);
    } else if (event.pressed) {
      if (event.control === 'play') void this.player.toggle();
      else if (event.control === 'cue') void this.player.stop();
      else if (event.control === 'pad' && event.padMode === 'hotcue' && event.index) {
        // Like the keys 1–8: set where empty, jump where set; with SHIFT, delete.
        if (event.shift) this.player.setCue(event.index - 1, null);
        else void this.player.cue(event.index - 1);
      }
    }
  }

  private absolute(event: AbsoluteEvent): void {
    const { sound, settings } = this.player.state;
    const position = event.value;
    if (event.control === 'filter') {
      const filter = Math.abs(position - 0.5) < CENTRE ? 0 : position * 2 - 1;
      if (this.takeover.accept('filter', position, (sound.filter + 1) / 2)) {
        this.player.updateSound({ filter });
      }
    } else if (event.control === 'tempo') {
      // The slider covers the tempo fader's range: slower at the top, faster at the bottom.
      const [low, high] = rateLimits(sound.tempoRange);
      const span = high - low;
      const rate = Math.abs(position - 0.5) < CENTRE ? 1 : low + position * span;
      const current = Math.min(1, Math.max(0, (sound.rate - low) / span));
      if (this.takeover.accept('tempo', position, current)) this.player.updateSound({ rate });
    } else if (event.control === 'volume') {
      if (this.takeover.accept('volume', position, settings.volume)) {
        this.player.updateSettings({ volume: position });
      }
    }
  }

  /** The jog wheel nudges the tempo while it turns (TMP-03). */
  private jog(delta: number): void {
    if (delta === 0) return;
    this.player.nudge(delta > 0 ? 1 : -1);
    clearTimeout(this.jogTimer);
    this.jogTimer = setTimeout(() => this.player.nudge(0), JOG_RELEASE_MS);
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
    const entry = { id: this.nextId++, device, bytes: bytes.join(' '), control: null, known };
    this.update({ messages: [entry, ...this.current.messages].slice(0, MONITOR_LENGTH) });
  }

  /** Names the control of the newest message in the monitor. */
  private describe(event: ControlEvent): void {
    const [newest, ...rest] = this.current.messages;
    if (!newest) return;
    const where = event.deck === null ? 'mixer' : `deck ${event.deck}`;
    const what =
      event.kind === 'button'
        ? `${event.control}${event.index ? ` ${event.index}` : ''}${event.padMode ? ` (${event.padMode})` : ''} ${event.pressed ? 'pressed' : 'released'}`
        : event.kind === 'absolute'
          ? `${event.control} ${event.value.toFixed(3)}`
          : `${event.control} ${event.delta > 0 ? '+' : ''}${event.delta}`;
    const control = `${where} ${what}${event.shift ? ' + shift' : ''}`;
    this.update({ messages: [{ ...newest, control }, ...rest] });
  }

  private update(changes: Partial<ControllerState>): void {
    this.current = { ...this.current, ...changes };
    for (const listener of this.listeners) listener(this.current);
  }
}
