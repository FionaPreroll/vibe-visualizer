<script lang="ts">
  import type { BeatGrid } from '../core/analysis/beat-grid';
  import { gridTempo } from '../core/analysis/grid-beats';
  import { sectionTempos } from '../core/analysis/tempo-sections';
  import { shownTitle, type Track } from '../core/state/app-state';
  import { usePlayer } from './player-context';
  import TempoMenu from './TempoMenu.svelte';

  /**
   * The tempo of a queue entry, from its beat grid, correctable (TMP-06): a grid that changes
   * tempo shows each tempo ("178 · 119") and can be held at one of them for the whole track; and
   * the tempo can be fixed, for a straight grid throughout (TR-12).
   */
  let { track, grid, pending }: { track: Track; grid: BeatGrid; pending: boolean } = $props();

  const player = usePlayer();
  const tempo = $derived(gridTempo(grid));
  /** The grid's tempos, the main one first (more than one where the grid changes tempo). */
  const tempos = $derived(tempo > 0 ? sectionTempos(grid).slice(0, 3) : []);
  const label = $derived(
    tempo <= 0
      ? '– BPM'
      : tempos.length > 1
        ? tempos.map((bpm) => bpm.toFixed(0)).join(' · ')
        : `${tempo.toFixed(0)} BPM`,
  );
  const title = $derived(
    track.fixedTempo
      ? 'One tempo throughout (fixed): click to change'
      : track.tempo !== null
        ? 'Tempo set by hand: click to change'
        : tempos.length > 1
          ? `The beat grid changes tempo: ${tempos.map((bpm) => `${bpm.toFixed(0)} BPM`).join(', ')}. Click to correct`
          : 'Correct the tempo',
  );
</script>

<TempoMenu
  {tempo}
  {tempos}
  manual={track.tempo}
  {pending}
  warn={tempos.length > 1}
  {label}
  {title}
  name={shownTitle(track)}
  holdTitle="The whole track at this tempo"
  testid="queue-bpm"
  onchoose={(bpm) => player.setTempo(track.id, bpm)}
  fixed={track.fixedTempo}
  onfixed={(fixed) => player.setFixedTempo(track.id, fixed)}
/>
