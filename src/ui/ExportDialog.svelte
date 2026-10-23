<script lang="ts">
  import {
    videoFileName,
    type ExportCodecs,
    type ExportManifest,
    type ExportVisuals,
  } from '../core/export/export-job';
  import { exportPlan } from '../core/export/export-plan';
  import {
    canPickFile,
    canPickFolder,
    pickFile,
    pickFolder,
    type RequestPart,
  } from '../core/export/exporter';
  import { readManifest } from '../core/export/job-store';
  import { fitOptions, resolveFormat } from '../core/export/video-format';
  import { BUILT_IN_KALEIDO_PRESETS } from '../core/render/kaleido-settings';
  import { switchingPool } from '../core/render/preset-director';
  import { BUILT_IN_PRESETS } from '../core/render/visual-settings';
  import { shownCover, shownTitle } from '../core/state/app-state';
  import { saveExportOptions } from '../core/state/persistence';
  import { errorMessage } from '../core/util/format';
  import { ExportChoices } from './export/export-choices.svelte';
  import { namesOf } from './export/export-words';
  import ExportFormat from './export/ExportFormat.svelte';
  import ExportProgress from './export/ExportProgress.svelte';
  import ExportRange from './export/ExportRange.svelte';
  import ExportResult from './export/ExportResult.svelte';
  import ExportResume from './export/ExportResume.svelte';
  import ExportSummary from './export/ExportSummary.svelte';
  import ExportVideos from './export/ExportVideos.svelte';
  import { useExporter } from './exporter-context';
  import Icon from './Icon.svelte';
  import { usePlayer } from './player-context';
  import { kaleidoPresets, logoSpectrumPresets } from './preset-store';
  import { lookSettings } from './track-look';
  import { useAssets } from './visuals-context';
  import { useAppState } from './app-state.svelte';

  /**
   * The export (EX-03…06): format, range and quality, one track or several (EX-05) with fades
   * (EX-16); then progress with a preview, pause and cancel; the finished file with its chapters
   * (EX-14); and resuming an interrupted export (EX-15). Its parts are in export/; they share
   * what the user chose (ExportChoices), and what that makes is worked out in core/export.
   */
  interface Props {
    open: boolean;
    onclose: () => void;
  }
  let { open, onclose }: Props = $props();

  const player = usePlayer();
  const app = useAppState();
  const exporter = useExporter();
  const assets = useAssets();

  let dialog: HTMLDialogElement | undefined = $state();
  const choices = new ExportChoices();
  let codecs = $state<ExportCodecs | null>(null);

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  $effect(() => saveExportOptions($state.snapshot(choices.options)));

  const aspect = $derived(app.settings.aspect);
  const fitted = $derived(fitOptions(choices.options, aspect));
  const format = $derived(resolveFormat(fitted, aspect));
  const mode = $derived(app.settings.visualMode);
  const sound = $derived(app.sound);
  const plan = $derived(
    exportPlan(
      { tracks: app.tracks, currentId: app.currentId },
      fitted,
      choices.skipped,
      sound,
      (id) => player.fileFor(id)?.lastModified ?? 0,
    ),
  );
  const { chosen, parts, perTrack, soundOnly, seconds } = $derived(plan);

  // Which codecs this browser will use (EX-04), checked whenever the format changes.
  $effect(() => {
    if (!open) return;
    const wanted = format;
    let stale = false;
    codecs = null;
    choices.problem = null;
    exporter
      .probe(wanted)
      .then((result) => {
        if (!stale) codecs = result;
      })
      .catch((error: unknown) => {
        if (!stale) choices.problem = errorMessage(error);
      });
    return () => (stale = true);
  });

  async function saveTarget(fileName: string, container: 'mp4' | 'webm' | 'wav') {
    if (!canPickFile()) return null;
    return pickFile(fileName, container);
  }

  async function start() {
    choices.problem = null;
    if (parts.length === 0 || (!soundOnly && (!codecs || mode === 'analysis'))) return;
    const tracks = chosen;
    const planned = parts;
    const files = tracks.map((entry) => player.fileFor(entry.id));
    const unread = tracks.filter((_, index) => !files[index]).map((entry) => shownTitle(entry));
    if (unread.length > 0) {
      choices.problem = `${namesOf(unread)} cannot be read; add the file to the queue again.`;
      return;
    }
    // The track overlay names each track over the part the video plays (LS-18, LS-19).
    const overlay = app.settings.overlay;
    // The cover art as the logo (LS-15), and its colours (VE-12).
    const coverLogo = !soundOnly && mode === 'logoSpectrum' && app.settings.coverLogo;
    const coverColors = !soundOnly && app.settings.coverColors;
    const visuals: ExportVisuals = {
      ...visualsOf(mode === 'kaleidoscope' ? 'kaleidoscope' : 'logoSpectrum'),
      overlay: overlay.on ? overlay : undefined,
      coverLogo,
      coverColors,
    };
    const covered = coverLogo || coverColors;
    const container = soundOnly ? 'wav' : codecs!.container;
    const each = perTrack;
    const fileName = videoFileName(planned, container, sound);
    // Where the video goes: a file you pick (Chromium) or a download; for a video of each
    // track, a folder you pick (Chromium) or browser storage.
    let destination: FileSystemFileHandle | null = null;
    let folder: FileSystemDirectoryHandle | null = null;
    try {
      if (each) folder = canPickFolder() ? await pickFolder() : null;
      else destination = await saveTarget(fileName, container);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        choices.problem = errorMessage(error);
      }
      return;
    }
    // The covers, read after the save dialog, which needs the click.
    const covers = await Promise.all(
      tracks.map((entry) => {
        const cover = covered ? shownCover(entry) : null;
        return cover
          ? fetch(cover)
              .then((response) => response.blob())
              .catch(() => null)
          : null;
      }),
    );
    // Each track's look (PR-06), where it is of the video's mode.
    const looks = tracks.map((entry) =>
      !soundOnly && entry.look?.mode === mode ? lookSettings(entry.look) : null,
    );
    const requested: RequestPart[] = tracks.map((entry, index) => ({
      part: {
        ...planned[index]!,
        loudness: player.analysisOf(entry)?.loudness ?? null,
        ...(looks[index] ? { look: looks[index] } : {}),
      },
      file: files[index]!,
      grid: player.analysisOf(entry)?.grid ?? null,
      cover: covers[index] ?? null,
    }));
    player.pause();
    const common = {
      format,
      visuals,
      sound,
      fade: fitted.fade,
      images: soundOnly ? { background: null, logo: null } : assets.shown,
      soundOnly,
    };
    const started = each
      ? exporter.startBatch(
          requested.map((part) => ({
            ...common,
            parts: [part],
            fileName: videoFileName([part.part], container, sound),
          })),
          folder,
        )
      : exporter.start({ ...common, parts: requested, destination, fileName });
    started.catch((error: unknown) => (choices.problem = errorMessage(error)));
  }

  /** The visuals of the video: the current settings, and the preset switching if it is on. */
  function visualsOf(mode: 'logoSpectrum' | 'kaleidoscope'): ExportVisuals {
    const config = app.settings.autoPresets;
    const favourites = app.settings.favourites;
    if (mode === 'kaleidoscope') {
      const presets = switchingPool(
        BUILT_IN_KALEIDO_PRESETS,
        $kaleidoPresets,
        favourites.kaleidoscope,
        config.pool,
      );
      return {
        mode,
        settings: app.kaleido,
        auto: config.on ? { config, presets } : undefined,
        reduceFlashing: app.settings.reduceFlashing,
      };
    }
    const presets = switchingPool(
      BUILT_IN_PRESETS,
      $logoSpectrumPresets,
      favourites.logoSpectrum,
      config.pool,
    );
    // The Kaleidoscope behind (VE-08), if a look of the video shows it.
    const looks = config.on ? [app.visuals, ...presets] : [app.visuals];
    const layered = looks.some((look) => look.backgroundSource === 'kaleidoscope');
    return {
      mode,
      settings: app.visuals,
      auto: config.on ? { config, presets } : undefined,
      reduceFlashing: app.settings.reduceFlashing,
      layer: layered ? app.kaleido : undefined,
    };
  }

  /** Continues the stored export (after a reload, a crash or a failure). */
  async function resume() {
    choices.problem = null;
    const manifest: ExportManifest | null = await readManifest();
    if (!manifest || manifest.progress.finished) return;
    let files: (File | null)[] = manifest.parts.map(() => null);
    if (!manifest.progress.audioDone) {
      // The audio pass starts again: it needs the files of the tracks, from the queue.
      files = manifest.parts.map(({ source }) => {
        const match = app.tracks.find(
          (entry) => entry.fileName === source.name && entry.size === source.size,
        );
        return match ? player.fileFor(match.id) : null;
      });
      const missing = manifest.parts
        .filter((_, index) => !files[index])
        .map(({ source }) => source.name);
      if (missing.length > 0) {
        choices.problem = `Add ${namesOf([...new Set(missing)])} to the queue first, then resume.`;
        return;
      }
    }
    let destination: FileSystemFileHandle | null = null;
    try {
      // A video of a batch goes into the batch's folder, without asking again.
      const intoFolder = manifest.destination === 'file' && exporter.batchFolder !== null;
      if (!intoFolder) {
        const container = manifest.soundOnly ? 'wav' : manifest.codecs.container;
        destination = await saveTarget(manifest.fileName, container);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        choices.problem = errorMessage(error);
      }
      return;
    }
    player.pause();
    exporter
      .resume(files, destination)
      .catch((error: unknown) => (choices.problem = errorMessage(error)));
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
    <ExportProgress job={$exporter.job} />
  {:else if $exporter.status === 'done'}
    <ExportResult done={$exporter} />
  {:else if $exporter.status === 'interrupted' || ($exporter.status === 'failed' && $exporter.resumable)}
    <ExportResume stopped={$exporter} onresume={resume} />
  {:else}
    {#if $exporter.status === 'failed'}
      <p class="problem" role="alert">The export failed: {$exporter.message}</p>
      {#if $exporter.videos.length > 0}
        <p class="hint">Finished before, from the same batch:</p>
        <ExportVideos videos={$exporter.videos} />
      {/if}
    {/if}
    <section class="form">
      <ExportFormat {choices} {fitted} {format} {aspect} {soundOnly} />
      <ExportRange {choices} {fitted} {plan} />
      <ExportSummary {plan} {fitted} {format} {codecs} {mode} {sound} />
      {#if choices.problem}
        <p class="problem" role="alert">{choices.problem}</p>
      {/if}
      <div class="actions">
        <button
          class="primary"
          onclick={start}
          disabled={parts.length === 0 ||
            seconds <= 0 ||
            (!soundOnly && (!codecs || mode === 'analysis'))}
          data-testid="export-start"
        >
          <Icon name="export" size={16} />
          {soundOnly ? 'Save the sound' : 'Start export'}
        </button>
        <button onclick={onclose}>Close</button>
      </div>
    </section>
  {/if}
  {#if choices.problem && $exporter.status !== 'idle' && $exporter.status !== 'failed'}
    <p class="problem" role="alert">{choices.problem}</p>
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
  /* The parts of the dialog (export/) are styled here, as one form. */
  dialog :global {
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    h2 {
      margin: 0;
      font-size: var(--text-xl);
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
      font-size: var(--text-sm);
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
      font-size: var(--text-xs);
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
      font-size: var(--text-sm);
    }
    .aspects button.on {
      border-color: var(--accent);
      background: color-mix(in srgb, var(--accent) 20%, var(--surface-2));
    }
    label {
      font-size: var(--text-sm);
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
      font-size: var(--text-sm);
      color: var(--muted);
    }
    .tracks-head span {
      margin-right: auto;
    }
    .tracks-head button {
      padding: 2px 10px;
      font-size: var(--text-xs);
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
      font-size: var(--text-sm);
      white-space: pre-wrap;
      user-select: text;
    }
    .chapters .actions {
      margin-top: 8px;
    }
    .make {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 18px;
      margin-top: 10px;
    }
    .make label {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--text);
      cursor: pointer;
    }
    .make input {
      accent-color: var(--accent);
    }
    .videos {
      max-height: 220px;
      margin: 10px 0 0;
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }
    .videos li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 4px 0;
      border-bottom: 1px solid var(--border);
    }
    .videos .file {
      margin: 0;
    }
    .button.small {
      flex: none;
      padding: 3px 10px;
      font-size: var(--text-sm);
    }
    .summary {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 14px;
      margin: 0 0 12px;
      font-size: var(--text-sm);
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
    .content {
      display: flex;
      gap: 16px;
      margin-bottom: 12px;
      font-size: var(--text-md);
    }
    .content label {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .content label.on {
      font-weight: 600;
    }
    .notify {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
      font-size: var(--text-md);
    }
    .hint {
      margin: 8px 0 0;
      font-size: var(--text-sm);
      color: var(--muted);
    }
    .problem {
      margin: 10px 0 0;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid var(--fail);
      background: color-mix(in srgb, var(--fail) 15%, var(--surface));
      font-size: var(--text-md);
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
      font-size: var(--text-sm);
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
      font-size: var(--text-sm);
      font-variant-numeric: tabular-nums;
    }
    .big {
      margin: 0;
      font-size: var(--text-lg);
    }
  }
</style>
