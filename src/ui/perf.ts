/**
 * Performance diagnostics, on with `?perf` in the address (off otherwise, at no cost): how long
 * the frames of the page take to come, how long each live part of the UI takes per frame, how
 * evenly the playhead moves on, the long animation frames and the scripts in them, the memory
 * of the page, and the frame rate of the visuals. The perf workflow reads them in CI
 * (tests/perf), through `window.__perf`.
 */

/** True when the page was opened with `?perf`. */
export const perfEnabled =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf');

/** Samples kept per measurement: a minute at 60 frames a second. */
const KEEP = 3600;
/** A frame that took more than this many times the usual is counted as dropped. */
const DROPPED = 1.5;
/** A playhead move further than this from the usual is a jump (a seek), not unevenness. */
const JUMP_SECONDS = 0.25;

/** Spread of a list of numbers: percentiles and the maximum. */
export interface Spread {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** How evenly a position moved on from frame to frame: off from the time that passed (ms). */
export interface Evenness {
  frames: number;
  /** Standard deviation. */
  sd: number;
  max: number;
}

export interface PerfSnapshot {
  /** Seconds since the measurement began. */
  seconds: number;
  /** Time between the frames of the page (ms), and how many took too long. */
  frames: Spread & { dropped: number };
  /** Time the live parts of the UI took per frame (ms), together and each. */
  work: Spread;
  parts: Record<string, Spread>;
  /** How evenly the playhead moved on: as shown, and as the engine publishes it. */
  playhead: { shown: Evenness; published: Evenness } | null;
  /** Long animation frames (Chromium), or long tasks elsewhere, and the scripts in them. */
  longFrames: { count: number; totalMs: number; worstMs: number; scripts: Record<string, number> };
  /** Memory of the page's JavaScript (MB), where the browser tells it. */
  heapMB: number | null;
  /** Frames a second of the visuals, as their worker reports it. */
  visualsFps: number | null;
}

/** The value at share `q` (0…1) of the sorted list. */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

export function spread(values: readonly number[]): Spread {
  const sorted = [...values].sort((a, b) => a - b);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    count: sorted.length,
    p50: round(quantile(sorted, 0.5)),
    p95: round(quantile(sorted, 0.95)),
    p99: round(quantile(sorted, 0.99)),
    max: round(sorted.at(-1) ?? 0),
  };
}

/**
 * How evenly `positions` (seconds) moved on at `times` (ms): each frame's move against the time
 * that passed times the usual speed (the median), leaving out frames that stood still and jumps.
 */
export function evenness(times: readonly number[], positions: readonly number[]): Evenness {
  const steps: [number, number][] = [];
  for (let i = 1; i < times.length; i++) {
    const elapsed = (times[i]! - times[i - 1]!) / 1000;
    const moved = positions[i]! - positions[i - 1]!;
    if (elapsed > 0 && moved > 0) steps.push([elapsed, moved]);
  }
  const speeds = steps.map(([elapsed, moved]) => moved / elapsed).sort((a, b) => a - b);
  const speed = quantile(speeds, 0.5);
  const errors = steps
    .map(([elapsed, moved]) => moved - elapsed * speed)
    .filter((error) => Math.abs(error) < JUMP_SECONDS);
  if (errors.length === 0) return { frames: 0, sd: 0, max: 0 };
  const mean = errors.reduce((sum, error) => sum + error, 0) / errors.length;
  const sd = Math.sqrt(errors.reduce((sum, error) => sum + (error - mean) ** 2, 0) / errors.length);
  const round = (seconds: number) => Math.round(seconds * 1e6) / 1000;
  return {
    frames: errors.length,
    sd: round(sd),
    max: round(Math.max(...errors.map(Math.abs))),
  };
}

/** Keeps the last {@link KEEP} values. */
class Samples {
  readonly values: number[] = [];
  push(value: number): void {
    this.values.push(value);
    if (this.values.length > KEEP) this.values.splice(0, this.values.length - KEEP);
  }
}

/** Collects what {@link PerfSnapshot} reports; see {@link perfEnabled}. */
export class PerfRecorder {
  private start = performance.now();
  private lastFrame: number | null = null;
  private frameWork = 0;
  private readonly intervals = new Samples();
  private readonly work = new Samples();
  private readonly parts = new Map<string, Samples>();
  private readonly playheadTimes = new Samples();
  private readonly shown = new Samples();
  private readonly published = new Samples();
  private longCount = 0;
  private longTotal = 0;
  private longWorst = 0;
  private scripts = new Map<string, number>();

  constructor() {
    this.observeLongFrames();
  }

  /** Starts a new measurement. */
  reset(): void {
    this.start = performance.now();
    this.lastFrame = null;
    for (const samples of [
      this.intervals,
      this.work,
      this.playheadTimes,
      this.shown,
      this.published,
    ]) {
      samples.values.length = 0;
    }
    this.parts.clear();
    this.longCount = 0;
    this.longTotal = 0;
    this.longWorst = 0;
    this.scripts = new Map();
  }

  /** A frame of the page begins, at `now` (its time). */
  frame(now: number): void {
    if (this.lastFrame !== null) {
      this.intervals.push(now - this.lastFrame);
      this.work.push(this.frameWork);
    }
    this.lastFrame = now;
    this.frameWork = 0;
  }

  /** Part `label` took `ms` in this frame. */
  part(label: string, ms: number): void {
    this.frameWork += ms;
    let samples = this.parts.get(label);
    if (!samples) this.parts.set(label, (samples = new Samples()));
    samples.push(ms);
  }

  /** The playhead at the frame's time `now`: as shown, and as the engine published it. */
  playhead(now: number, shown: number, published: number): void {
    this.playheadTimes.push(now);
    this.shown.push(shown);
    this.published.push(published);
  }

  /**
   * What was measured since the last {@link reset}; with `last`, the frame by frame measurements
   * (frames, work, parts, playhead) of the last `last` frames only (the long frames stay since the
   * reset).
   */
  snapshot(last?: number): PerfSnapshot {
    const recent = (values: number[]) => (last === undefined ? values : values.slice(-last));
    const intervals = recent(this.intervals.values);
    const usual = quantile(
      [...intervals].sort((a, b) => a - b),
      0.5,
    );
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const fps = document.querySelector<HTMLElement>('[data-testid="visual-stage"]')?.dataset['fps'];
    return {
      seconds: Math.round(performance.now() - this.start) / 1000,
      frames: {
        ...spread(intervals),
        dropped: intervals.filter((interval) => interval > DROPPED * usual).length,
      },
      work: spread(recent(this.work.values)),
      parts: Object.fromEntries(
        [...this.parts].map(([label, samples]) => [label, spread(recent(samples.values))]),
      ),
      playhead: this.playheadEvenness(last),
      longFrames: {
        count: this.longCount,
        totalMs: Math.round(this.longTotal),
        worstMs: Math.round(this.longWorst),
        scripts: Object.fromEntries(
          [...this.scripts]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([source, ms]) => [source, Math.round(ms)]),
        ),
      },
      heapMB: memory ? Math.round((memory.usedJSHeapSize / 2 ** 20) * 10) / 10 : null,
      visualsFps: fps === undefined ? null : Number(fps),
    };
  }

  /** The time between the last `count` frames (ms), oldest first. */
  recentFrames(count: number): number[] {
    return this.intervals.values.slice(-count);
  }

  /**
   * How evenly the playhead moved on (over the last `last` frames, if given), or null when it did
   * not move (nothing played).
   */
  private playheadEvenness(last?: number): PerfSnapshot['playhead'] {
    const recent = (values: number[]) => (last === undefined ? values : values.slice(-last));
    const times = recent(this.playheadTimes.values);
    const shown = evenness(times, recent(this.shown.values));
    if (shown.frames === 0) return null;
    return { shown, published: evenness(times, recent(this.published.values)) };
  }

  /** Long animation frames where the browser reports them (with their scripts), else long tasks. */
  private observeLongFrames(): void {
    const supported = PerformanceObserver.supportedEntryTypes ?? [];
    const type = supported.includes('long-animation-frame')
      ? 'long-animation-frame'
      : supported.includes('longtask')
        ? 'longtask'
        : null;
    if (!type) return;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        this.longCount++;
        this.longTotal += entry.duration;
        this.longWorst = Math.max(this.longWorst, entry.duration);
        const scripts = (entry as PerformanceEntry & { scripts?: ScriptTiming[] }).scripts ?? [];
        for (const script of scripts) {
          const file = script.sourceURL.split('/').pop()?.split('?')[0];
          const where = file ? ` ${file}:${script.sourceCharPosition}` : '';
          const name = script.sourceFunctionName ? ` ${script.sourceFunctionName}` : '';
          const source = `${script.invoker || script.name}${name}${where}`;
          this.scripts.set(source, (this.scripts.get(source) ?? 0) + script.duration);
        }
      }
    }).observe({ type, buffered: false });
  }
}

/** What a long animation frame says of a script in it. */
interface ScriptTiming {
  name: string;
  invoker: string;
  sourceFunctionName: string;
  sourceURL: string;
  sourceCharPosition: number;
  duration: number;
}

/** The recorder, with `?perf`; null otherwise. */
export const perf: PerfRecorder | null = perfEnabled ? new PerfRecorder() : null;

if (perf) {
  (window as Window & { __perf?: PerfRecorder }).__perf = perf;
}
