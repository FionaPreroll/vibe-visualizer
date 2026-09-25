<script lang="ts">
  import type { VideoCodec } from 'mediabunny';
  import { errorMessage, formatBytes, formatMs } from '../../core/util/format';
  import { WorkerClient } from '../../core/util/worker-rpc';
  import { probePlayback } from '../media-probe';
  import { quickMode } from '../quick';
  import { SpikeRun } from '../report.svelte';
  import SpikeCard from '../ui/SpikeCard.svelte';
  import type {
    AudioBenchmarkResult,
    SampleFileResult,
    VideoBenchmarkResult,
  } from './encoding.worker';
  import EncodingWorker from './encoding.worker.ts?worker';

  const TARGETS: {
    label: string;
    codec: VideoCodec;
    width: number;
    height: number;
    fps: number;
    bitrate: number;
    mustBeRealtime: boolean;
  }[] = [
    {
      label: 'YouTube 1080p60',
      codec: 'avc',
      width: 1920,
      height: 1080,
      fps: 60,
      bitrate: 12e6,
      mustBeRealtime: true,
    },
    {
      label: 'YouTube 4K30',
      codec: 'avc',
      width: 3840,
      height: 2160,
      fps: 30,
      bitrate: 40e6,
      mustBeRealtime: false,
    },
    {
      label: 'TikTok 1080×1920 30',
      codec: 'avc',
      width: 1080,
      height: 1920,
      fps: 30,
      bitrate: 10e6,
      mustBeRealtime: false,
    },
  ];

  let running = $state(false);
  let sample = $state<{ url: string; name: string; size: number } | null>(null);

  async function run() {
    running = true;
    const spike = new SpikeRun('S3');
    const client = new WorkerClient(new EncodingWorker());
    const seconds = quickMode ? 1 : 5;
    try {
      for (const target of TARGETS) {
        spike.log(`H.264 ${target.label}: encoding ${seconds} s of test pattern…`);
        const check = target.mustBeRealtime
          ? `H.264 ${target.label} faster than real time`
          : `H.264 ${target.label}`;
        try {
          const result = await client.call<VideoBenchmarkResult>('videoBenchmark', {
            codec: target.codec,
            width: target.width,
            height: target.height,
            fps: target.fps,
            bitrate: target.bitrate,
            seconds,
          });
          const speed = result.fps / target.fps;
          const detail = `${result.fps.toFixed(1)} fps = ${speed.toFixed(2)}× real time (${result.encoderCodec})`;
          spike.metric(`${target.label} encode speed`, detail);
          spike.check(check, target.mustBeRealtime ? speed >= 1 : null, detail);
        } catch (error) {
          spike.check(check, false, errorMessage(error));
        }
      }

      spike.log(`AAC: encoding ${seconds * 12} s of audio…`);
      try {
        const audio = await client.call<AudioBenchmarkResult>('audioBenchmark', {
          seconds: seconds * 12,
        });
        const detail = `${audio.encoder} encoder, ${audio.realtimeFactor.toFixed(0)}× real time`;
        spike.metric('AAC encode speed', detail);
        spike.check('AAC encoding available', true, detail);
        if (audio.encoder === 'native') {
          spike.log('AAC: testing the WebAssembly fallback in a separate worker…');
          const fallbackClient = new WorkerClient(new EncodingWorker());
          try {
            const wasm = await fallbackClient.call<AudioBenchmarkResult>('audioBenchmark', {
              seconds: seconds * 12,
              forceWasm: true,
            });
            spike.check(
              'AAC WebAssembly fallback works',
              wasm.encoder === 'wasm',
              `${wasm.realtimeFactor.toFixed(0)}× real time`,
            );
          } finally {
            fallbackClient.terminate();
          }
        } else {
          spike.check('AAC WebAssembly fallback works', audio.encoder === 'wasm', detail);
        }
      } catch (error) {
        spike.check('AAC encoding available', false, errorMessage(error));
      }

      const sampleSeconds = quickMode ? 2 : 10;
      spike.log(`Writing a ${sampleSeconds} s A/V sync sample (1080p60)…`);
      const start = performance.now();
      const file = await client.call<SampleFileResult>('sampleFile', {
        seconds: sampleSeconds,
        width: 1920,
        height: 1080,
        fps: 60,
      });
      spike.metric(
        'Sample file',
        `${formatBytes(file.buffer.byteLength)} in ${formatMs(performance.now() - start)}`,
      );
      spike.metric('Sample codecs', `${file.videoCodec} + ${file.audioCodec}`);
      if (sample) URL.revokeObjectURL(sample.url);
      const blob = new Blob([file.buffer], { type: 'video/mp4' });
      sample = {
        url: URL.createObjectURL(blob),
        name: `vibe-visualizer-sync-test-${file.videoCodec}-${file.audioCodec}.mp4`,
        size: blob.size,
      };
      try {
        const playback = await probePlayback(sample.url);
        const ok =
          Math.abs(playback.duration - sampleSeconds) < 0.5 &&
          playback.width === 1920 &&
          playback.height === 1080;
        spike.check(
          'Sample MP4 plays in this browser',
          ok,
          `${playback.width}×${playback.height}, ${playback.duration.toFixed(2)} s`,
        );
      } catch (error) {
        spike.check('Sample MP4 plays in this browser', false, errorMessage(error));
      }
      spike.check(
        'Upload to YouTube and TikTok',
        null,
        'manual: upload the sample (private) and check that flash and beep stay in sync',
      );
      spike.done();
    } catch (error) {
      spike.fail(error);
    } finally {
      client.terminate();
      running = false;
    }
  }
</script>

<SpikeCard
  id="S3"
  title="Encoding"
  question="Do H.264 + AAC via WebCodecs work on this machine (1080p60, 4K30, 1080×1920)?"
  criteria={[
    '1080p60 encodes faster than real time',
    'AAC works, natively or via the WebAssembly fallback',
    'The sample file uploads fine to YouTube and TikTok (manual)',
  ]}
>
  <div class="row">
    <button class="primary" onclick={run} disabled={running} data-testid="s3-run">
      {running ? 'Running…' : 'Run encoding test'}
    </button>
    <span class="hint">Takes about 30 seconds. Keep this tab in front.</span>
  </div>
  {#if sample}
    <div class="sample">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video src={sample.url} controls width="480"></video>
      <a href={sample.url} download={sample.name}>Download sample ({formatBytes(sample.size)})</a>
    </div>
  {/if}
</SpikeCard>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .hint {
    color: var(--muted);
    font-size: 14px;
  }
  .sample {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
  }
  video {
    max-width: 100%;
    border-radius: 8px;
    background: #000;
  }
</style>
