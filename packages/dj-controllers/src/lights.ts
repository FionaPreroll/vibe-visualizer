import { dataBytes } from './decoder';
import type { ControllerProfile, LightBinding, LightState, LightTarget } from './types';

/** How often blinking lights change, in ms. */
export const BLINK_MS = 400;

interface Light {
  status: number;
  data: number;
  binding: LightBinding;
}

/**
 * The lights of one controller: states in, MIDI messages out. Only changes are sent, and all
 * blinking lights share one timer, so they blink together.
 */
export class Lights {
  private readonly lights = new Map<string, Light>();
  private readonly states = new Map<Light, LightState>();
  /** The velocity each light was sent last, by status and data byte. */
  private readonly sent = new Map<number, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private phase = true;

  constructor(
    profile: ControllerProfile,
    private readonly send: (message: number[]) => void,
  ) {
    for (const binding of profile.lights ?? []) {
      for (const { byte, index } of dataBytes(binding.data)) {
        const target: LightTarget = {
          control: binding.control,
          deck: binding.deck ?? null,
          ...(index !== undefined ? { index } : {}),
          ...(binding.padMode ? { padMode: binding.padMode } : {}),
          ...(binding.shift ? { shift: true } : {}),
        };
        this.lights.set(lightKey(target), { status: binding.status, data: byte, binding });
      }
    }
  }

  /** Whether the controller has this light. */
  has(target: LightTarget): boolean {
    return this.lights.has(lightKey(target));
  }

  set(target: LightTarget, state: LightState): void {
    const light = this.lights.get(lightKey(target));
    if (!light) return;
    if (state === 'off') this.states.delete(light);
    else this.states.set(light, state);
    this.show(light, false);
    this.updateTimer();
  }

  /** Every light off, also the ones that were never set (a controller may start lit). */
  clear(): void {
    this.states.clear();
    for (const light of this.lights.values()) this.show(light, true);
    this.updateTimer();
  }

  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private show(light: Light, always: boolean): void {
    const state = this.states.get(light) ?? 'off';
    const { on = 0x7f, off = 0, dim = off } = light.binding;
    const lit = state === 'on' || (state === 'blink' && this.phase);
    const value = lit ? on : state === 'dim' ? dim : off;
    const at = (light.status << 8) | light.data;
    if (!always && this.sent.get(at) === value) return;
    this.sent.set(at, value);
    this.send([light.status, light.data, value]);
  }

  private updateTimer(): void {
    const blinking = [...this.states.values()].includes('blink');
    if (blinking && this.timer === null) {
      this.phase = true;
      this.timer = setInterval(() => {
        this.phase = !this.phase;
        for (const [light, state] of this.states) if (state === 'blink') this.show(light, false);
      }, BLINK_MS);
    } else if (!blinking && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/** One key per light: what it belongs to. */
export function lightKey(target: LightTarget): string {
  const { control, deck, index, padMode, shift } = target;
  return [control, deck ?? '', index ?? '', padMode ?? '', shift ? 'shift' : ''].join('/');
}
