<script lang="ts">
  import { chapterProblem } from '../../core/export/export-job';
  import type { ExportPlan } from '../../core/export/export-plan';
  import type { ExportOptions } from '../../core/export/video-format';
  import { shownArtist, shownTitle } from '../../core/state/app-state';
  import { formatDuration } from '../../core/util/format';
  import type { ExportChoices } from './export-choices.svelte';
  import { rangeLabel } from './export-words';

  /**
   * What the export plays: the whole track, the part between its markers (TR-09), or tracks of
   * the queue (EX-05) as one video with chapters (EX-14) or a video of each (EX-09).
   */
  let {
    choices,
    fitted,
    plan,
  }: {
    choices: ExportChoices;
    /** The options fitted to the stage's aspect ratio. */
    fitted: ExportOptions;
    plan: ExportPlan;
  } = $props();

  const options = $derived(choices.options);
  const skipped = $derived(choices.skipped);
  const {
    track,
    marked,
    ready,
    range: choice,
    chosen,
    perTrack,
    seconds,
    chapters,
  } = $derived(plan);
</script>

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
          ? 'Several tracks: add more to the queue first'
          : 'One video of them all, with chapters, or a video of each'}
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
                event.currentTarget.checked ? skipped.delete(entry.id) : skipped.add(entry.id)}
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
    <div class="make" role="radiogroup" aria-label="Make">
      <label>
        <input
          type="radio"
          name="make"
          checked={!fitted.perTrack}
          onchange={() => (options.perTrack = false)}
          data-testid="export-one-video"
        />
        One video of them all
      </label>
      <label>
        <input
          type="radio"
          name="make"
          checked={fitted.perTrack}
          onchange={() => (options.perTrack = true)}
          data-testid="export-per-track"
        />
        A video of each
      </label>
    </div>
    <p class="hint">
      {#if perTrack}
        Each between its markers, one video after the other, each named after its track, e.g. to
        upload them one by one.
      {:else}
        In the order of the queue, each between its markers, joined as the player joins them.
        {#if chapters.length > 0}
          {chapterProblem(chapters, seconds) ??
            'The finished video comes with chapters for its description on YouTube.'}
        {/if}
      {/if}
    </p>
  {/if}
</fieldset>
