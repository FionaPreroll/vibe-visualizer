<script lang="ts">
  import type { SoundSettings } from '../../core/audio/dsp/sound-settings';
  import type { ExportCodecs } from '../../core/export/export-job';
  import type { ExportPlan } from '../../core/export/export-plan';
  import { canPickFile, canPickFolder } from '../../core/export/exporter';
  import {
    estimateBytes,
    WAV_BYTES_PER_SECOND,
    type ExportOptions,
    type VideoFormat,
  } from '../../core/export/video-format';
  import type { VisualMode } from '../../core/state/app-state';
  import { shownCover, shownTitle } from '../../core/state/app-state';
  import { formatBytes, formatDuration } from '../../core/util/format';
  import { askForNotifications, notificationsAvailable } from '../export-notify';
  import { usePlayer } from '../player-context';
  import { codecLabel, hasColors, soundSummary, switchingSummary } from './export-words';
  import { useAppState } from '../app-state.svelte';

  /**
   * What the export will make, before it starts: the tracks, the visuals, the format and the
   * encoders (EX-04), the sound, the length and size, where it is saved; and whether to be told
   * when it is done.
   */
  let {
    plan,
    fitted,
    format,
    codecs,
    mode,
    sound,
  }: {
    plan: ExportPlan;
    /** The options fitted to the stage's aspect ratio. */
    fitted: ExportOptions;
    format: VideoFormat;
    /** The encoders this browser will use; null while they are checked. */
    codecs: ExportCodecs | null;
    mode: VisualMode;
    sound: SoundSettings;
  } = $props();

  const player = usePlayer();
  const app = useAppState();
  const { track, range: choice, chosen, perTrack, soundOnly, seconds } = $derived(plan);
  /** What the export makes, in the dialog's sentences. */
  const what = $derived(soundOnly ? 'sound' : 'video');

  /** The browser refused notifications when they were asked for. */
  let notifyRefused = $state(false);

  /** A notification when the export ends in the background: asked of the browser when turned on. */
  async function setNotify(event: Event & { currentTarget: HTMLInputElement }) {
    const box = event.currentTarget;
    notifyRefused = false;
    if (!box.checked) {
      player.updateSettings({ exportNotify: false });
      return;
    }
    const allowed = await askForNotifications();
    box.checked = allowed;
    notifyRefused = !allowed;
    player.updateSettings({ exportNotify: allowed });
  }
</script>

<dl class="summary">
  <dt>{choice !== 'tracks' ? 'Track' : perTrack ? 'Videos' : 'Tracks'}</dt>
  <dd data-testid="export-track">
    {#if choice === 'tracks' && chosen.length === 0}
      Choose them above
    {:else if perTrack}
      {chosen.length === 1 ? 'One video' : `${chosen.length} videos, one of each track`}
    {:else if choice === 'tracks'}
      {chosen.length} track{chosen.length === 1 ? '' : 's'}, from {shownTitle(chosen[0]!)}
    {:else}
      {track ? shownTitle(track) : 'Add a track to the queue first'}
    {/if}
  </dd>
  {#if !soundOnly}
    <dt>Visuals</dt>
    <dd>
      {#if mode === 'analysis'}
        Switch to Logo Spectrum or Kaleidoscope first
      {:else}
        {mode === 'kaleidoscope' ? 'Kaleidoscope' : 'Logo Spectrum'}, with the current settings
        {#if app.settings.autoPresets.on}
          <span data-testid="export-switching">({switchingSummary(app.settings.autoPresets)})</span>
        {/if}
        {#if app.settings.reduceFlashing}
          <span data-testid="export-calm">(flashing reduced)</span>
        {/if}
        {#if app.settings.overlay.on}
          <span data-testid="export-overlay"
            >({chosen.length > 1 ? 'with the titles' : "with the track's title"})</span
          >
        {/if}
        {#if mode === 'logoSpectrum' && app.settings.coverLogo && chosen.some(shownCover)}
          <span data-testid="export-cover"
            >({chosen.length > 1 ? 'the cover art as the logo' : 'its cover art as the logo'})</span
          >
        {/if}
        {#if app.settings.coverColors && chosen.some(hasColors)}
          <span data-testid="export-cover-colors"
            >({chosen.length > 1 ? 'in the colours of the tracks' : "in the track's colours"})</span
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
  {/if}
  <dt>Sound</dt>
  <dd data-testid="export-sound">
    {soundSummary(sound)} (set in the Sound tab){soundOnly ? ' · WAV, 48 kHz, 16 bit' : ''}
  </dd>
  <dt>Length</dt>
  <dd data-testid="export-length">
    {formatDuration(seconds)}{perTrack && chosen.length > 1 ? ' in all' : ''} · about {formatBytes(
      soundOnly ? seconds * WAV_BYTES_PER_SECOND : estimateBytes(format, seconds),
    )}
  </dd>
  <dt>Saving</dt>
  <dd>
    {#if perTrack}
      {canPickFolder()
        ? `You choose a folder; each ${what} is written into it.`
        : `The ${what}s wait in browser storage; you download each when it is finished.`}
    {:else}
      {canPickFile()
        ? `You choose a file; the ${what} is written into it.`
        : `The ${what} downloads when it is finished.`}
    {/if}
  </dd>
</dl>
{#if codecs?.video === 'vp9' && !soundOnly}
  <p class="hint">This browser cannot encode H.264, so the video is a WebM file (VP9).</p>
{/if}
{#if notificationsAvailable()}
  <label class="notify">
    <input
      type="checkbox"
      checked={app.settings.exportNotify}
      onchange={setNotify}
      data-testid="export-notify"
    />
    Tell me when it is done, while I work in another tab
  </label>
  {#if notifyRefused}
    <p class="hint" data-testid="export-notify-refused">
      The browser does not allow notifications for this site; its site settings can allow them. The
      tab's title shows the progress all the same.
    </p>
  {/if}
{/if}
