/**
 * Pickup for knobs and faders ("soft takeover"): a control whose position differs from the
 * value in the app does nothing until it reaches that value. So the value does not jump when a
 * control is first moved, or after the value was changed in the app by other means.
 */
export class SoftTakeover {
  private readonly controls = new Map<string, { position: number; taken: number | null }>();

  /** `tolerance`: how close a position must come to the value to take it over (0–1). */
  constructor(private readonly tolerance = 0.03) {}

  /** Whether the new `position` of control `key` should set the app's `value` (both 0–1). */
  accept(key: string, position: number, value: number): boolean {
    const last = this.controls.get(key);
    // The app still has what this control set last: the control keeps the value in hand.
    const held = last?.taken != null && Math.abs(value - last.taken) <= this.tolerance;
    const near = Math.abs(position - value) <= this.tolerance;
    const crossed = last !== undefined && (last.position - value) * (position - value) <= 0;
    const accepted = held || near || crossed;
    this.controls.set(key, { position, taken: accepted ? position : (last?.taken ?? null) });
    return accepted;
  }

  /** Forgets every control, e.g. when a controller connects again. */
  reset(): void {
    this.controls.clear();
  }
}
