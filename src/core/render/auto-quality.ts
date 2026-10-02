/**
 * Render scale and auto-quality (VE-07): the live visuals draw at a share of the screen's
 * resolution, and while the frame rate stays well below what this screen reached, the share
 * goes down in steps; once it has been smooth for a while, it goes up again. Exports always
 * render at their own resolution.
 */

export const RENDER_SCALE_RANGE = { min: 0.5, max: 1 } as const;
/** One step of the auto-quality. */
export const QUALITY_STEP = 0.125;
/** Measurements (seconds) before the frame rate counts: shaders compile, images decode. */
const WARM_UP = 3;
/** Seconds too slow before a step down, and smooth before a step up. */
const SLOW_SECONDS = 3;
const SMOOTH_SECONDS = 20;
/** After a step down, no step up for this long (seconds): it would only drop again. */
const HOLD_SECONDS = 60;
/** Too slow: below this, and well below the best rate of this screen (a 30 Hz one too). */
const SLOW_FPS = 50;
const SLOW_SHARE = 0.75;
/** Smooth: this close to the best rate. */
const SMOOTH_SHARE = 0.95;

export class AutoQuality {
  /** The share of the chosen resolution drawn now (the render scale multiplies it). */
  scale = 1;
  private measured = 0;
  private best = 0;
  private slow = 0;
  private smooth = 0;
  private sinceDrop = Infinity;

  /**
   * One measurement: the frames per second over the last second. Returns true when the scale
   * changed.
   */
  update(fps: number): boolean {
    this.measured++;
    this.sinceDrop++;
    if (this.measured <= WARM_UP) return false;
    this.best = Math.max(this.best, fps);
    if (fps < Math.min(SLOW_FPS, SLOW_SHARE * this.best)) {
      this.slow++;
      this.smooth = 0;
    } else if (fps >= SMOOTH_SHARE * this.best) {
      this.smooth++;
      this.slow = 0;
    } else {
      this.slow = 0;
      this.smooth = 0;
    }
    if (this.slow >= SLOW_SECONDS && this.scale > RENDER_SCALE_RANGE.min) {
      this.scale = Math.max(RENDER_SCALE_RANGE.min, this.scale - QUALITY_STEP);
      this.slow = 0;
      this.sinceDrop = 0;
      return true;
    }
    if (this.smooth >= SMOOTH_SECONDS && this.scale < 1 && this.sinceDrop >= HOLD_SECONDS) {
      this.scale = Math.min(1, this.scale + QUALITY_STEP);
      this.smooth = 0;
      return true;
    }
    return false;
  }

  /** Starts over at the full share (auto-quality switched on again). */
  reset(): void {
    this.scale = 1;
    this.measured = 0;
    this.best = 0;
    this.slow = 0;
    this.smooth = 0;
    this.sinceDrop = Infinity;
  }
}
