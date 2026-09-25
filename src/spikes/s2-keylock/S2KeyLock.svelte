<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { TempoMode } from '../../core/audio/rate-player';
  import { createTestSignal } from '../../core/audio/test-signal';
  import { errorMessage, formatDuration } from '../../core/util/format';
  import { hashFloat32, maxAbsDiff } from '../../core/util/hash';
  import { WorkerClient } from '../../core/util/worker-rpc';
  import { quickMode } from '../quick';
  import { SpikeRun } from '../report.svelte';
  import SpikeCard from '../ui/SpikeCard.svelte';
  import type { StretchPlayerMessage, StretchPlayerOptions } from './stretch-player.worklet';
  import workletUrl from './stretch-player.worklet.ts?worker&url';
  import type { BenchmarkResult, RenderResult } from './stretch.worker';
  import StretchWorker from './stretch.worker.ts?worker';

  const RATE = 48000;
  const RATES = [0.5, 0.8, 1, 1.25, 1.5];

  let running = $state(false);
  let rate = $state(1);
  let mode = $state<TempoMode>('keylock');
  let source = $state<{ planes: Float32Array[]; sampleRate: number; label: string } | null>(null);
  let player = $state<{ context: AudioContext; node: AudioWorkletNode } | null>(null);
  let loadingFile = $state(false);

  async function renderInWorklet(planes: Float32Array[], frames: number, playbackRate: number) {
    const context = new OfflineAudioContext(2, frames, RATE);
    await context.audioWorklet.addModule(workletUrl);
    const options: StretchPlayerOptions = { planes, rate: playbackRate, mode: 'keylock' };
    const node = new AudioWorkletNode(context, 's2-stretch-player', {
      numberOfInputs: 0,
      outputChannelCount: [2],
      processorOptions: options,
    });
    node.connect(context.destination);
    const buffer = await context.startRendering();
    return [buffer.getChannelData(0), buffer.getChannelData(1)] as const;
  }

  async function runTest() {
    running = true;
    const spike = new SpikeRun('S2');
    const client = new WorkerClient(new StretchWorker());
    try {
      const seconds = quickMode ? 4 : 30;
      const results: BenchmarkResult[] = [];
      for (const playbackRate of RATES) {
        spike.log(`CPU: stretching ${seconds} s at ${playbackRate}×…`);
        const result = await client.call<BenchmarkResult>('benchmark', {
          seconds,
          rate: playbackRate,
          sampleRate: RATE,
          preset: 'default',
        });
        results.push(result);
        spike.metric(
          `CPU at ${playbackRate}×`,
          `${result.cpuPercent.toFixed(1)} % of one core (${result.realtimeFactor.toFixed(0)}× real time)`,
        );
      }
      const worst = results.reduce((a, b) => (b.cpuPercent > a.cpuPercent ? b : a));
      spike.check(
        'Under 10 % of one CPU core',
        worst.cpuPercent < 10,
        `worst ${worst.cpuPercent.toFixed(1)} % at ${worst.rate}×`,
      );

      const compareSeconds = quickMode ? 2 : 10;
      spike.log(
        `Bit-exactness: rendering ${compareSeconds} s at 1.25× in worker and AudioWorklet…`,
      );
      const input = createTestSignal(compareSeconds * 1.25 + 1, RATE);
      const frames = compareSeconds * RATE;
      const renderArgs = { planes: input, rate: 1.25, mode: 'keylock', frames, sampleRate: RATE };
      const first = await client.call<RenderResult>('render', renderArgs);
      const second = await client.call<RenderResult>('render', renderArgs);
      spike.check(
        'Deterministic (two runs, same output)',
        first.hash === second.hash,
        `${first.hash} / ${second.hash}`,
      );
      const [left, right] = await renderInWorklet(input, frames, 1.25);
      const workletHash = hashFloat32(left, right);
      const diff = Math.max(maxAbsDiff(first.left, left), maxAbsDiff(first.right, right));
      spike.check(
        'Identical output live (AudioWorklet) and offline (worker)',
        workletHash === first.hash,
        workletHash === first.hash
          ? `bit-identical (${workletHash})`
          : `differs: max difference ${diff.toExponential(2)}`,
      );
      spike.check('Clean sound at 0.5–1.5×', null, 'manual: listen with the player below');
      spike.done();
    } catch (error) {
      spike.fail(errorMessage(error));
    } finally {
      client.terminate();
      running = false;
    }
  }

  async function loadFile(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    loadingFile = true;
    await stop();
    const client = new WorkerClient(new StretchWorker());
    try {
      const decoded = await client.call<{
        planes: Float32Array[];
        sampleRate: number;
        seconds: number;
      }>('decodeFile', { file, maxSeconds: 90 });
      source = {
        planes: decoded.planes,
        sampleRate: decoded.sampleRate,
        label: `${file.name} (first ${formatDuration(decoded.seconds)})`,
      };
    } catch (error) {
      alert(errorMessage(error));
    } finally {
      client.terminate();
      loadingFile = false;
    }
  }

  async function play() {
    const current = source ?? {
      planes: createTestSignal(60, RATE),
      sampleRate: RATE,
      label: 'test signal',
    };
    source = current;
    const context = new AudioContext({ sampleRate: current.sampleRate });
    await context.audioWorklet.addModule(workletUrl);
    const options: StretchPlayerOptions = { planes: current.planes, rate, mode };
    const node = new AudioWorkletNode(context, 's2-stretch-player', {
      numberOfInputs: 0,
      outputChannelCount: [2],
      processorOptions: options,
    });
    node.connect(context.destination);
    player = { context, node };
  }

  async function stop() {
    if (!player) return;
    await player.context.close();
    player = null;
  }

  function send(message: StretchPlayerMessage) {
    player?.node.port.postMessage(message);
  }

  $effect(() => send({ type: 'rate', value: rate }));
  $effect(() => send({ type: 'mode', value: mode }));

  onDestroy(() => void stop());
</script>

<SpikeCard
  id="S2"
  title="Key lock"
  question="Does Signalsmith Stretch run in our AudioWorklet and in a worker, fast and bit-identical?"
  criteria={[
    'Clean sound at 0.5–1.5× (listen)',
    'Under 10 % of one CPU core',
    'Identical output live and offline',
  ]}
>
  <div class="row">
    <button class="primary" onclick={runTest} disabled={running} data-testid="s2-run">
      {running ? 'Running…' : 'Run key lock test'}
    </button>
    <span class="hint">About 20 seconds, no file needed.</span>
  </div>
  <div class="player">
    <div class="row">
      <button onclick={player ? stop : play} data-testid="s2-play">
        {player ? 'Stop' : 'Play'}
      </button>
      <label>
        <input type="radio" bind:group={mode} value="keylock" /> Key lock
      </label>
      <label>
        <input type="radio" bind:group={mode} value="vinyl" /> Vinyl
      </label>
      <label class="slider">
        Tempo <input type="range" min="0.5" max="1.5" step="0.01" bind:value={rate} />
        <output>{rate.toFixed(2)}×</output>
      </label>
      <button onclick={() => (rate = 1)}>Reset</button>
    </div>
    <div class="row">
      <label class="file">
        <span>Source: {source?.label ?? 'test signal'}</span>
        <input
          type="file"
          accept="audio/*,.mp3,.m4a,.flac,.ogg,.opus,.wav"
          onchange={loadFile}
          disabled={loadingFile}
        />
      </label>
    </div>
  </div>
</SpikeCard>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .hint,
  .file {
    color: var(--muted);
    font-size: 14px;
  }
  .player {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .slider {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .slider input {
    width: 220px;
  }
  output {
    font-family: var(--mono);
    min-width: 48px;
  }
  .file {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
</style>
