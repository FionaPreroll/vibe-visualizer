import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SOUND } from '../audio/dsp/sound-settings';
import { CANCELLED, type ExportManifest } from './export-job';
import type { ExportRequest } from './exporter';

/** The export worker, played by the test: each call is answered by `answer`. */
const calls: { method: string; args: Record<string, unknown> }[] = [];
let answer: (method: string, args: Record<string, unknown>) => Promise<unknown>;
let stored: ExportManifest | null = null;

vi.mock('./export.worker.ts?worker', () => ({ default: class {} }));
vi.mock('../util/worker-rpc', () => ({
  WorkerClient: class {
    call(method: string, args: Record<string, unknown>) {
      calls.push({ method, args });
      return answer(method, args);
    }
    terminate() {}
  },
}));
vi.mock('./job-store', () => ({
  clearJob: async () => undefined,
  clearShelf: async () => undefined,
  readJobFile: async () => new Blob(['video']),
  readShelfFile: async (name: string) => new Blob([name]),
  readManifest: async () => stored,
}));
vi.mock('../render/visual-assets', () => ({ decodeImage: async () => ({ close() {} }) }));
vi.stubGlobal('document', {
  addEventListener() {},
  removeEventListener() {},
  visibilityState: 'hidden',
});

const { Exporter } = await import('./exporter');

/** The request of a three-second video of the track `title`. */
function request(title: string): Omit<ExportRequest, 'destination'> {
  const source = { name: `${title}.wav`, size: 1, lastModified: 0, title, artist: null };
  return {
    parts: [
      {
        part: { source, range: { start: 0, end: 3 }, cut: false },
        file: new File([], source.name),
        grid: null,
        cover: null,
      },
    ],
    format: {
      aspect: '1:1',
      width: 720,
      height: 720,
      fps: 24,
      videoBitrate: 1e6,
      audioBitrate: 1e5,
    },
    visuals: { mode: 'kaleidoscope', settings: {} as never },
    sound: DEFAULT_SOUND,
    fade: 0,
    images: { background: null, logo: null },
    fileName: `${title}.mp4`,
  };
}

/** What the worker answers for a finished video. */
function finished(args: Record<string, unknown>, fileName = args['fileName']) {
  return {
    fileName,
    bytes: 100,
    destination: 'download',
    seconds: 1,
    chapters: [],
    output: args['output'] ?? fileName,
  };
}

/** An unfinished job in storage, as the failed video of a batch leaves it. */
function unfinished(fileName: string): ExportManifest {
  return {
    fileName,
    format: request('x').format,
    visuals: { mode: 'kaleidoscope', settings: {} as never },
    images: { background: null, logo: null, covers: [null] },
    timing: { frames: 72 },
    progress: { audioDone: true, segmentsDone: 1, finished: false, bytes: null },
  } as unknown as ExportManifest;
}

describe('batch export (EX-09)', () => {
  beforeEach(() => {
    calls.length = 0;
    stored = null;
  });

  it('makes the videos one after the other, each with a name of its own', async () => {
    const exporter = new Exporter();
    const batches: unknown[] = [];
    answer = async (method, args) => {
      if (exporter.state.status === 'running') batches.push(exporter.state.job.batch);
      return finished(args);
    };
    await exporter.startBatch([request('A'), request('B'), request('A')], null);
    expect(calls.map((call) => [call.method, call.args['fileName'], call.args['output']])).toEqual([
      ['start', 'A.mp4', 'A.mp4'],
      ['start', 'B.mp4', 'B.mp4'],
      ['start', 'A (2).mp4', 'A (2).mp4'],
    ]);
    expect(batches).toEqual([
      { index: 0, count: 3 },
      { index: 1, count: 3 },
      { index: 2, count: 3 },
    ]);
    const state = exporter.state;
    expect(state.status).toBe('done');
    if (state.status !== 'done') return;
    expect(state.planned).toBe(3);
    expect(state.videos.map((video) => video.fileName)).toEqual(['A.mp4', 'B.mp4', 'A (2).mp4']);
    expect(state.videos.every((video) => video.url?.startsWith('blob:'))).toBe(true);
  });

  it('names the videos for a folder after what is in it, and leaves the files to the worker', async () => {
    const exporter = new Exporter();
    const asked: unknown[][] = [];
    const inFolder = new Set(['A.mp4']);
    const folder = {
      async getFileHandle(...args: unknown[]) {
        asked.push(args);
        if (inFolder.has(args[0] as string)) return {};
        throw new DOMException('Not there', 'NotFoundError');
      },
    } as unknown as FileSystemDirectoryHandle;
    answer = async (method, args) => {
      inFolder.add(args['fileName'] as string);
      return { ...finished(args), destination: 'file', output: null };
    };
    await exporter.startBatch([request('A'), request('B')], folder);
    expect(
      calls.map((call) => [call.args['fileName'], call.args['folder'], call.args['output']]),
    ).toEqual([
      ['A (2).mp4', folder, null],
      ['B.mp4', folder, null],
    ]);
    // Only looked: the worker makes each file when it writes the video.
    expect(asked.every((args) => args.length === 1)).toBe(true);
    const state = exporter.state;
    expect(state.status).toBe('done');
    if (state.status !== 'done') return;
    expect(state.videos.map((video) => [video.fileName, video.url])).toEqual([
      ['A (2).mp4', null],
      ['B.mp4', null],
    ]);
  });

  it('goes on with the rest once the video that failed is resumed', async () => {
    const exporter = new Exporter();
    answer = async (method, args) => {
      if (args['fileName'] === 'B.mp4') {
        stored = unfinished('B.mp4');
        throw new Error('The encoder failed.');
      }
      return finished(args);
    };
    await exporter.startBatch([request('A'), request('B'), request('C')], null);
    const failed = exporter.state;
    expect(failed).toMatchObject({ status: 'failed', resumable: true });
    if (failed.status !== 'failed') return;
    expect(failed.videos.map((video) => video.fileName)).toEqual(['A.mp4']);

    answer = async (method, args) =>
      method === 'resume' ? finished(args, 'B.mp4') : finished(args);
    await exporter.resume([null], null);
    expect(calls.map((call) => call.method)).toEqual(['start', 'start', 'resume', 'start']);
    const done = exporter.state;
    expect(done.status).toBe('done');
    if (done.status !== 'done') return;
    expect(done.videos.map((video) => video.fileName)).toEqual(['A.mp4', 'B.mp4', 'C.mp4']);
  });

  it('keeps the videos finished before a cancel, and starts no more', async () => {
    const exporter = new Exporter();
    answer = async (method, args) => {
      if (method === 'cancel') return undefined;
      if (args['fileName'] === 'B.mp4') {
        void exporter.cancel();
        throw new Error(CANCELLED);
      }
      return finished(args);
    };
    await exporter.startBatch([request('A'), request('B'), request('C')], null);
    expect(calls.filter((call) => call.method === 'start')).toHaveLength(2);
    const state = exporter.state;
    expect(state).toMatchObject({ status: 'done', planned: 3 });
    if (state.status !== 'done') return;
    expect(state.videos.map((video) => video.fileName)).toEqual(['A.mp4']);
  });

  it('ends in nothing when the first video is cancelled', async () => {
    const exporter = new Exporter();
    answer = async (method) => {
      if (method === 'cancel') return undefined;
      void exporter.cancel();
      throw new Error(CANCELLED);
    };
    await exporter.startBatch([request('A'), request('B')], null);
    expect(exporter.state.status).toBe('idle');
  });
});
