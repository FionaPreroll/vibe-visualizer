import { describe, expect, it } from 'vitest';
import type { ExportState, RunningExport } from '../core/export/exporter';
import { windowTitle } from './window-title';

function running(changes: Partial<RunningExport> = {}): ExportState {
  return {
    status: 'running',
    job: {
      fileName: 'Clicks.mp4',
      format: { width: 1280, height: 720, fps: 30 } as RunningExport['format'],
      duration: 60,
      phase: 'video',
      progress: 0.427,
      speed: 1,
      remaining: 30,
      preview: null,
      paused: false,
      batch: null,
      ...changes,
    },
  };
}

describe('the window title', () => {
  it('is the app name without an export', () => {
    expect(windowTitle('FibeStation', { status: 'idle' }, null)).toBe('FibeStation');
  });

  it('shows the progress of a running export, paused or of a batch', () => {
    expect(windowTitle('FibeStation', running(), null)).toBe('42 % · FibeStation');
    expect(windowTitle('FibeStation', running({ paused: true }), null)).toBe(
      'Paused 42 % · FibeStation',
    );
    expect(windowTitle('FibeStation', running({ batch: { index: 1, count: 3 } }), null)).toBe(
      '2/3 · 42 % · FibeStation',
    );
  });

  it('says how an export ended until the tab is seen', () => {
    const failed: ExportState = { status: 'failed', message: 'x', resumable: false, videos: [] };
    expect(windowTitle('FibeStation', failed, 'failed')).toBe('Export failed · FibeStation');
    expect(windowTitle('FibeStation', failed, null)).toBe('FibeStation');
    expect(windowTitle('FibeStation', { status: 'idle' }, 'done')).toBe('Ready · FibeStation');
  });
});
