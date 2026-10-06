import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Turns the results of tests/perf (a directory of `<label>-r<round>-<scenario>.json`) into a
 * Markdown report: per scenario the median over the rounds (those without a trace, where there
 * are such: tracing slows the page down), and with a base and a head (the Perf workflow), the
 * change from one to the other. A change for the worse by more than a quarter, and by more than
 * a small amount, is marked; nothing fails, as a runner's speed varies. Run it with
 * `pnpm perf:report [directory]`.
 */

interface Spread {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

interface Snapshot {
  seconds: number;
  frames: Spread & { dropped: number };
  work: Spread;
  parts: Record<string, Spread>;
  playhead: { shown: { sd: number }; published: { sd: number } } | null;
  longFrames: { count: number; totalMs: number; worstMs: number; scripts: Record<string, number> };
  heapMB: number | null;
  visualsFps: number | null;
}

interface Result {
  scenario: string;
  label: string;
  round: number;
  /** Measured while tracing, which slows the page down. */
  traced?: boolean;
  wallSeconds: number;
  extra: Record<string, number>;
  snapshot: Snapshot | null;
}

interface Metric {
  title: string;
  get(result: Result): number | null | undefined;
  /** Which way is better. */
  better: 'lower' | 'higher';
  /** A change smaller than this is noise, whatever its share. */
  floor: number;
  digits: number;
}

/** Per ten seconds of the measurement. */
const per10s = (count: number | undefined, result: Result) =>
  count === undefined || !result.snapshot ? null : (count / result.snapshot.seconds) * 10;

const METRICS: Metric[] = [
  {
    title: 'Frame interval p50 (ms)',
    get: (r) => r.snapshot?.frames.p50,
    better: 'lower',
    floor: 1,
    digits: 1,
  },
  {
    title: 'Frame interval p95 (ms)',
    get: (r) => r.snapshot?.frames.p95,
    better: 'lower',
    floor: 2,
    digits: 1,
  },
  {
    title: 'Frame interval p99 (ms)',
    get: (r) => r.snapshot?.frames.p99,
    better: 'lower',
    floor: 4,
    digits: 1,
  },
  {
    title: 'Dropped frames per 10 s',
    get: (r) => per10s(r.snapshot?.frames.dropped, r),
    better: 'lower',
    floor: 2,
    digits: 1,
  },
  {
    title: 'UI work per frame p95 (ms)',
    get: (r) => r.snapshot?.work.p95,
    better: 'lower',
    floor: 0.3,
    digits: 2,
  },
  {
    title: '· detail waveform p95 (ms)',
    get: (r) => r.snapshot?.parts['detail waveform']?.p95,
    better: 'lower',
    floor: 0.2,
    digits: 2,
  },
  {
    title: '· transport p95 (ms)',
    get: (r) => r.snapshot?.parts['transport']?.p95,
    better: 'lower',
    floor: 0.2,
    digits: 2,
  },
  {
    title: 'Playhead unevenness, shown (ms)',
    get: (r) => r.snapshot?.playhead?.shown.sd,
    better: 'lower',
    floor: 0.3,
    digits: 2,
  },
  {
    title: 'Playhead unevenness, published (ms)',
    get: (r) => r.snapshot?.playhead?.published.sd,
    better: 'lower',
    floor: 1,
    digits: 2,
  },
  {
    title: 'Long frames per 10 s',
    get: (r) => per10s(r.snapshot?.longFrames.count, r),
    better: 'lower',
    floor: 1,
    digits: 1,
  },
  {
    title: 'Longest frame (ms)',
    get: (r) => r.snapshot?.longFrames.worstMs,
    better: 'lower',
    floor: 20,
    digits: 0,
  },
  { title: 'JS heap (MB)', get: (r) => r.snapshot?.heapMB, better: 'lower', floor: 5, digits: 1 },
  {
    title: 'Visuals (fps)',
    get: (r) => r.snapshot?.visualsFps,
    better: 'higher',
    floor: 2,
    digits: 0,
  },
  {
    title: 'Export time (s)',
    get: (r) => r.extra['exportSeconds'],
    better: 'lower',
    floor: 1,
    digits: 1,
  },
  {
    title: 'Export: video s per s',
    get: (r) => r.extra['videoPerSecond'],
    better: 'higher',
    floor: 0.05,
    digits: 2,
  },
];

/** Worse by more than this share is marked. */
const WORSE = 0.25;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function value(results: Result[], metric: Metric): number | null {
  return median(
    results.map((result) => metric.get(result)).filter((v): v is number => typeof v === 'number'),
  );
}

function format(value: number | null, digits: number): string {
  return value === null ? '–' : value.toFixed(digits);
}

/** The change from `base` to `head`, marked when it is clearly for the worse. */
function change(metric: Metric, base: number | null, head: number | null): string {
  if (base === null || head === null) return '';
  const difference = head - base;
  const share = base === 0 ? (difference === 0 ? 0 : Infinity) : difference / Math.abs(base);
  const worse = metric.better === 'lower' ? difference : -difference;
  const marked = worse > metric.floor && Math.abs(share) > WORSE;
  const percent = Number.isFinite(share)
    ? `${share >= 0 ? '+' : ''}${Math.round(share * 100)} %`
    : 'new';
  return marked ? `⚠️ ${percent}` : percent;
}

export function report(directory: string): string {
  const results: Result[] = readdirSync(directory)
    .filter((name) => name.endsWith('.json') && !name.endsWith('.trace.json'))
    .map((name) => JSON.parse(readFileSync(join(directory, name), 'utf8')) as Result);
  if (results.length === 0) return `No results in ${directory}.\n`;
  const labels = [...new Set(results.map((result) => result.label))].sort();
  const compare = labels.includes('base') && labels.includes('head');
  const columns = compare ? ['base', 'head'] : labels;
  const lines = [
    '## Performance',
    '',
    'Measured with `?perf` on a machine without a GPU (the visuals draw in software): compare',
    'the columns with each other, not with a real computer. Median over the rounds without a',
    'trace, where there are such: tracing slows the page down.',
    '',
  ];
  let marks = 0;
  for (const scenario of [...new Set(results.map((result) => result.scenario))].sort()) {
    const of = (label: string) => {
      const all = results.filter((r) => r.scenario === scenario && r.label === label);
      const untraced = all.filter((r) => !r.traced);
      return untraced.length > 0 ? untraced : all;
    };
    const rows = METRICS.map((metric) => {
      const values = columns.map((label) => value(of(label), metric));
      if (values.every((v) => v === null)) return null;
      const cells = values.map((v) => format(v, metric.digits));
      const delta = compare ? change(metric, values[0]!, values[1]!) : '';
      if (delta.startsWith('⚠️')) marks++;
      return `| ${metric.title} | ${cells.join(' | ')} |${compare ? ` ${delta} |` : ''}`;
    }).filter((row): row is string => row !== null);
    const header = `| ${scenario} | ${columns.join(' | ')} |${compare ? ' change |' : ''}`;
    const rule = `|---|${columns.map(() => '---:').join('|')}|${compare ? '---:|' : ''}`;
    lines.push(`### ${scenario}`, '', header, rule, ...rows, '');
    // Where the long frames of the newest build went.
    const scripts = new Map<string, number>();
    for (const result of of(columns.at(-1)!)) {
      for (const [source, ms] of Object.entries(result.snapshot?.longFrames.scripts ?? {})) {
        scripts.set(source, (scripts.get(source) ?? 0) + ms);
      }
    }
    if (scripts.size > 0) {
      lines.push(`Scripts in long frames (${columns.at(-1)}, all rounds):`, '');
      for (const [source, ms] of [...scripts].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
        lines.push(`- ${Math.round(ms)} ms: \`${source}\``);
      }
      lines.push('');
    }
  }
  if (compare) {
    lines.push(
      marks > 0
        ? `⚠️ ${marks} measurement(s) clearly worse than the base (more than ${WORSE * 100} %). Check the traces in the artifact.`
        : 'Nothing clearly worse than the base.',
      '',
    );
  }
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(report(process.argv[2] ?? 'perf-results'));
}
