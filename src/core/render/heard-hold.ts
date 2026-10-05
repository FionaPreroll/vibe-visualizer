/**
 * The file heard, held over frames that find no analysis for a moment. As the music starts, the
 * clock can put a few frames in a row just before the first analysis frame: with no file heard
 * for each of them, the cover art in the ring, the track overlay and the track's colours blinked
 * off and on. A track change never has such frames: the analysis runs on. Longer than `hold`
 * seconds without analysis (stopped, the stream gone), nothing is heard.
 */
export class HeardHold {
  private token = 0;
  private unheard = 0;

  constructor(private readonly hold = 0.5) {}

  /** The file to show this frame: the one heard when `sampled`, else the last for a moment. */
  next(sampled: boolean, token: number, dt: number): number {
    if (sampled) {
      this.token = token;
      this.unheard = 0;
      return token;
    }
    this.unheard += dt;
    if (this.unheard >= this.hold) this.token = 0;
    return this.token;
  }
}
