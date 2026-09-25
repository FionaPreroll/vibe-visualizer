<script lang="ts">
  import {
    exportFileName,
    type ExportCodecs,
    type ExportManifest,
  } from '../core/export/export-job';
  import { canPickFile, pickFile } from '../core/export/exporter';
  import { readManifest } from '../core/export/job-store';
  import {
    ASPECT_RATIOS,
    estimateBytes,
    EXPORT_PRESETS,
    fitOptions,
    frameSize,
    FRAME_RATES,
    QUALITIES,
    RESOLUTIONS,
    resolveFormat,
    type AspectRatio,
    type ExportOptions,
  } from '../core/export/video-format';
  import { trackRange } from '../core/state/app-state';
  import { loadExportOptions, saveExportOptions } from '../core/state/persistence';
  import { errorMessage, formatBytes, formatDuration } from '../core/util/format';
  import { useExporter } from './exporter-context';
  import Icon from './Icon.svelte';
  import { usePlayer } from './player-context';
  import { useAssets } from './visuals-context';

  /**
   * The export (EX-03…06): format, range and quality; then progress with a preview, pause and
   * cancel; the finished file; and resuming an interrupted export (EX-15).
   */
  interface Props {
    open: boolean;
    onclose: () => void;
  }
  let { open, onclose }: Props = $props();

  const player = usePlayer();
  const app = player.store;
  const exporter = useExporter();
  const assets = useAssets();

  let dialog: HTMLDialogElement | undefined = $state();
  let preview: HTMLCanvasElement | undefined = $state();
  let options = $state<ExportOptions>(loadExportOptions());
  let codecs = $state<ExportCodecs | null>(null);
  let problem = $state<string | null>(null);

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  $effect(() => saveExportOptions($state.snapshot(options)));

  const aspect = $derived($app.settings.aspect);
  const fitted = $derived(fitOptions(options, aspect));
  const format = $derived(resolveFormat(fitted, aspect));
  const mode = $derived($app.settings.visualMode);
  const track = $derived(
    $app.tracks.find((entry) => entry.id === $app.currentId && entry.status === 'ready') ??
      $app.tracks.find((entry) => entry.status === 'ready') ??
      null,
  );
  const marked = $derived(track !== null && (track.marks.in !== null || track.marks.out !== null));
  const range = $derived(track ? trackRange(track, marked && fitted.range === 'marks') : null);
  const seconds = $derived(range ? range.end - range.start : 0);

  // Which codecs this browser will use (EX-04), checked whenever the format changes.
  $effect(() => {
    if (!open) return;
    const wanted = format;
    let stale = false;
    codecs = null;
    problem = null;
    exporter
      .probe(wanted)
      .then((result) => {
        if (!stale) codecs = result;
      })
      .catch((error: unknown) => {
        if (!stale) problem = errorMessage(error);
      });
    return () => (stale = true);
  });

  // The latest preview frame of a running export.
  $effect(() => {
    const bitmap = $exporter.status === 'running' ? $exporter.job.preview : null;
    if (!preview || !bitmap) return;
    try {
      preview.width = bitmap.width;
      preview.height = bitmap.height;
      preview.getContext('2d')?.drawImage(bitmap, 0, 0);
    } catch {
      // Already replaced by a newer frame.
    }
  });

  function choosePreset(id: ExportOptions['preset']) {
    options.preset = id;
    problem = null;
    const preset = EXPORT_PRESETS.find((entry) => entry.id === id);
    // The stage shows what will be exported.
    if (preset && preset.aspect !== aspect) player.updateSettings({ aspect: preset.aspect });
  }

  function chooseAspect(value: AspectRatio) {
    options.preset = 'custom';
    player.updateSettings({ aspect: value });
  }

  async function saveTarget(fileName: string, container: 'mp4' | 'webm') {
    if (!canPickFile()) return null;
    return pickFile(fileName, container);
  }

  async function start() {
    problem = null;
    if (!track || !range || !codecs || mode === 'analysis') return;
    const file = player.fileFor(track.id);
    if (!file) return;
    const whole = range.start <= 0 && range.end >= (track.duration ?? range.end);
    const source = { title: track.title, artist: track.artist };
    const fileName = exportFileName(source, whole ? null : range, codecs.container);
    let destination: FileSystemFileHandle | null;
    try {
      destination = await saveTarget(fileName, codecs.container);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        problem = errorMessage(error);
      }
      return;
    }
    player.pause();
    const started = exporter.start({
      file,
      source: {
        ...source,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
      },
      range,
      format,
      visuals:
        mode === 'kaleidoscope'
          ? { mode, settings: $app.kaleido }
          : { mode: 'logoSpectrum', settings: $app.visuals },
      images: assets.current,
      destination,
      fileName,
    });
    started.catch((error: unknown) => (problem = errorMessage(error)));
  }

  /** Continues the stored export (after a reload, a crash or a failure). */
  async function resume() {
    problem = null;
    const manifest: ExportManifest | null = await readManifest();
    if (!manifest || manifest.progress.finished) return;
    let file: File | null = null;
    if (!manifest.progress.audioDone) {
      const match = $app.tracks.find(
        (entry) => entry.fileName === manifest.source.name && entry.size === manifest.source.size,
      );
      file = match ? player.fileFor(match.id) : null;
      if (!file) {
        problem = `Add ${manifest.source.name} to the queue first, then resume.`;
        return;
      }
    }
    let destination: FileSystemFileHandle | null;
    try {
      destination = await saveTarget(manifest.fileName, manifest.codecs.container);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        problem = errorMessage(error);
      }
      return;
    }
    player.pause();
    exporter.resume(file, destination).catch((error: unknown) => (problem = errorMessage(error)));
  }

  const PHASES = {
    starting: 'Preparing',
    audio: 'Analysing and encoding the audio',
    video: 'Rendering the video',
    join: 'Writing the file',
  };

  function codecLabel(value: ExportCodecs): string {
    const video = value.video === 'avc' ? 'H.264' : 'VP9';
    const audio = value.audio === 'aac' ? 'AAC' : 'Opus';
    return `${video} + ${audio}, ${value.container.toUpperCase()}`;
  }

  function remaining(seconds: number | null): string {
    if (seconds === null) return '';
    if (seconds < 60) return 'less than a minute left';
    return `about ${formatDuration(Math.ceil(seconds / 60) * 60)} left`;
  }
</script>

<dialog
  bind:this={dialog}
  class="export"
  aria-labelledby="export-title"
  {onclose}
  data-testid="export-dialog"
>
  <header>
    <h2 id="export-title">Export video</h2>
    <button class="close" onclick={onclose} aria-label="Close">
      <Icon name="close" size={18} />
    </button>
  </header>

  {#if $exporter.status === 'running'}
    {@const job = $exporter.job}
    <section class="progress" data-testid="export-progress" data-phase={job.phase}>
      <canvas
        bind:this={preview}
        class="preview"
        style:aspect-ratio={job.format.width / job.format.height}
      ></canvas>
      <p class="file">
        {job.fileName} · {job.format.width}×{job.format.height} · {job.format.fps} fps
      </p>
      <div
        class="bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(job.progress * 100)}
        aria-label="Export progress"
      >
        <div class="fill" style:width="{job.progress * 100}%"></div>
      </div>
      <p class="status">
        <span>{job.paused ? 'Paused' : PHASES[job.phase]} · {Math.floor(job.progress * 100)} %</span
        >
        <span>
          {#if job.speed !== null}{job.speed.toFixed(1)}× real time ·{/if}
          {remaining(job.remaining)}
        </span>
      </p>
      <p class="hint">
        The live visuals pause while exporting. You can close this window; the export goes on and
        keeps the screen awake.
      </p>
      <div class="actions">
        {#if job.paused}
          <button class="primary" onclick={() => exporter.unpause()}>
            <Icon name="play" size={16} /> Continue
          </button>
        {:else}
          <button onclick={() => exporter.pause()}><Icon name="pause" size={16} /> Pause</button>
        {/if}
        <button onclick={() => exporter.cancel()} data-testid="export-cancel">Cancel export</button>
      </div>
    </section>
  {:else if $exporter.status === 'done'}
    {@const done = $exporter}
    <section class="result" data-testid="export-done">
      <p class="big">Your video is ready.</p>
      <p class="file">{done.fileName} · {formatBytes(done.bytes)}</p>
      {#if done.seconds !== null}
        <p class="hint">Rendered in {formatDuration(done.seconds)}.</p>
      {/if}
      <div class="actions">
        {#if done.url}
          <a
            class="button primary"
            href={done.url}
            download={done.fileName}
            data-testid="export-download"
          >
            <Icon name="export" size={16} /> Download
          </a>
          <button onclick={() => exporter.discard()}>Delete from browser storage</button>
        {:else}
          <p class="hint">Saved to the file you chose.</p>
        {/if}
        <button onclick={() => exporter.dismiss()}>New export</button>
      </div>
    </section>
  {:else if $exporter.status === 'interrupted' || ($exporter.status === 'failed' && $exporter.resumable)}
    <section class="result" data-testid="export-interrupted">
      {#if $exporter.status === 'failed'}
        <p class="big">The export stopped: {$exporter.message}</p>
      {:else}
        {@const manifest = $exporter.manifest}
        <p class="big">An export was interrupted.</p>
        <p class="file">
          {manifest.fileName} · {Math.round(
            (manifest.progress.segmentsDone / manifest.timing.segments) * 100,
          )} % rendered
        </p>
      {/if}
      <p class="hint">It continues where it stopped.</p>
      <div class="actions">
        <button class="primary" onclick={resume} data-testid="export-resume">Resume</button>
        <button onclick={() => exporter.discard()} data-testid="export-discard">Discard</button>
      </div>
    </section>
  {:else}
    {#if $exporter.status === 'failed'}
      <p class="problem" role="alert">The export failed: {$exporter.message}</p>
    {/if}
    <section class="form">
      <fieldset>
        <legend>Format</legend>
        <div class="choices">
          {#each EXPORT_PRESETS as preset (preset.id)}
            <label class="choice" class:on={fitted.preset === preset.id}>
              <input
                type="radio"
                name="preset"
                checked={fitted.preset === preset.id}
                onchange={() => choosePreset(preset.id)}
              />
              <span class="name">{preset.label}</span>
              <span class="detail">
                {frameSize(preset.aspect, preset.resolution).join('×')} · {preset.fps} fps
              </span>
            </label>
          {/each}
          <label class="choice" class:on={fitted.preset === 'custom'}>
            <input
              type="radio"
              name="preset"
              checked={fitted.preset === 'custom'}
              onchange={() => choosePreset('custom')}
            />
            <span class="name">Custom</span>
            <span class="detail">Any aspect ratio, size and frame rate</span>
          </label>
        </div>
        {#if fitted.preset === 'custom'}
          <div class="custom">
            <div class="aspects" role="radiogroup" aria-label="Aspect ratio">
              {#each ASPECT_RATIOS as entry (entry.id)}
                <button
                  role="radio"
                  aria-checked={aspect === entry.id}
                  class:on={aspect === entry.id}
                  onclick={() => chooseAspect(entry.id)}
                  title={entry.hint}
                >
                  {entry.id}
                </button>
              {/each}
            </div>
            <label>
              Size
              <select
                value={options.resolution}
                onchange={(event) =>
                  (options.resolution = Number(
                    event.currentTarget.value,
                  ) as ExportOptions['resolution'])}
                data-testid="export-resolution"
              >
                {#each RESOLUTIONS as resolution (resolution)}
                  <option value={resolution}>{frameSize(aspect, resolution).join(' × ')}</option>
                {/each}
              </select>
            </label>
            <label>
              Frame rate
              <select
                value={options.fps}
                onchange={(event) =>
                  (options.fps = Number(event.currentTarget.value) as ExportOptions['fps'])}
                data-testid="export-fps"
              >
                {#each FRAME_RATES as fps (fps)}
                  <option value={fps}>{fps} fps</option>
                {/each}
              </select>
            </label>
          </div>
        {/if}
      </fieldset>

      <div class="row">
        <label>
          Quality
          <select
            value={options.quality}
            onchange={(event) =>
              (options.quality = event.currentTarget.value as ExportOptions['quality'])}
          >
            {#each QUALITIES as quality (quality.id)}
              <option value={quality.id}>{quality.label}</option>
            {/each}
          </select>
        </label>
        <span class="detail">{(format.videoBitrate / 1e6).toFixed(1)} Mbit/s video</span>
      </div>

      <fieldset>
        <legend>Range</legend>
        <div class="choices two">
          <label class="choice" class:on={!marked || fitted.range === 'track'}>
            <input
              type="radio"
              name="range"
              checked={!marked || fitted.range === 'track'}
              onchange={() => (options.range = 'track')}
            />
            <span class="name">Whole track</span>
            <span class="detail">{formatDuration(track?.duration ?? 0)}</span>
          </label>
          <label class="choice" class:on={marked && fitted.range === 'marks'} class:off={!marked}>
            <input
              type="radio"
              name="range"
              disabled={!marked}
              checked={marked && fitted.range === 'marks'}
              onchange={() => (options.range = 'marks')}
              data-testid="export-range-marks"
            />
            <span class="name">Between the markers</span>
            <span class="detail">
              {#if marked && track}
                {formatDuration(track.marks.in ?? 0)}–{formatDuration(
                  track.marks.out ?? track.duration ?? 0,
                )}
              {:else}
                Set them with I and O while playing
              {/if}
            </span>
          </label>
        </div>
      </fieldset>

      <dl class="summary">
        <dt>Track</dt>
        <dd data-testid="export-track">{track?.title ?? 'Add a track to the queue first'}</dd>
        <dt>Visuals</dt>
        <dd>
          {#if mode === 'analysis'}
            Switch to Logo Spectrum or Kaleidoscope first
          {:else}
            {mode === 'kaleidoscope' ? 'Kaleidoscope' : 'Logo Spectrum'}, with the current settings
          {/if}
        </dd>
        <dt>Video</dt>
        <dd>
          {format.width}×{format.height} · {format.fps} fps ·
          {#if codecs}{codecLabel(codecs)}{:else}checking the encoders…{/if}
        </dd>
        <dt>Length</dt>
        <dd>{formatDuration(seconds)} · about {formatBytes(estimateBytes(format, seconds))}</dd>
        <dt>Saving</dt>
        <dd>
          {canPickFile()
            ? 'You choose a file; the video is written into it while rendering.'
            : 'The video downloads when it is finished.'}
        </dd>
      </dl>
      {#if codecs?.video === 'vp9'}
        <p class="hint">This browser cannot encode H.264, so the video is a WebM file (VP9).</p>
      {/if}
      {#if problem}
        <p class="problem" role="alert">{problem}</p>
      {/if}
      <div class="actions">
        <button
          class="primary"
          onclick={start}
          disabled={!track || !range || !codecs || mode === 'analysis' || seconds <= 0}
          data-testid="export-start"
        >
          <Icon name="export" size={16} /> Start export
        </button>
        <button onclick={onclose}>Close</button>
      </div>
    </section>
  {/if}
  {#if problem && $exporter.status !== 'idle' && $exporter.status !== 'failed'}
    <p class="problem" role="alert">{problem}</p>
  {/if}
</dialog>

<style>
  dialog {
    width: min(560px, 94vw);
    max-height: 90vh;
    padding: 20px 24px 24px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
  }
  dialog::backdrop {
    background: rgba(5, 5, 10, 0.7);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }
  h2 {
    margin: 0;
    font-size: 20px;
  }
  .close {
    padding: 4px;
    background: transparent;
    border-color: transparent;
  }
  fieldset {
    margin: 0 0 14px;
    padding: 0;
    border: none;
  }
  legend {
    margin-bottom: 6px;
    font-size: 13px;
    color: var(--muted);
  }
  .choices {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .choice {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 8px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
    cursor: pointer;
  }
  .choice.on {
    border-color: var(--accent);
    background: var(--surface-2);
  }
  .choice.off {
    opacity: 0.55;
    cursor: default;
  }
  .choice input {
    grid-row: span 2;
    accent-color: var(--accent);
  }
  .name {
    font-weight: 600;
  }
  .detail {
    font-size: 12px;
    color: var(--muted);
  }
  .custom {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
  }
  .aspects {
    display: flex;
    gap: 4px;
  }
  .aspects button {
    padding: 4px 8px;
    font-size: 13px;
  }
  .aspects button.on {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 20%, var(--surface-2));
  }
  label {
    font-size: 13px;
    color: var(--muted);
  }
  label select {
    margin-left: 6px;
    color: var(--text);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
  }
  .summary {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 14px;
    margin: 0 0 12px;
    font-size: 13px;
  }
  .summary dt {
    color: var(--muted);
  }
  .summary dd {
    margin: 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
  }
  .actions button,
  .button {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .button {
    padding: 6px 14px;
    border-radius: 8px;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: #120a1f;
    font-weight: 600;
    text-decoration: none;
  }
  .hint {
    margin: 8px 0 0;
    font-size: 13px;
    color: var(--muted);
  }
  .problem {
    margin: 10px 0 0;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--fail);
    background: color-mix(in srgb, var(--fail) 15%, var(--surface));
    font-size: 14px;
  }
  .preview {
    display: block;
    width: 100%;
    max-height: 40vh;
    object-fit: contain;
    background: #000;
    border-radius: 8px;
  }
  .file {
    margin: 10px 0 8px;
    font-size: 13px;
    color: var(--muted);
    word-break: break-word;
  }
  .bar {
    height: 8px;
    border-radius: 4px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .bar .fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    transition: width 0.25s;
  }
  .status {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin: 8px 0 0;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .big {
    margin: 0;
    font-size: 17px;
  }
</style>
