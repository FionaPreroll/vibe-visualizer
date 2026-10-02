<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { isClean, type SoundSettings } from '../core/audio/dsp/sound-settings';
  import {
    chapterProblem,
    chapterText,
    partChapters,
    partLayout,
    partsSeconds,
    videoFileName,
    type ExportCodecs,
    type ExportManifest,
    type ExportPart,
    type ExportVisuals,
  } from '../core/export/export-job';
  import { canPickFile, pickFile, type RequestPart } from '../core/export/exporter';
  import { readManifest } from '../core/export/job-store';
  import {
    ASPECT_RATIOS,
    estimateBytes,
    EXPORT_PRESETS,
    FADE_CHOICES,
    fitOptions,
    frameSize,
    FRAME_RATES,
    QUALITIES,
    RESOLUTIONS,
    resolveFormat,
    type AspectRatio,
    type ExportOptions,
    type FadeSeconds,
  } from '../core/export/video-format';
  import { BUILT_IN_KALEIDO_PRESETS } from '../core/render/kaleido-settings';
  import { switchingPool, type AutoPresets } from '../core/render/preset-director';
  import { BUILT_IN_PRESETS } from '../core/render/visual-settings';
  import { shownArtist, shownTitle, trackRange, type Track } from '../core/state/app-state';
  import { loadExportOptions, saveExportOptions } from '../core/state/persistence';
  import { errorMessage, formatBytes, formatDuration } from '../core/util/format';
  import { useExporter } from './exporter-context';
  import Icon from './Icon.svelte';
  import { usePlayer } from './player-context';
  import { kaleidoPresets, logoSpectrumPresets } from './preset-store';
  import { useAssets } from './visuals-context';

  /**
   * The export (EX-03…06): format, range and quality, one track or several (EX-05) with fades
   * (EX-16); then progress with a preview, pause and cancel; the finished file with its chapters
   * (EX-14); and resuming an interrupted export (EX-15).
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
  /** Tracks of the queue left out of a video of several; those added later are in. */
  const skipped = new SvelteSet<string>();
  let copied = $state(false);

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
  /** The tracks a video of several can play, in the order of the queue. */
  const ready = $derived(
    $app.tracks.filter((entry) => entry.status === 'ready' && entry.duration !== null),
  );
  /** What the video plays: the choice, where it is possible. */
  const choice = $derived.by((): ExportOptions['range'] => {
    if (fitted.range === 'tracks' && ready.length > 1) return 'tracks';
    return fitted.range !== 'track' && marked ? 'marks' : 'track';
  });
  const chosen = $derived(
    choice === 'tracks' ? ready.filter((entry) => !skipped.has(entry.id)) : track ? [track] : [],
  );
  const parts = $derived(chosen.map((entry) => exportPart(entry, choice !== 'track')));
  const sound = $derived($app.sound);
  /** Length of the video: the parts at the tempo of the sound. */
  const seconds = $derived(parts.length > 0 ? partsSeconds(parts, sound) : 0);
  /** Where the tracks will start in the video (EX-14). */
  const chapters = $derived(
    choice === 'tracks' && parts.length > 1
      ? partChapters(parts, { partStarts: partLayout(parts).starts }, sound)
      : [],
  );

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

  /**
   * The part of `entry` a video plays: all of it, or the play range between its markers, as the
   * player plays it from the queue (TR-09).
   */
  function exportPart(entry: Track, useMarks: boolean): ExportPart {
    const duration = entry.duration ?? 0;
    const range = trackRange(entry, useMarks) ?? { start: 0, end: duration };
    return {
      source: {
        name: entry.fileName,
        size: entry.size,
        lastModified: player.fileFor(entry.id)?.lastModified ?? 0,
        title: shownTitle(entry),
        artist: shownArtist(entry),
      },
      range,
      cut: range.end < duration,
    };
  }

  async function start() {
    problem = null;
    if (parts.length === 0 || !codecs || mode === 'analysis') return;
    const tracks = chosen;
    const planned = parts;
    const files = tracks.map((entry) => player.fileFor(entry.id));
    const unread = tracks.filter((_, index) => !files[index]).map((entry) => shownTitle(entry));
    if (unread.length > 0) {
      problem = `${namesOf(unread)} cannot be read; add the file to the queue again.`;
      return;
    }
    // The track overlay names each track over the part the video plays (LS-18, LS-19).
    const overlay = $app.settings.overlay;
    const visuals: ExportVisuals = {
      ...visualsOf(mode),
      overlay: overlay.on ? overlay : undefined,
    };
    const covered = mode === 'logoSpectrum' && $app.settings.coverLogo;
    const fileName = videoFileName(planned, codecs.container, sound);
    let destination: FileSystemFileHandle | null;
    try {
      destination = await saveTarget(fileName, codecs.container);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        problem = errorMessage(error);
      }
      return;
    }
    // The cover art as the logo (LS-15); read after the save dialog, which needs the click.
    const covers = await Promise.all(
      tracks.map((entry) =>
        covered && entry.coverUrl
          ? fetch(entry.coverUrl)
              .then((response) => response.blob())
              .catch(() => null)
          : null,
      ),
    );
    const requested: RequestPart[] = tracks.map((entry, index) => ({
      part: planned[index]!,
      file: files[index]!,
      grid: player.analysisOf(entry)?.grid ?? null,
      cover: covers[index] ?? null,
    }));
    player.pause();
    const started = exporter.start({
      parts: requested,
      format,
      visuals,
      sound,
      fade: fitted.fade,
      images: assets.shown,
      destination,
      fileName,
    });
    started.catch((error: unknown) => (problem = errorMessage(error)));
  }

  /** "A", "A and B", "A, B and C". */
  function namesOf(names: readonly string[]): string {
    if (names.length < 2) return names[0] ?? '';
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }

  /** The visuals of the video: the current settings, and the preset switching if it is on. */
  function visualsOf(mode: 'logoSpectrum' | 'kaleidoscope'): ExportVisuals {
    const config = $app.settings.autoPresets;
    const favourites = $app.settings.favourites;
    if (mode === 'kaleidoscope') {
      const presets = switchingPool(
        BUILT_IN_KALEIDO_PRESETS,
        $kaleidoPresets,
        favourites.kaleidoscope,
        config.pool,
      );
      return {
        mode,
        settings: $app.kaleido,
        auto: config.on ? { config, presets } : undefined,
        reduceFlashing: $app.settings.reduceFlashing,
      };
    }
    const presets = switchingPool(
      BUILT_IN_PRESETS,
      $logoSpectrumPresets,
      favourites.logoSpectrum,
      config.pool,
    );
    // The Kaleidoscope behind (VE-08), if a look of the video shows it.
    const looks = config.on ? [$app.visuals, ...presets] : [$app.visuals];
    const layered = looks.some((look) => look.backgroundSource === 'kaleidoscope');
    return {
      mode,
      settings: $app.visuals,
      auto: config.on ? { config, presets } : undefined,
      reduceFlashing: $app.settings.reduceFlashing,
      layer: layered ? $app.kaleido : undefined,
    };
  }

  /** How the presets switch, for the summary. */
  function switchingSummary(config: AutoPresets): string {
    if (config.trigger === 'drops') return 'switching presets on the drops';
    if (config.trigger === 'bars') {
      return `switching presets every ${config.bars} bar${config.bars === 1 ? '' : 's'}`;
    }
    return `switching presets every ${config.seconds.toFixed(0)} s`;
  }

  /** Continues the stored export (after a reload, a crash or a failure). */
  async function resume() {
    problem = null;
    const manifest: ExportManifest | null = await readManifest();
    if (!manifest || manifest.progress.finished) return;
    let files: (File | null)[] = manifest.parts.map(() => null);
    if (!manifest.progress.audioDone) {
      // The audio pass starts again: it needs the files of the tracks, from the queue.
      files = manifest.parts.map(({ source }) => {
        const match = $app.tracks.find(
          (entry) => entry.fileName === source.name && entry.size === source.size,
        );
        return match ? player.fileFor(match.id) : null;
      });
      const missing = manifest.parts
        .filter((_, index) => !files[index])
        .map(({ source }) => source.name);
      if (missing.length > 0) {
        problem = `Add ${namesOf([...new Set(missing)])} to the queue first, then resume.`;
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
    exporter.resume(files, destination).catch((error: unknown) => (problem = errorMessage(error)));
  }

  /** Puts the chapter list on the clipboard, for the video's description (EX-14). */
  async function copyChapters(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // Clipboard blocked: the list stays readable and selectable on screen.
    }
  }

  /** Saves the chapter list as a text file named after the video. */
  function saveChapters(text: string, fileName: string) {
    const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileName.replace(/\.[^.]+$/, '')} - chapters.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** The play range of `entry` in a few words: its length, and where it is if it is marked. */
  function rangeLabel(entry: Track): string {
    const duration = entry.duration ?? 0;
    const range = trackRange(entry, true) ?? { start: 0, end: duration };
    const length = formatDuration(range.end - range.start);
    if (range.start <= 0 && range.end >= duration) return length;
    return `${length} (${formatDuration(range.start)}–${formatDuration(range.end)})`;
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

  /** The sound in a few words, e.g. "85 %, key lock, reverb". */
  function soundSummary(value: SoundSettings): string {
    if (isClean(value)) return 'As the file sounds';
    const parts: string[] = [];
    if (value.rate !== 1) {
      parts.push(`${(value.rate * 100).toFixed(1).replace(/\.0$/, '')} % speed`);
      parts.push(value.tempoMode === 'keylock' ? 'key lock' : 'vinyl');
    }
    if (value.filter !== 0) parts.push(value.filter < 0 ? 'low-pass filter' : 'high-pass filter');
    if (value.delayOn) parts.push('delay');
    if (value.reverbOn) parts.push('reverb');
    return parts.join(', ');
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
      {#if done.chapters.length > 1}
        {@const text = chapterText(done.chapters)}
        {@const issue = chapterProblem(done.chapters, done.duration)}
        <div class="chapters">
          <p class="hint">Chapters for the description on YouTube:</p>
          <pre data-testid="export-chapters">{text}</pre>
          {#if issue}
            <p class="hint">{issue}</p>
          {/if}
          <div class="actions">
            <button onclick={() => copyChapters(text)} data-testid="export-chapters-copy">
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onclick={() => saveChapters(text, done.fileName)}
              data-testid="export-chapters-save"
            >
              Save as text
            </button>
          </div>
        </div>
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
        <label
          title="The picture fades from and to black at the start and the end, and the sound with it"
        >
          Fade in and out
          <select
            value={options.fade}
            onchange={(event) => (options.fade = Number(event.currentTarget.value) as FadeSeconds)}
            data-testid="export-fade"
          >
            {#each FADE_CHOICES as fade (fade)}
              <option value={fade}>{fade === 0 ? 'No fades' : `${fade} s`}</option>
            {/each}
          </select>
        </label>
      </div>

      <fieldset>
        <legend>Range</legend>
        <div class="choices">
          <label class="choice" class:on={choice === 'track'}>
            <input
              type="radio"
              name="range"
              checked={choice === 'track'}
              onchange={() => (options.range = 'track')}
              data-testid="export-range-track"
            />
            <span class="name">Whole track</span>
            <span class="detail">{formatDuration(track?.duration ?? 0)}</span>
          </label>
          <label class="choice" class:on={choice === 'marks'} class:off={!marked}>
            <input
              type="radio"
              name="range"
              disabled={!marked}
              checked={choice === 'marks'}
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
          <label class="choice wide" class:on={choice === 'tracks'} class:off={ready.length < 2}>
            <input
              type="radio"
              name="range"
              disabled={ready.length < 2}
              checked={choice === 'tracks'}
              onchange={() => (options.range = 'tracks')}
              data-testid="export-range-tracks"
            />
            <span class="name">Tracks of the queue</span>
            <span class="detail">
              {ready.length < 2
                ? 'One video of several tracks: add more to the queue first'
                : 'One video of several tracks, one after the other, with chapters'}
            </span>
          </label>
        </div>
        {#if choice === 'tracks'}
          <div class="tracks-head">
            <span>{chosen.length} of {ready.length} tracks</span>
            <button onclick={() => skipped.clear()} disabled={chosen.length === ready.length}>
              All
            </button>
            <button
              onclick={() => ready.forEach((entry) => skipped.add(entry.id))}
              disabled={chosen.length === 0}
            >
              None
            </button>
          </div>
          <ul class="tracks" data-testid="export-tracks">
            {#each ready as entry (entry.id)}
              <li>
                <label>
                  <input
                    type="checkbox"
                    checked={!skipped.has(entry.id)}
                    onchange={(event) =>
                      event.currentTarget.checked
                        ? skipped.delete(entry.id)
                        : skipped.add(entry.id)}
                    data-testid="export-track-choice"
                  />
                  <span class="title">
                    {shownTitle(entry)}
                    {#if shownArtist(entry)}
                      <span class="detail">· {shownArtist(entry)}</span>
                    {/if}
                  </span>
                  <span class="detail">{rangeLabel(entry)}</span>
                </label>
              </li>
            {/each}
          </ul>
          <p class="hint">
            In the order of the queue, each between its markers, joined as the player joins them.
            {#if chapters.length > 0}
              {chapterProblem(chapters, seconds) ??
                'The finished video comes with chapters for its description on YouTube.'}
            {/if}
          </p>
        {/if}
      </fieldset>

      <dl class="summary">
        <dt>{choice === 'tracks' ? 'Tracks' : 'Track'}</dt>
        <dd data-testid="export-track">
          {#if choice === 'tracks'}
            {chosen.length === 0
              ? 'Choose them above'
              : `${chosen.length} track${chosen.length === 1 ? '' : 's'}, from ${shownTitle(chosen[0]!)}`}
          {:else}
            {track ? shownTitle(track) : 'Add a track to the queue first'}
          {/if}
        </dd>
        <dt>Visuals</dt>
        <dd>
          {#if mode === 'analysis'}
            Switch to Logo Spectrum or Kaleidoscope first
          {:else}
            {mode === 'kaleidoscope' ? 'Kaleidoscope' : 'Logo Spectrum'}, with the current settings
            {#if $app.settings.autoPresets.on}
              <span data-testid="export-switching"
                >({switchingSummary($app.settings.autoPresets)})</span
              >
            {/if}
            {#if $app.settings.reduceFlashing}
              <span data-testid="export-calm">(flashing reduced)</span>
            {/if}
            {#if $app.settings.overlay.on}
              <span data-testid="export-overlay"
                >({chosen.length > 1 ? 'with the titles' : "with the track's title"})</span
              >
            {/if}
            {#if mode === 'logoSpectrum' && $app.settings.coverLogo && chosen.some((entry) => entry.coverUrl)}
              <span data-testid="export-cover"
                >({chosen.length > 1
                  ? 'the cover art as the logo'
                  : 'its cover art as the logo'})</span
              >
            {/if}
            {#if fitted.fade > 0}
              <span data-testid="export-fades">(fading in and out over {fitted.fade} s)</span>
            {/if}
          {/if}
        </dd>
        <dt>Video</dt>
        <dd>
          {format.width}×{format.height} · {format.fps} fps ·
          {#if codecs}{codecLabel(codecs)}{:else}checking the encoders…{/if}
        </dd>
        <dt>Sound</dt>
        <dd data-testid="export-sound">{soundSummary(sound)} (set in the Sound tab)</dd>
        <dt>Length</dt>
        <dd data-testid="export-length">
          {formatDuration(seconds)} · about {formatBytes(estimateBytes(format, seconds))}
        </dd>
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
          disabled={parts.length === 0 || !codecs || mode === 'analysis' || seconds <= 0}
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
  .choice.wide {
    grid-column: 1 / -1;
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
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
  }
  .tracks-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 10px 0 6px;
    font-size: 13px;
    color: var(--muted);
  }
  .tracks-head span {
    margin-right: auto;
  }
  .tracks-head button {
    padding: 2px 10px;
    font-size: 12px;
  }
  .tracks {
    max-height: 180px;
    margin: 0;
    padding: 4px 0;
    overflow-y: auto;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .tracks label {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    color: var(--text);
    cursor: pointer;
  }
  .tracks input {
    accent-color: var(--accent);
  }
  .tracks .title {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .chapters pre {
    max-height: 160px;
    margin: 6px 0 0;
    padding: 8px 10px;
    overflow: auto;
    border-radius: 8px;
    background: var(--surface-2);
    font-size: 13px;
    white-space: pre-wrap;
    user-select: text;
  }
  .chapters .actions {
    margin-top: 8px;
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
