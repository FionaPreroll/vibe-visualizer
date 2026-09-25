<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { errorMessage, formatBytes, formatDuration, formatMs } from '../../core/util/format';
  import { WorkerClient } from '../../core/util/worker-rpc';
  import { quickMode } from '../quick';
  import { SpikeRun } from '../report.svelte';
  import SpikeCard from '../ui/SpikeCard.svelte';
  import type { JobParams, Manifest, Progress, ValidationResult } from './long-render.worker';
  import LongRenderWorker from './long-render.worker.ts?worker';

  const DURATIONS = quickMode
    ? [{ label: '1 minute (test)', seconds: 60 }]
    : [
        { label: '10 minutes', seconds: 600 },
        { label: '1 hour', seconds: 3600 },
        { label: '3 hours', seconds: 3 * 3600 },
      ];

  let client: WorkerClient | null = null;
  let spike: SpikeRun | null = null;
  let manifest = $state<Manifest | null>(null);
  let running = $state(false);
  let progress = $state('');
  let duration = $state(DURATIONS[DURATIONS.length - 1]!.seconds);
  let final = $state<{ url: string | null; bytes: number } | null>(null);
  let wakeLock: WakeLockSentinel | null = null;
  let killedByUser = false;
  const canSaveToDisk = 'showSaveFilePicker' in globalThis;

  const segmentsTotal = $derived(
    manifest ? Math.ceil(manifest.params.durationSeconds / manifest.params.segmentSeconds) : 0,
  );
  const unfinished = $derived(
    !!manifest && (!manifest.audioDone || manifest.segmentsDone.length < segmentsTotal),
  );
  const readyToJoin = $derived(!!manifest && !unfinished && !manifest.finalized);

  function worker(): WorkerClient {
    client ??= new WorkerClient(new LongRenderWorker());
    return client;
  }

  onMount(() => {
    worker()
      .call<Manifest | null>('status')
      .then((m) => (manifest = m))
      .catch(() => undefined);
  });

  onDestroy(() => {
    client?.terminate();
    if (final?.url) URL.revokeObjectURL(final.url);
  });

  function onProgress(update: Progress) {
    if (update.phase === 'audio') {
      progress = `Audio: ${formatDuration(update.done / 48000)} of ${formatDuration(update.total / 48000)}`;
    } else if (update.phase === 'video') {
      progress = `Video: segment ${update.segment + 1}/${update.segments} · ${formatDuration(update.frames / (manifest?.params.fps ?? 2))} rendered · ${update.fps.toFixed(0)} fps`;
    } else {
      progress = `Joining: segment ${update.done}/${update.total}`;
    }
  }

  async function withWakeLock<T>(task: () => Promise<T>): Promise<T> {
    wakeLock = await navigator.wakeLock?.request('screen').catch(() => null);
    try {
      return await task();
    } finally {
      await wakeLock?.release().catch(() => undefined);
      wakeLock = null;
    }
  }

  async function render(method: 'start' | 'resume', args?: JobParams) {
    running = true;
    killedByUser = false;
    const run = spike!;
    const started = performance.now();
    try {
      manifest = await withWakeLock(() => worker().call<Manifest>(method, args, { onProgress }));
      run.log(`All segments rendered in ${formatMs(performance.now() - started)}`);
      run.check(
        'Segments written',
        true,
        `${manifest.segmentsDone.length} segments, ${manifest.videoCodec} + ${manifest.audioCodec}`,
      );
      progress = 'Render complete. Join the segments into the final file.';
    } catch (error) {
      if (killedByUser) run.log('Render worker killed (simulated crash)');
      else run.fail(errorMessage(error));
    } finally {
      running = false;
    }
  }

  async function start() {
    spike = new SpikeRun('S5');
    final = null;
    const params: JobParams = {
      durationSeconds: duration,
      segmentSeconds: quickMode ? 20 : 600,
      fps: 2,
      width: 640,
      height: 360,
      frameDelayMs: quickMode ? 20 : 0,
    };
    spike.log(
      `Starting a ${formatDuration(duration)} render (${params.width}×${params.height}, ${params.fps} fps)`,
    );
    await render('start', params);
  }

  async function resume() {
    spike ??= new SpikeRun('S5');
    spike.log('Resuming the unfinished render…');
    await render('resume');
  }

  function simulateCrash() {
    killedByUser = true;
    client?.terminate();
    client = null;
    // Re-read the manifest with a fresh worker: it shows what survived the crash.
    worker()
      .call<Manifest | null>('status')
      .then((m) => (manifest = m));
  }

  async function join(toDisk: boolean) {
    spike ??= new SpikeRun('S5');
    const run = spike;
    let target: 'opfs' | FileSystemFileHandle = 'opfs';
    if (toDisk) {
      const picker = (
        globalThis as unknown as {
          showSaveFilePicker: (options: object) => Promise<FileSystemFileHandle>;
        }
      ).showSaveFilePicker;
      try {
        target = await picker({
          suggestedName: 'vibe-visualizer-long-render-test.mp4',
          types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }],
        });
      } catch {
        return; // dialog cancelled
      }
    }
    running = true;
    try {
      const result = await withWakeLock(() =>
        worker().call<ValidationResult>('join', { target }, { onProgress }),
      );
      const expected = manifest!.params.durationSeconds;
      run.metric(
        'Final file',
        `${formatBytes(result.bytes)}, joined in ${formatMs(result.joinMs)}`,
      );
      run.check(
        'Valid output file',
        Math.abs(result.duration - expected) < 1 && Math.abs(result.audioDuration - expected) < 1,
        `${formatDuration(result.duration)} (audio ${result.audioDuration.toFixed(2)} s, expected ${expected} s)`,
      );
      run.check(
        'Segments joined without re-encoding',
        result.videoPackets === result.expectedFrames,
        `${result.videoPackets} of ${result.expectedFrames} video frames copied`,
      );
      const resumed = (manifest?.resumeCount ?? 0) > 0;
      run.check(
        'Resumes after the tab was killed',
        resumed ? true : null,
        resumed
          ? `resumed ${manifest!.resumeCount}× and completed`
          : 'not tested: reload the page (or click “Simulate crash”) during a render, then resume',
      );
      if (target === 'opfs') {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('s5-long-render');
        const file = await (await dir.getFileHandle('final.mp4')).getFile();
        final = { url: URL.createObjectURL(file), bytes: file.size };
      } else {
        final = { url: null, bytes: result.bytes };
      }
      manifest = await worker().call<Manifest | null>('status');
      progress = 'Done.';
      run.done();
    } catch (error) {
      run.fail(errorMessage(error));
    } finally {
      running = false;
    }
  }

  async function clearFiles() {
    await worker().call('clear');
    manifest = null;
    if (final?.url) URL.revokeObjectURL(final.url);
    final = null;
    progress = 'Test files deleted.';
  }
</script>

<SpikeCard
  id="S5"
  title="Long render"
  question="Does a multi-hour export survive interruptions and end up as one valid file?"
  criteria={[
    'Valid output file (duration and frame count match)',
    'Resumes after the tab was killed',
    'Segments joined without re-encoding',
  ]}
>
  <div class="row">
    <label>
      Length
      <select bind:value={duration} disabled={running}>
        {#each DURATIONS as option (option.seconds)}
          <option value={option.seconds}>{option.label}</option>
        {/each}
      </select>
    </label>
    <button class="primary" onclick={start} disabled={running} data-testid="s5-start">
      Start render
    </button>
    <button onclick={simulateCrash} disabled={!running} data-testid="s5-crash">
      Simulate crash
    </button>
    <button onclick={resume} disabled={running || !unfinished} data-testid="s5-resume">
      Resume
    </button>
  </div>
  <div class="row">
    {#if canSaveToDisk}
      <button onclick={() => join(true)} disabled={running || !readyToJoin} data-testid="s5-save">
        Save final MP4…
      </button>
    {/if}
    <button onclick={() => join(false)} disabled={running || !readyToJoin} data-testid="s5-join">
      Finalize in browser storage
    </button>
    <button onclick={clearFiles} disabled={running}>Delete test files</button>
  </div>
  <p class="progress" data-testid="s5-progress">
    {#if progress}
      {progress}
    {:else if manifest && unfinished}
      Unfinished render found ({manifest.segmentsDone.length}/{segmentsTotal} segments). Click Resume.
    {:else}
      Renders a synthetic video (640×360, 2 fps) with a continuous audio track. Try reloading the
      page mid-render, then resume.
    {/if}
  </p>
  {#if final?.url}
    <a href={final.url} download="vibe-visualizer-long-render-test.mp4">
      Download final file ({formatBytes(final.bytes)})
    </a>
  {/if}
</SpikeCard>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  label {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .progress {
    margin: 0;
    color: var(--muted);
    font-size: 14px;
    font-family: var(--mono);
  }
</style>
