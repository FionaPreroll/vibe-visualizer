import { describe, expect, it } from 'vitest';
import type { ExportState } from '../core/export/exporter';
import { ExportWatch, readyNote } from './export-watch.svelte';

const RUNNING = { status: 'running' } as ExportState;

function done(fileName: string, videos = 0): ExportState {
  return {
    status: 'done',
    fileName,
    bytes: 1,
    url: null,
    seconds: 10,
    duration: 60,
    chapters: [],
    videos: Array.from({ length: videos }, (_, k) => ({ fileName: `${k}`, bytes: 1, url: null })),
    planned: videos,
  };
}

describe('how an export ends', () => {
  it('is said in a few words for the note in the app', () => {
    expect(readyNote(1, 'Set.mp4')).toBe('Your video is ready.');
    expect(readyNote(3, 'Set.mp4')).toBe('Your videos are ready.');
    expect(readyNote(1, 'Set.wav')).toBe('Your sound is ready.');
  });

  it('is told by a notification and in the title while the tab is not seen', () => {
    const watch = new ExportWatch();
    expect(watch.follow(RUNNING, false)).toBeNull();
    expect(watch.follow(done('Set.mp4'), false)).toEqual({
      title: 'Your video is ready',
      body: 'Set.mp4',
    });
    expect(watch.unseen).toBe('done');
    watch.seen();
    expect(watch.unseen).toBeNull();

    watch.follow(RUNNING, false);
    expect(watch.follow(done('Set.wav', 4), false)).toEqual({
      title: 'Your sounds are ready',
      body: '4 sounds',
    });
    watch.follow(RUNNING, false);
    const failed: ExportState = {
      status: 'failed',
      message: 'The disk is full.',
      resumable: true,
      videos: [],
    };
    expect(watch.follow(failed, false)).toEqual({
      title: 'The export failed',
      body: 'The disk is full.',
    });
    expect(watch.unseen).toBe('failed');
  });

  it('is not told again while the tab is seen, or for an export found when the app starts', () => {
    const watch = new ExportWatch();
    watch.follow(RUNNING, true);
    expect(watch.follow(done('Set.mp4'), true)).toBeNull();
    expect(watch.unseen).toBeNull();
    // Done already when the app starts: it did not run here.
    expect(new ExportWatch().follow(done('Set.mp4'), false)).toBeNull();
  });
});
