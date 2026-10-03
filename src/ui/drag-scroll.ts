/**
 * Scrolls a list while an entry of it is dragged near its top or bottom edge (PL-03), so an entry
 * can be moved far in one go: the closer to the edge, the faster. Browsers send `dragover` at
 * least every 350 ms or so while the pointer rests, which keeps it going; when they stop (the
 * drag left the list), so does the scrolling.
 */

/** The strip along each edge where the list scrolls, in pixels. */
export const EDGE = 48;
/** Pixels per second at the very edge, and beyond it. */
export const MAX_SPEED = 900;
/** Without a `dragover` for this long (ms), the drag is somewhere else. */
const QUIET_MS = 600;

/**
 * The speed (pixels per second; negative: up) for the pointer at `y` over a list from `top` to
 * `bottom` (client pixels): 0 in the middle, growing over the strip along an edge.
 */
export function edgeSpeed(y: number, top: number, bottom: number): number {
  const edge = Math.min(EDGE, (bottom - top) / 3);
  if (edge <= 0) return 0;
  if (y < top + edge) return -MAX_SPEED * Math.min(1, (top + edge - y) / edge);
  if (y > bottom - edge) return MAX_SPEED * Math.min(1, (y - (bottom - edge)) / edge);
  return 0;
}

export class DragScroll {
  private speed = 0;
  private carry = 0;
  private frame = 0;
  private lastFrame = 0;
  private lastOver = 0;

  constructor(private readonly list: HTMLElement) {}

  /** The pointer of the drag is at `clientY`. */
  over(clientY: number): void {
    const rect = this.list.getBoundingClientRect();
    this.speed = edgeSpeed(clientY, rect.top, rect.bottom);
    this.lastOver = performance.now();
    if (this.speed !== 0 && this.frame === 0) {
      this.lastFrame = this.lastOver;
      this.frame = requestAnimationFrame(this.step);
    }
  }

  /** The drag ended. */
  stop(): void {
    this.speed = 0;
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private readonly step = (now: number): void => {
    this.frame = 0;
    if (this.speed === 0 || now - this.lastOver > QUIET_MS) return;
    // A frame's step is at most a tenth of a second, also after a pause of the tab.
    const dt = Math.min(0.1, Math.max(0, now - this.lastFrame) / 1000);
    this.lastFrame = now;
    // Whole pixels: browsers may drop the fraction of a slow step.
    this.carry += this.speed * dt;
    const pixels = Math.trunc(this.carry);
    this.carry -= pixels;
    if (pixels !== 0) this.list.scrollTop += pixels;
    this.frame = requestAnimationFrame(this.step);
  };
}
