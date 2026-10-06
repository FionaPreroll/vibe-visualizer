/** Weight of each new measurement in the averaged lead: about a third of a second at 60 Hz. */
const LEAD_SMOOTHING = 0.05;
/** A lead further than this from the average starts it anew (the audio paused or jumped). */
const LEAD_RESET_SECONDS = 0.25;

/**
 * Turns the playback position the worklet publishes once per audio callback (every 5–20 ms,
 * depending on the system) into one that moves on smoothly from frame to frame of the screen,
 * for what moves with the music there (the playhead, the detail waveform).
 *
 * The published position plays at context time `renderTime`; it is carried on to now at the
 * speed the music plays, along a steady clock (performance.now() in seconds). How far the audio
 * clock runs ahead of that clock grows and shrinks with the callbacks: averaged, the steps even
 * out, so the smooth position is the published one on average, and the playhead stays where
 * cues and markers are set. The average also follows the two clocks drifting apart.
 */
export class PositionSmoother {
  /** The averaged lead of the audio clock over the steady one (seconds), or null. */
  private lead: number | null = null;

  /**
   * The position to show, in seconds: `position` (seconds) plays at context time `renderTime`
   * and moves on at `rate` seconds per second (0 while it stands still); the steady clock is at
   * `clock` seconds now.
   */
  at(position: number, rate: number, renderTime: number, clock: number): number {
    if (rate === 0) {
      this.lead = null;
      return position;
    }
    const lead = renderTime - clock;
    this.lead =
      this.lead === null || Math.abs(lead - this.lead) > LEAD_RESET_SECONDS
        ? lead
        : this.lead + (lead - this.lead) * LEAD_SMOOTHING;
    return position + (clock + this.lead - renderTime) * rate;
  }
}
