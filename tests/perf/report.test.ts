import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { report } from './report';

/** A result of tests/perf with the measurements that matter here. */
function result(label: string, round: number, p95: number, sd: number, traced = false) {
  const spread = { count: 600, p50: 16.7, p95, p99: p95, max: p95 };
  return {
    scenario: 'logo-spectrum',
    label,
    round,
    traced,
    wallSeconds: 10,
    extra: {},
    snapshot: {
      seconds: 10,
      frames: { ...spread, dropped: 0 },
      work: { count: 600, p50: 0.5, p95: 0.8, p99: 1, max: 2 },
      parts: {},
      playhead: {
        shown: { frames: 600, sd, max: sd * 3 },
        published: { frames: 600, sd: 6, max: 15 },
      },
      longFrames: { count: 0, totalMs: 0, worstMs: 0, scripts: {} },
      heapMB: 30,
      visualsFps: 2,
    },
  };
}

function directory(results: ReturnType<typeof result>[]): string {
  const path = mkdtempSync(join(tmpdir(), 'perf-'));
  for (const entry of results) {
    const name = `${entry.label}-r${entry.round}-${entry.scenario}.json`;
    writeFileSync(join(path, name), JSON.stringify(entry));
  }
  return path;
}

const row = (text: string, title: string) =>
  text.split('\n').find((line) => line.startsWith(`| ${title}`));

describe('the performance report', () => {
  it('compares the head with the base, and marks what is clearly worse', () => {
    const text = report(
      directory([
        result('base', 1, 17, 0.6),
        result('base', 2, 17, 0.6),
        result('head', 1, 17, 2),
        result('head', 2, 17, 2),
      ]),
    );
    expect(row(text, 'Playhead unevenness, shown')).toBe(
      '| Playhead unevenness, shown (ms) | 0.60 | 2.00 | ⚠️ +233 % |',
    );
    expect(row(text, 'Frame interval p95')).toBe(
      '| Frame interval p95 (ms) | 17.0 | 17.0 | +0 % |',
    );
    expect(text).toContain('1 measurement(s) clearly worse than the base');
  });

  it('leaves small changes unmarked, however large their share', () => {
    const text = report(directory([result('base', 1, 17, 0.1), result('head', 1, 17, 0.3)]));
    expect(row(text, 'Playhead unevenness, shown')).toBe(
      '| Playhead unevenness, shown (ms) | 0.10 | 0.30 | +200 % |',
    );
    expect(text).toContain('Nothing clearly worse than the base.');
  });

  it('takes the rounds without a trace where there are such', () => {
    const text = report(
      directory([
        result('head', 1, 300, 0.6, true),
        result('head', 2, 17, 0.6),
        result('head', 3, 18, 0.6),
      ]),
    );
    expect(row(text, 'Frame interval p95')).toBe('| Frame interval p95 (ms) | 17.5 |');
  });
});
