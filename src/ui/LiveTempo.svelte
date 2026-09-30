<script lang="ts">
  import { onMount } from 'svelte';
  import { F } from '../core/analysis/features';
  import { usePlayer } from './player-context';
  import TempoMenu from './TempoMenu.svelte';

  /**
   * The tempo of the live input, from the live beat tracking, correctable (TMP-06): double,
   * half, 3/2 or 2/3 of it, held where it is, typed or tapped; the tracking then keeps close to
   * that tempo until it is set to automatic again. The tempo range (AN-12) applies too.
   */
  const player = usePlayer();
  const app = player.store;
  /** Beats less sure than this show no tempo. */
  const SURE = 0.3;

  /** The tempo heard now, or 0 while the beat is unclear. */
  let tempo = $state(0);

  onMount(() => {
    const frame = new Float32Array(F.size);
    const timer = setInterval(() => {
      const engine = player.engine;
      const heard = engine.started && engine.timeline.sample(engine.audibleFrame(), frame) !== null;
      tempo = heard && frame[F.beatConfidence]! >= SURE ? frame[F.bpm]! : 0;
    }, 250);
    return () => clearInterval(timer);
  });

  const manual = $derived($app.live.tempo);
</script>

<TempoMenu
  {tempo}
  tempos={tempo > 0 ? [tempo] : []}
  {manual}
  label={tempo > 0 ? `${tempo.toFixed(0)} BPM` : '– BPM'}
  title={manual !== null
    ? `The beat tracking keeps close to ${manual.toFixed(0)} BPM: click to change`
    : 'Correct the tempo of the live input'}
  name="the live input"
  holdTitle="The beat tracking keeps close to this tempo"
  testid="live-bpm"
  onchoose={(bpm) => player.setLiveTempo(bpm)}
/>
