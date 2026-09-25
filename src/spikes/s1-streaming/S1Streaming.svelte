<script lang="ts">
  import { onDestroy } from 'svelte';
  import { AudioRingMonitor, createAudioRing } from '../../core/audio/ring-buffer';
  import {
    errorMessage,
    formatBytes,
    formatDuration,
    formatMs,
    sleep,
  } from '../../core/util/format';
  import { createPrng } from '../../core/util/prng';
  import { WorkerClient } from '../../core/util/worker-rpc';
  import { measurePageMemory } from '../memory';
  import { quickMode } from '../quick';
  import { SpikeRun } from '../report.svelte';
  import SpikeCard from '../ui/SpikeCard.svelte';
  import type { DecodeBenchmarkResult, OpenResult, PlayResult } from './media.worker';
  import MediaWorker from './media.worker.ts?worker';
  import workletUrl from './ring-player.worklet.ts?worker&url';

  const CHANNELS = 2;
  const CUE_CACHE_SECONDS = 2;

  interface Engine {
    client: WorkerClient;
    monitor: AudioRingMonitor;
    sab: SharedArrayBuffer;
    info: OpenResult;
    cues: number[];
    context: AudioContext | null;
  }

  let engine = $state<Engine | null>(null);
  let spike: SpikeRun | null = null;
  let phase = $state<'idle' | 'preparing' | 'ready' | 'testing' | 'benchmarking'>('idle');
  let playing = $state(false);
  let status = $state({ position: 0, buffered: 0, underruns: 0 });
  let benchmarkProgress = $state<number | null>(null);
  let frameRequest = 0;

  function pollStatus() {
    if (engine) {
      const rate = engine.info.sampleRate;
      status = {
        position: engine.monitor.position / rate,
        buffered: engine.monitor.bufferedFrames / rate,
        underruns: engine.monitor.underruns,
      };
    }
    frameRequest = requestAnimationFrame(pollStatus);
  }

  function dispose() {
    cancelAnimationFrame(frameRequest);
    engine?.client.terminate();
    void engine?.context?.close();
    engine = null;
    playing = false;
  }

  onDestroy(dispose);

  /** Step 1 (on file selection): open the file and pre-decode the cue caches. */
  async function prepare(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    dispose();
    phase = 'preparing';
    spike = new SpikeRun('S1');
    try {
      spike.metric('File', `${file.name} (${formatBytes(file.size)})`);
      const sab = createAudioRing(CHANNELS, 96000 * 4);
      const client = new WorkerClient(new MediaWorker());
      const info = await client.call<OpenResult>('open', { file, sab, channels: CHANNELS });
      spike.metric(
        'Format',
        `${info.format}, ${info.codec}, ${info.sampleRate} Hz, ${info.channels} ch, ${formatDuration(info.duration)} (${info.durationSource})`,
      );
      spike.metric(
        'Tags',
        `${info.artist ?? '–'} · ${info.title ?? '–'} · cover ${info.hasCover ? 'yes' : 'no'}`,
      );
      spike.metric('Open', formatMs(info.openMs));
      if (info.duration < 1800) {
        spike.check('Long file (≥ 30 min)', null, 'use a 1–3 hour mix for the real test');
      }
      const cues = Array.from({ length: 8 }, (_, i) => info.duration * (0.05 + (i * 0.9) / 7));
      spike.log(`Pre-decoding ${CUE_CACHE_SECONDS} s at 8 cue points…`);
      const cache = await client.call<{ elapsedMs: number }>('cacheCues', {
        positions: cues,
        seconds: CUE_CACHE_SECONDS,
      });
      spike.metric('Cue caches', `8 × ${CUE_CACHE_SECONDS} s in ${formatMs(cache.elapsedMs)}`);
      engine = {
        client,
        monitor: new AudioRingMonitor(sab, CHANNELS),
        sab,
        info,
        cues,
        context: null,
      };
      pollStatus();
      phase = 'ready';
      spike.log('Ready. Click "Run streaming test".');
    } catch (error) {
      spike.fail(errorMessage(error));
      phase = 'idle';
    }
  }

  /** Creates the AudioContext; must run inside a click handler (autoplay rules). */
  function ensureContext(current: Engine): AudioContext {
    if (current.context) return current.context;
    const context = new AudioContext({
      sampleRate: current.info.sampleRate,
      latencyHint: 'interactive',
    });
    current.context = context;
    return context;
  }

  async function connectWorklet(current: Engine, context: AudioContext) {
    await context.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(context, 's1-ring-player', {
      numberOfInputs: 0,
      outputChannelCount: [CHANNELS],
      processorOptions: { sab: current.sab, channels: CHANNELS },
    });
    node.connect(context.destination);
  }

  /** Jumps to `seconds` and measures until the first new frame is rendered (audio clock). */
  async function jump(current: Engine, seconds: number, useCache: boolean) {
    const context = current.context!;
    const requestedAt = context.currentTime;
    const result = await current.client.call<PlayResult>('play', { seconds, useCache });
    for (let i = 0; i < 2000; i++) {
      const firstFrame = current.monitor.firstFrameTime(result.generation);
      if (firstFrame !== null) return { ...result, latencyMs: (firstFrame - requestedAt) * 1000 };
      await sleep(1);
    }
    throw new Error(`No audio 2 s after jumping to ${formatDuration(seconds)}`);
  }

  async function runTest() {
    const current = engine;
    if (!current || !spike) return;
    const run = spike;
    phase = 'testing';
    try {
      const context = ensureContext(current);
      await context.resume();
      await connectWorklet(current, context);
      run.metric(
        'Audio output',
        `${context.sampleRate} Hz, base latency ${formatMs(context.baseLatency * 1000)}, output latency ${formatMs((context.outputLatency ?? 0) * 1000)}`,
      );
      playing = true;

      const start = await jump(current, 0, false);
      run.check('Playback starts', true, `first audio after ${formatMs(start.latencyMs)}`);

      const listenSeconds = quickMode ? 2 : 8;
      run.log(`Streaming for ${listenSeconds} s…`);
      await sleep(listenSeconds * 1000);

      const cueLatencies: number[] = [];
      for (const [index, cue] of current.cues.entries()) {
        const result = await jump(current, cue, true);
        cueLatencies.push(result.latencyMs);
        run.log(
          `Cue ${index + 1} at ${formatDuration(cue)}: ${formatMs(result.latencyMs)}${result.cached ? '' : ' (not cached!)'}`,
        );
        await sleep(quickMode ? 300 : 1200);
      }
      const worstCue = Math.max(...cueLatencies);
      run.check(
        'Cue jumps under 50 ms',
        worstCue < 50,
        `worst ${formatMs(worstCue)}, average ${formatMs(cueLatencies.reduce((a, b) => a + b, 0) / cueLatencies.length)}`,
      );

      const random = createPrng(7);
      const seekLatencies: number[] = [];
      for (let i = 0; i < 4; i++) {
        const target = random() * current.info.duration * 0.95;
        const result = await jump(current, target, false);
        seekLatencies.push(result.latencyMs);
        run.log(`Seek to ${formatDuration(target)} (no cache): ${formatMs(result.latencyMs)}`);
        await sleep(quickMode ? 300 : 1200);
      }
      run.check(
        'Seeks without cache',
        null,
        `worst ${formatMs(Math.max(...seekLatencies))} (fine for normal seeking; cues use caches)`,
      );

      const underruns = current.monitor.underruns;
      run.check('No dropouts while streaming', underruns === 0, `${underruns} underruns`);

      run.log('Measuring memory (waits for the next garbage collection)…');
      const memory = await measurePageMemory(quickMode ? 3000 : 40_000);
      if (memory.kind === 'bytes') {
        run.check(
          'Memory under 300 MB',
          memory.bytes < 300 * 1024 * 1024,
          `${formatBytes(memory.bytes)} for page and workers`,
        );
      } else {
        run.check(
          'Memory under 300 MB',
          null,
          memory.kind === 'timeout'
            ? 'the browser did not answer in time; run the test again'
            : 'not measurable in this browser (Chrome only)',
        );
      }
      run.done();
      phase = 'ready';
    } catch (error) {
      run.fail(errorMessage(error));
      phase = 'ready';
    }
  }

  async function togglePlay() {
    const current = engine;
    if (!current?.context) return;
    if (playing) await current.context.suspend();
    else await current.context.resume();
    playing = !playing;
  }

  async function playCue(cue: number) {
    const current = engine;
    if (!current?.context) return;
    if (!playing) {
      await current.context.resume();
      playing = true;
    }
    await jump(current, cue, true).catch((error: unknown) => spike?.log(errorMessage(error)));
  }

  async function benchmark() {
    const current = engine;
    if (!current || !spike) return;
    const run = spike;
    phase = 'benchmarking';
    if (playing) await togglePlay();
    await current.client.call('stop');
    try {
      run.log('Decoding the whole file…');
      const result = await current.client.call<DecodeBenchmarkResult>(
        'benchmarkDecode',
        undefined,
        {
          onProgress: (seconds: number) => (benchmarkProgress = seconds),
        },
      );
      const threeHours = (3 * 3600) / result.realtimeFactor;
      run.check(
        'Full decode speed',
        null,
        `${result.realtimeFactor.toFixed(0)}× real time: a 3-hour file takes ${formatDuration(threeHours)}`,
      );
      const drift = (result.decodedSeconds - current.info.duration) * 1000;
      run.check(
        'Decoded length matches duration',
        Math.abs(drift) < 100 && Math.abs(result.firstTimestamp) < 0.001,
        `decoded ${formatDuration(result.decodedSeconds)} (${drift >= 0 ? '+' : ''}${drift.toFixed(1)} ms), first sample at ${(result.firstTimestamp * 1000).toFixed(1)} ms`,
      );
    } catch (error) {
      run.check('Full decode speed', false, errorMessage(error));
    } finally {
      benchmarkProgress = null;
      phase = 'ready';
    }
  }
</script>

<SpikeCard
  id="S1"
  title="Streaming audio"
  question="Can we play a long MP3/FLAC/M4A smoothly while decoding it in pieces?"
  criteria={[
    'Memory under 300 MB, also for a 3-hour file',
    'Cue jumps under 50 ms (8 cues with a 2-second cache each)',
    'No dropouts while streaming',
  ]}
>
  <div class="row">
    <label class="file">
      <span>Choose an audio file (ideally a 1–3 hour mix)</span>
      <input
        type="file"
        accept="audio/*,.mp3,.m4a,.flac,.ogg,.opus,.wav"
        onchange={prepare}
        disabled={phase === 'testing' || phase === 'benchmarking'}
        data-testid="s1-file"
      />
    </label>
  </div>
  {#if engine}
    <div class="row">
      <button class="primary" onclick={runTest} disabled={phase !== 'ready'} data-testid="s1-run">
        {phase === 'testing' ? 'Testing…' : 'Run streaming test'}
      </button>
      <button onclick={benchmark} disabled={phase !== 'ready'} data-testid="s1-benchmark">
        {benchmarkProgress !== null
          ? `Decoding… ${formatDuration(benchmarkProgress)}`
          : 'Full decode benchmark'}
      </button>
    </div>
    <div class="row player">
      <button onclick={togglePlay} disabled={!engine.context || phase !== 'ready'}>
        {playing ? 'Pause' : 'Play'}
      </button>
      {#each engine.cues as cue, index (index)}
        <button
          class="cue"
          onclick={() => playCue(cue)}
          disabled={!engine.context || phase !== 'ready'}
          title={formatDuration(cue)}>{index + 1}</button
        >
      {/each}
      <span class="status" data-testid="s1-status">
        {formatDuration(status.position)} / {formatDuration(engine.info.duration)} · buffer
        {status.buffered.toFixed(1)} s · underruns {status.underruns}
      </span>
    </div>
  {/if}
</SpikeCard>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .file {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 14px;
    color: var(--muted);
  }
  .cue {
    min-width: 38px;
    padding: 6px 0;
    font-family: var(--mono);
  }
  .status {
    font-family: var(--mono);
    font-size: 13px;
    color: var(--muted);
  }
</style>
