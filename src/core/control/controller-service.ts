import {
  ControllerHub,
  learnBinding,
  learnedProfile,
  PROFILES,
  sanitizeProfile,
  SoftTakeover,
  type AbsoluteControl,
  type AbsoluteEvent,
  type ConnectedController,
  type ControlBinding,
  type ControlEvent,
  type ControllerHubOptions,
  type ControllerProfile,
} from '@fibestation/dj-controllers';
import { rateLimits } from '../audio/dsp/sound-settings';
import { APP_VERSION } from '../env/version';
import type { Player } from '../player/player';
import { CUE_COUNT, type AppState } from '../state/app-state';
import { LEARN_STEPS, learnedBindings } from './learn-steps';

/**
 * DJ controllers in the app (CTL-02, CTL-03): deck 1 plays, cues and sets hot cues, its CFX
 * knob is the DJ filter, the tempo slider the tempo fader, the channel fader the volume, and the
 * jog wheel seeks (faster with SHIFT). CUE works as on a CDJ, with the in marker as the cue
 * point (TR-09). Deck 2 and the mixer's own controls do nothing yet, nor do the EQ knobs (Q18).
 * The lights follow the app: PLAY lit while playing and blinking while paused, CUE lit at the
 * cue point and blinking while paused elsewhere, a pad lit for every hot cue that is set.
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

/** MIDI learn (CTL-04) for one device, while the dialog teaches it. */
export interface LearnState {
  /** The id of the device's input port, and its name. */
  deviceId: string;
  deviceName: string;
  /** The step listening now, or none. */
  listening: string | null;
  /** What each step learned; null: what it heard fits no binding. */
  learned: Readonly<Record<string, ControlBinding | null>>;
  /** How many messages each step heard. */
  counts: Readonly<Record<string, number>>;
}

export interface ControllerState {
  status: ControllerStatus;
  devices: readonly ConnectedController[];
  /** The newest messages first. */
  messages: readonly MonitorEntry[];
  /** The profiles of the user's own controllers, learned or imported. */
  profiles: readonly ControllerProfile[];
  learn: LearnState | null;
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
/** Around the centre of the CFX knob and the tempo slider: the filter off, the tempo at 0 %. */
const CENTRE = 0.01;
/** How close the playhead must be to the cue point to be at it, in seconds. */
const AT_CUE = 0.05;
/** How often the lights that follow the playhead (CUE) are checked, in ms. */
const LIGHTS_MS = 250;
/** Where the user's own profiles are kept. */
const PROFILES_KEY = 'vibe-visualizer:controllers:v1';
/** At most this many messages are kept per step of MIDI learn. */
const LEARN_MESSAGES = 256;
/** A step of MIDI learn ends this long after the control's last message, in ms. */
const LEARN_QUIET_MS = { button: 500, moving: 1200 };

/** The profiles of the user's controllers, as kept. */
function loadProfiles(): ControllerProfile[] {
  try {
    const stored = JSON.parse(localStorage.getItem(PROFILES_KEY) ?? '{}') as { profiles?: unknown };
    if (!Array.isArray(stored.profiles)) return [];
    return stored.profiles.map(sanitizeProfile).filter((profile) => profile !== null);
  } catch {
    return [];
  }
}

function hex(data: readonly number[]): string {
  return data.map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

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
  /** CUE is held at the cue point: the music plays until it is let go. */
  private previewing = false;
  private lightTimer: ReturnType<typeof setInterval> | undefined;
  private nextId = 0;
  /** What each step of MIDI learn heard, as it came. */
  private readonly recorded = new Map<string, number[][]>();
  private learnTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly player: Player,
    options: Partial<ControllerHubOptions> = {},
  ) {
    const profiles = loadProfiles();
    this.hub = new ControllerHub({ profiles: [...profiles, ...PROFILES], ...options });
    this.current = {
      status: ControllerHub.supported || options.requestAccess ? 'off' : 'unsupported',
      devices: [],
      messages: [],
      profiles,
      learn: null,
    };
    this.cleanups.push(
      this.hub.onDevices((devices) => this.update({ devices })),
      this.hub.onMessage(({ device, data, known }) => {
        this.log(device.name, data, known);
        this.record(device.id, data);
      }),
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
      clearInterval(this.lightTimer);
      this.lightTimer = setInterval(() => this.showLights(this.player.state), LIGHTS_MS);
      this.update({ status: 'on' });
      this.player.updateSettings({ controller: true });
    } catch {
      this.update({ status: 'denied' });
    }
  }

  disconnect(): void {
    clearInterval(this.lightTimer);
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

  /** Starts teaching the app a controller without a profile, or with one of the user's. */
  startLearning(deviceId: string): void {
    const device = this.current.devices.find((entry) => entry.id === deviceId);
    if (!device) return;
    clearTimeout(this.learnTimer);
    this.recorded.clear();
    // A profile learned before starts the bindings, so a step can be redone alone.
    const yours = this.current.profiles.find((profile) => profile === device.profile);
    const learned: Record<string, ControlBinding | null> = {};
    for (const step of LEARN_STEPS) {
      const binding = yours?.controls.find((entry) => sameTarget(entry, step.target));
      if (binding) learned[step.id] = binding;
    }
    this.update({
      learn: { deviceId, deviceName: device.name, listening: null, learned, counts: {} },
    });
  }

  /** Listens for the control of a step: what the device sends next is learned for it. */
  listen(stepId: string): void {
    const learn = this.current.learn;
    if (!learn || !LEARN_STEPS.some((step) => step.id === stepId)) return;
    clearTimeout(this.learnTimer);
    this.recorded.set(stepId, []);
    this.update({
      learn: { ...learn, listening: stepId, counts: { ...learn.counts, [stepId]: 0 } },
    });
  }

  /** Stops listening: the step learns from what it heard so far. */
  stopListening(): void {
    clearTimeout(this.learnTimer);
    this.finishStep();
  }

  /** Forgets what a step learned. */
  forgetStep(stepId: string): void {
    const learn = this.current.learn;
    if (!learn) return;
    const learned = { ...learn.learned };
    delete learned[stepId];
    this.recorded.delete(stepId);
    this.update({ learn: { ...learn, learned, counts: { ...learn.counts, [stepId]: 0 } } });
  }

  endLearning(): void {
    clearTimeout(this.learnTimer);
    this.recorded.clear();
    this.update({ learn: null });
  }

  /**
   * Keeps what was learned as a profile of the device's (replacing one it had), which it uses at
   * once. With `lights`, the app lights the learned buttons with their own notes. Null when
   * nothing was learned.
   */
  saveLearned(name: string, lights: boolean): ControllerProfile | null {
    const learn = this.current.learn;
    if (!learn) return null;
    const controls = learnedBindings(learn.learned);
    if (controls.length === 0) return null;
    const profile = learnedProfile(
      learn.deviceName,
      name.trim().slice(0, 120) || learn.deviceName,
      controls,
      lights,
    );
    this.addProfile(profile);
    return profile;
  }

  /** Adds a profile of the user's, replacing one for the same device. */
  addProfile(profile: ControllerProfile): void {
    const profiles = [
      profile,
      ...this.current.profiles.filter(
        (other) => other.id !== profile.id && other.ports.input !== profile.ports.input,
      ),
    ];
    this.setProfiles(profiles);
  }

  removeProfile(id: string): void {
    this.setProfiles(this.current.profiles.filter((profile) => profile.id !== id));
  }

  /**
   * Adds the profile in a file's text: a profile, or a controller report with one. Throws a
   * message for the user when there is none.
   */
  importProfile(text: string): ControllerProfile {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('This is no profile file.');
    }
    const candidate =
      typeof parsed === 'object' && parsed !== null && 'profile' in parsed
        ? (parsed as { profile: unknown }).profile
        : parsed;
    const profile = sanitizeProfile(candidate);
    if (!profile) throw new Error('This file has no controller profile.');
    this.addProfile(profile);
    return profile;
  }

  /**
   * The controller report: everything the device sent for each step of MIDI learn, what the app
   * learned from it, and the MIDI ports, so that a profile can be built for the controller.
   */
  report(): string {
    const learn = this.current.learn;
    const controls = learn ? learnedBindings(learn.learned) : [];
    const name = learn?.deviceName ?? '';
    return JSON.stringify(
      {
        format: 'fibestation-controller-report',
        version: 1,
        app: APP_VERSION,
        browser: navigator.userAgent,
        created: new Date().toISOString(),
        device: name,
        ports: this.hub.ports,
        steps: LEARN_STEPS.map((step) => ({
          id: step.id,
          label: step.label,
          target: step.target,
          usedByTheApp: step.used,
          messages: (this.recorded.get(step.id) ?? []).map(hex),
          learned: learn?.learned[step.id] ?? null,
        })),
        profile: controls.length > 0 ? learnedProfile(name, name, controls, true) : null,
      },
      null,
      2,
    );
  }

  dispose(): void {
    clearTimeout(this.frame);
    clearTimeout(this.learnTimer);
    clearInterval(this.lightTimer);
    for (const cleanup of this.cleanups) cleanup();
    this.hub.stop();
  }

  private handle(event: ControlEvent): void {
    // While the dialog teaches a controller, its controls do nothing.
    if (this.current.learn) return;
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
    } else if (event.control === 'cue') {
      this.cue(event.pressed);
    } else if (event.pressed) {
      if (event.control === 'play') this.play();
      else if (event.control === 'pad' && event.padMode === 'hotcue' && event.index) {
        this.pad(event.index - 1, event.shift);
      }
    }
  }

  private play(): void {
    // PLAY while CUE is held: the music plays on when CUE is let go, as on a CDJ.
    if (this.previewing) {
      this.previewing = false;
      return;
    }
    void this.player.toggle();
  }

  /**
   * CUE as on a CDJ, with the in marker as the cue point: while playing, back to it and pause;
   * paused elsewhere, the cue point moves to the playhead (the in marker, on the beat with Q);
   * paused at it, the music plays while CUE is held and goes back to it when CUE is let go.
   */
  private cue(pressed: boolean): void {
    if (!pressed) {
      if (!this.previewing) return;
      this.previewing = false;
      void this.player.stop();
      return;
    }
    const track = this.player.currentTrack;
    if (!track || this.player.live) return;
    if (this.player.state.playing) {
      void this.player.stop();
      return;
    }
    const position = this.player.position;
    if (Math.abs(position - (track.marks.in ?? 0)) < AT_CUE) {
      this.previewing = true;
      void this.player.play();
      return;
    }
    this.player.mark('in', position);
    // The playhead goes to the marker, which may have snapped to the beat.
    const marked = this.player.currentTrack?.marks.in ?? null;
    if (marked !== null && Math.abs(marked - position) > 1e-3) void this.player.seek(marked);
    this.showLights(this.player.state);
  }

  /** Like the keys 1–8: set where empty, jump where set; with SHIFT, delete. */
  private pad(index: number, shift: boolean): void {
    if (shift) {
      this.player.setCue(index, null);
      return;
    }
    // Just after the jog wheel moved, the playhead is where the jog wheel took it, even
    // before the engine is there.
    void this.player.cue(index);
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

  /** The jog wheel scrubs: the playhead follows it at once, the engine a little later. */
  private jog(delta: number, shift: boolean): void {
    if (!this.player.currentTrack || delta === 0 || this.player.live) return;
    const step = JOG_SECONDS * (shift ? JOG_SHIFT_FACTOR : 1);
    this.player.scrub(this.player.position + delta * step);
  }

  private showLights(state: AppState): void {
    const track = state.tracks.find((entry) => entry.id === state.currentId);
    const live = state.live.status === 'on';
    const play = state.playing ? 'on' : track && !live ? 'blink' : 'off';
    this.hub.setLight({ control: 'play', deck: 1 }, play);
    let cue: 'on' | 'off' | 'blink' = 'off';
    if (this.previewing) cue = 'on';
    else if (track && !live && !state.playing) {
      const position = this.player.position;
      cue = Math.abs(position - (track.marks.in ?? 0)) < AT_CUE ? 'on' : 'blink';
    }
    this.hub.setLight({ control: 'cue', deck: 1 }, cue);
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

  private setProfiles(profiles: ControllerProfile[]): void {
    try {
      localStorage.setItem(PROFILES_KEY, JSON.stringify({ profiles }));
    } catch {
      // Storage full or blocked: the profiles work until the page is closed.
    }
    this.update({ profiles });
    this.hub.setProfiles([...profiles, ...PROFILES]);
  }

  /** A message of the device MIDI learn listens to, for the step listening. */
  private record(deviceId: string, data: Uint8Array): void {
    const learn = this.current.learn;
    const stepId = learn?.listening;
    if (!learn || !stepId || deviceId !== learn.deviceId) return;
    // Clock and active sensing (system messages) say nothing about a control.
    if ((data[0] ?? 0) >= 0xf0) return;
    const messages = this.recorded.get(stepId) ?? [];
    if (messages.length < LEARN_MESSAGES) messages.push([...data]);
    this.recorded.set(stepId, messages);
    this.update({ learn: { ...learn, counts: { ...learn.counts, [stepId]: messages.length } } });
    const step = LEARN_STEPS.find((entry) => entry.id === stepId);
    clearTimeout(this.learnTimer);
    this.learnTimer = setTimeout(
      () => this.finishStep(),
      step?.target.kind === 'button' ? LEARN_QUIET_MS.button : LEARN_QUIET_MS.moving,
    );
  }

  /** The step listening learns from what it heard; one that heard nothing stays as it was. */
  private finishStep(): void {
    const learn = this.current.learn;
    const stepId = learn?.listening;
    if (!learn || !stepId) return;
    const step = LEARN_STEPS.find((entry) => entry.id === stepId)!;
    const messages = this.recorded.get(stepId) ?? [];
    const learned = { ...learn.learned };
    if (messages.length > 0) learned[stepId] = learnBinding(step.target, messages);
    this.update({ learn: { ...learn, listening: null, learned } });
  }

  private update(changes: Partial<ControllerState>): void {
    this.current = { ...this.current, ...changes };
    for (const listener of this.listeners) listener(this.current);
  }
}

/** Whether a binding is of the control a step of MIDI learn asks for. */
function sameTarget(
  binding: ControlBinding,
  target: (typeof LEARN_STEPS)[number]['target'],
): boolean {
  if (binding.kind !== target.kind || binding.control !== target.control) return false;
  if ((binding.deck ?? null) !== (target.deck ?? null)) return false;
  if (binding.kind !== 'button' || target.kind !== 'button') return true;
  return (binding.index ?? null) === (target.index ?? null) && !!binding.shift === !!target.shift;
}
