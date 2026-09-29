<script lang="ts">
  import { onMount } from 'svelte';
  import { F } from '../core/analysis/features';
  import { djFilterCutoff } from '../core/audio/dsp/dj-filter';
  import {
    DEFAULT_SOUND,
    DELAY_DIVISIONS,
    DELAY_FEELS,
    rateLimits,
    SOUND_PRESETS,
    SOUND_RANGES,
    syncedDelaySeconds,
    TEMPO_RANGES,
    TEMPO_STEP,
    type DelayDivision,
    type DelayFeel,
    type SoundSettings,
    type TempoMode,
    type TempoRange,
  } from '../core/audio/dsp/sound-settings';
  import { percent, seconds } from './controls/format';
  import Section from './controls/Section.svelte';
  import Slider from './controls/Slider.svelte';
  import { usePlayer } from './player-context';

  /**
   * Tempo and effects (TMP-01…04, FX-01…06, FX-10): one-click edits, the tempo fader with
   * vinyl or key lock, the DJ filter, delay and reverb. Everything also applies to exports.
   */
  const player = usePlayer();
  const app = player.store;
  const sound = $derived($app.sound);
  const limits = $derived(rateLimits(sound.tempoRange));
  const activePreset = $derived(
    SOUND_PRESETS.find((preset) => same(preset.settings, sound))?.name ?? null,
  );

  /** Tempo of what is heard, from the beat tracking (TMP-04); null while unsure. */
  let bpm = $state<number | null>(null);

  onMount(() => {
    const frame = new Float32Array(F.size);
    const timer = setInterval(() => {
      const engine = player.engine;
      const state = player.state;
      const heard =
        engine.started &&
        state.playing &&
        state.live.status !== 'on' &&
        engine.timeline.sample(engine.audibleFrame(), frame) !== null;
      bpm = heard && frame[F.beatConfidence]! >= 0.3 ? frame[F.bpm]! : null;
    }, 250);
    return () => clearInterval(timer);
  });

  function same(a: SoundSettings, b: SoundSettings): boolean {
    return (Object.keys(a) as (keyof SoundSettings)[]).every((key) => a[key] === b[key]);
  }

  function update(changes: Partial<SoundSettings>) {
    player.updateSound(changes);
  }

  const FEELS: Record<DelayFeel, string> = {
    straight: 'Straight',
    dotted: 'Dotted',
    triplet: 'Triplet',
  };

  function signedPercent(rate: number): string {
    const value = (rate - 1) * 100;
    if (Math.abs(value) < 0.05) return '0.0 %';
    return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1)} %`;
  }

  function frequency(hz: number): string {
    return hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${Math.round(hz)}`;
  }

  function filterLabel(value: number): string {
    if (value === 0) return 'Off';
    return `${value < 0 ? 'LP' : 'HP'} ${frequency(djFilterCutoff(value))}`;
  }

  function toneLabel(value: number): string {
    if (Math.abs(value) < 0.005) return 'Neutral';
    return `${value < 0 ? 'Dark' : 'Thin'} ${Math.round(Math.abs(value) * 100)}`;
  }

  /** Logarithmic sliders for times: 0…1 on the slider covers the range evenly by ratio. */
  function logScale([low, high]: readonly [number, number]) {
    return {
      toSlider: (value: number) => Math.log(value / low) / Math.log(high / low),
      fromSlider: (position: number) => low * (high / low) ** position,
    };
  }
  const delayTime = logScale(SOUND_RANGES.delayMs);
  const decayTime = logScale(SOUND_RANGES.reverbDecay);
  const milliseconds = (value: number) => `${Math.round(value)} ms`;

  // Nudging lasts while the button is held (TMP-03).
  let nudging = $state<-1 | 0 | 1>(0);
  function nudge(direction: -1 | 0 | 1) {
    if (nudging === direction) return;
    nudging = direction;
    player.nudge(direction);
  }
</script>

<section class="sound" aria-label="Sound">
  <div class="presets" role="group" aria-label="Sound presets">
    {#each SOUND_PRESETS as preset (preset.name)}
      <button
        aria-pressed={activePreset === preset.name}
        title={preset.hint}
        onclick={() => player.replaceSound(preset.settings)}
        data-testid="sound-preset"
      >
        {preset.name}
      </button>
    {/each}
  </div>

  <Section title="Tempo" open>
    <div class="readout">
      <output class="rate" data-testid="tempo-value">{signedPercent(sound.rate)}</output>
      <span class="bpm" data-testid="bpm">
        {#if bpm !== null}
          {bpm.toFixed(1)} BPM
          {#if Math.abs(sound.rate - 1) > 1e-6}
            <small>original {(bpm / sound.rate).toFixed(1)}</small>
          {/if}
        {:else}
          – BPM
        {/if}
      </span>
    </div>
    <input
      class="fader"
      type="range"
      min={limits[0]}
      max={limits[1]}
      step={TEMPO_STEP}
      value={sound.rate}
      oninput={(event) => update({ rate: Number(event.currentTarget.value) })}
      ondblclick={() => update({ rate: 1 })}
      aria-label="Tempo"
      aria-valuetext={signedPercent(sound.rate)}
      title="Double-click to reset"
      data-testid="tempo-fader"
    />
    <div class="row">
      <button
        class="square"
        onclick={() => player.stepTempo(-1)}
        aria-label="Slower by 0.1 %"
        title="Slower by 0.1 % (key -)"
      >
        −
      </button>
      <button
        class="square"
        onclick={() => player.stepTempo(1)}
        aria-label="Faster by 0.1 %"
        title="Faster by 0.1 % (key +)"
      >
        +
      </button>
      <button
        onclick={() => update({ rate: 1 })}
        disabled={sound.rate === 1}
        data-testid="tempo-reset"
      >
        Reset
      </button>
      <select
        value={sound.tempoRange}
        onchange={(event) =>
          update({ tempoRange: Number(event.currentTarget.value) as TempoRange })}
        aria-label="Tempo range"
        data-testid="tempo-range"
      >
        {#each TEMPO_RANGES as range (range)}
          <option value={range}>±{range} %</option>
        {/each}
      </select>
    </div>
    <div class="modes" role="radiogroup" aria-label="Tempo mode">
      {#each [['vinyl', 'Vinyl'], ['keylock', 'Key lock']] as const as [mode, label] (mode)}
        <label class:selected={sound.tempoMode === mode}>
          <input
            type="radio"
            name="tempo-mode"
            value={mode}
            checked={sound.tempoMode === mode}
            onchange={() => update({ tempoMode: mode as TempoMode })}
            data-testid={`tempo-mode-${mode}`}
          />
          {label}
        </label>
      {/each}
    </div>
    <p class="hint">
      {sound.tempoMode === 'vinyl'
        ? 'The pitch follows the speed, like a record.'
        : 'The pitch stays; only the tempo changes.'}
    </p>
    <div class="row nudge">
      <span>Nudge</span>
      {#each [[-1, '‹ Slower', 'nudge-slower', ','], [1, 'Faster ›', 'nudge-faster', '.']] as const as [direction, label, testId, key] (testId)}
        <button
          class:held={nudging === direction}
          onpointerdown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            nudge(direction);
          }}
          onpointerup={() => nudge(0)}
          onpointercancel={() => nudge(0)}
          onlostpointercapture={() => nudge(0)}
          onkeydown={(event) => {
            if (event.key === ' ' || event.key === 'Enter') nudge(direction);
          }}
          onkeyup={() => nudge(0)}
          onblur={() => nudge(0)}
          title={`${direction < 0 ? 'Slower' : 'Faster'} by 4 % while held (key ${key})`}
          data-testid={testId}
        >
          {label}
        </button>
      {/each}
    </div>
  </Section>

  <Section title="Filter" open>
    <Slider
      label="Filter"
      min={-1}
      max={1}
      step={0.01}
      value={sound.filter}
      defaultValue={0}
      format={filterLabel}
      onchange={(value) => update({ filter: Math.abs(value) < 0.02 ? 0 : value })}
    />
    <Slider
      label="Resonance"
      min={0}
      max={1}
      step={0.01}
      value={sound.filterResonance}
      defaultValue={DEFAULT_SOUND.filterResonance}
      format={percent}
      onchange={(value) => update({ filterResonance: value })}
    />
    <p class="hint">Left: low-pass, right: high-pass. The middle is off.</p>
  </Section>

  <Section title="Delay" open>
    <label class="check">
      <input
        type="checkbox"
        checked={sound.delayOn}
        onchange={(event) => update({ delayOn: event.currentTarget.checked })}
        data-testid="delay-on"
      />
      On
    </label>
    <label class="check">
      <input
        type="checkbox"
        checked={sound.delaySync}
        onchange={(event) => update({ delaySync: event.currentTarget.checked })}
      />
      In time with the beat
    </label>
    {#if sound.delaySync}
      <div class="row">
        <select
          value={sound.delayDivision}
          onchange={(event) =>
            update({ delayDivision: event.currentTarget.value as DelayDivision })}
          aria-label="Note value"
        >
          {#each DELAY_DIVISIONS as division (division)}
            <option value={division}>{division}</option>
          {/each}
        </select>
        <select
          value={sound.delayFeel}
          onchange={(event) => update({ delayFeel: event.currentTarget.value as DelayFeel })}
          aria-label="Feel"
        >
          {#each DELAY_FEELS as feel (feel)}
            <option value={feel}>{FEELS[feel]}</option>
          {/each}
        </select>
      </div>
      <p class="hint">
        {Math.round(syncedDelaySeconds(bpm ?? 120, sound.delayDivision, sound.delayFeel) * 1000)} ms at
        {bpm !== null ? `${Math.round(bpm)} BPM` : '120 BPM until the beat is found'}
      </p>
    {:else}
      <Slider
        label="Time"
        min={0}
        max={1}
        step={0.001}
        value={delayTime.toSlider(sound.delayMs)}
        format={(position) => milliseconds(delayTime.fromSlider(position))}
        defaultValue={delayTime.toSlider(DEFAULT_SOUND.delayMs)}
        onchange={(position) => update({ delayMs: Math.round(delayTime.fromSlider(position)) })}
      />
    {/if}
    <Slider
      label="Feedback"
      min={0}
      max={SOUND_RANGES.delayFeedback[1]}
      step={0.01}
      value={sound.delayFeedback}
      defaultValue={DEFAULT_SOUND.delayFeedback}
      format={percent}
      onchange={(value) => update({ delayFeedback: value })}
    />
    <Slider
      label="Tone"
      min={-1}
      max={1}
      step={0.01}
      value={sound.delayTone}
      defaultValue={0}
      format={toneLabel}
      onchange={(value) => update({ delayTone: Math.abs(value) < 0.02 ? 0 : value })}
    />
    <Slider
      label="Mix"
      min={0}
      max={1}
      step={0.01}
      value={sound.delayMix}
      defaultValue={DEFAULT_SOUND.delayMix}
      format={percent}
      onchange={(value) => update({ delayMix: value })}
    />
    <label class="check">
      <input
        type="checkbox"
        checked={sound.delayPingPong}
        onchange={(event) => update({ delayPingPong: event.currentTarget.checked })}
      />
      Ping-pong (echoes alternate left and right)
    </label>
  </Section>

  <Section title="Reverb" open>
    <label class="check">
      <input
        type="checkbox"
        checked={sound.reverbOn}
        onchange={(event) => update({ reverbOn: event.currentTarget.checked })}
        data-testid="reverb-on"
      />
      On
    </label>
    <Slider
      label="Size"
      min={0}
      max={1}
      step={0.01}
      value={sound.reverbSize}
      defaultValue={DEFAULT_SOUND.reverbSize}
      format={percent}
      onchange={(value) => update({ reverbSize: value })}
    />
    <Slider
      label="Decay"
      min={0}
      max={1}
      step={0.001}
      value={decayTime.toSlider(sound.reverbDecay)}
      defaultValue={decayTime.toSlider(DEFAULT_SOUND.reverbDecay)}
      format={(position) => seconds(decayTime.fromSlider(position))}
      onchange={(position) =>
        update({ reverbDecay: Math.round(decayTime.fromSlider(position) * 100) / 100 })}
    />
    <Slider
      label="Pre-delay"
      min={0}
      max={SOUND_RANGES.reverbPreDelay[1]}
      step={1}
      value={sound.reverbPreDelay}
      defaultValue={DEFAULT_SOUND.reverbPreDelay}
      format={milliseconds}
      onchange={(value) => update({ reverbPreDelay: value })}
    />
    <Slider
      label="Damping"
      min={0}
      max={1}
      step={0.01}
      value={sound.reverbDamping}
      defaultValue={DEFAULT_SOUND.reverbDamping}
      format={percent}
      onchange={(value) => update({ reverbDamping: value })}
    />
    <Slider
      label="Mix"
      min={0}
      max={1}
      step={0.01}
      value={sound.reverbMix}
      defaultValue={DEFAULT_SOUND.reverbMix}
      format={percent}
      onchange={(value) => update({ reverbMix: value })}
    />
  </Section>

  <p class="note">
    Tempo and effects apply to video exports too. The visuals react to the music after the tempo and
    the filter, before the echoes and the reverb.
  </p>
</section>

<style>
  .sound {
    display: flex;
    flex-direction: column;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }
  .presets button[aria-pressed='true'] {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 22%, var(--surface));
    color: var(--text);
  }
  .readout {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .rate {
    font: 600 22px var(--mono);
  }
  .bpm {
    font: 13px var(--mono);
    color: var(--muted);
  }
  .bpm small {
    margin-left: 4px;
    font-size: 11px;
  }
  .fader {
    width: 100%;
    margin: 6px 0;
    accent-color: var(--accent);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 2px 0;
  }
  .row select {
    flex: 1;
    min-width: 0;
  }
  .square {
    width: 32px;
    padding-left: 0;
    padding-right: 0;
    font-weight: 600;
  }
  .modes {
    display: flex;
    margin-top: 6px;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .modes label {
    flex: 1;
    padding: 6px 0;
    text-align: center;
    font-size: 13px;
    cursor: pointer;
    color: var(--muted);
  }
  .modes label.selected {
    background: color-mix(in srgb, var(--accent) 22%, var(--surface));
    color: var(--text);
  }
  .modes input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .modes label:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .nudge span {
    flex: 1;
    font-size: 13px;
    color: var(--muted);
  }
  .nudge button.held {
    border-color: var(--accent);
  }
  .hint {
    margin: 4px 0;
    font-size: 12px;
    color: var(--muted);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 0;
    font-size: 13px;
  }
  .note {
    margin: 12px 16px 16px;
    font-size: 12px;
    color: var(--muted);
  }
</style>
