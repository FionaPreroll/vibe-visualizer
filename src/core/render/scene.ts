/** What the render worker needs from a scene (Logo Spectrum, Kaleidoscope, …). */

export interface SceneInput {
  /** Seconds since the scene started (drives slow animations). */
  time: number;
  /** Seconds since the previous frame. */
  dt: number;
  /** Analysis values at the moment being shown (layout F). */
  features: Float32Array;
}

export interface Scene {
  /** True when half-float render targets work (banding-free HD rendering). */
  readonly floatTargets: boolean;
  resize(width: number, height: number): void;
  render(input: SceneInput): void;
  dispose(): void;
}

/**
 * Splits real time into fixed simulation steps (the feedback of the Kaleidoscope runs at 60
 * steps per second, whatever the frame rate), and says how far the display is between the
 * last two steps.
 */
export class FixedStepper {
  readonly step: number;
  private readonly maxSteps: number;
  private pending = 0;

  constructor(stepsPerSecond: number, maxStepsPerFrame = 4) {
    this.step = 1 / stepsPerSecond;
    this.maxSteps = maxStepsPerFrame;
  }

  /** Advances by `dt` seconds; returns the number of steps to simulate now. */
  advance(dt: number): number {
    this.pending += Math.max(0, dt);
    let steps = Math.floor(this.pending / this.step + 1e-9);
    this.pending = Math.max(0, this.pending - steps * this.step);
    if (steps > this.maxSteps) {
      // Too far behind (a stall or a hidden tab): skip ahead instead of catching up.
      steps = this.maxSteps;
      this.pending = 0;
    }
    return steps;
  }

  /** 0…1: the display time's position between the previous and the latest step. */
  get blend(): number {
    return Math.min(1, Math.max(0, this.pending / this.step));
  }

  reset(): void {
    this.pending = 0;
  }
}
