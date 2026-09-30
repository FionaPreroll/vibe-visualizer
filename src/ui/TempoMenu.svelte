<script lang="ts">
  import {
    TEMPO_HINT_RANGE,
    TEMPO_RANGE_IDS,
    TEMPO_RANGES,
    type TempoRangeId,
  } from '../core/analysis/beat-grid';
  import { sameTempo } from '../core/library/analysis-cache';
  import { usePlayer } from './player-context';

  /**
   * A tempo badge with a menu to correct the tempo (TMP-06): double, half, 3/2 or 2/3 of it for
   * music read at a related tempo; hold one of `tempos`; a tempo typed or tapped; or back to the
   * tempo found. At the bottom, the tempo range the analysis looks in (AN-12). For a queue entry
   * (TrackTempo) and for the live input (LiveTempo).
   */
  let {
    tempo,
    tempos,
    manual,
    pending = false,
    warn = false,
    label,
    title,
    name,
    holdTitle,
    testid,
    onchoose,
  }: {
    /** The tempo found (0 while unknown). */
    tempo: number;
    /** Tempos to hold, the main one first. */
    tempos: readonly number[];
    /** The tempo set by hand, or null. */
    manual: number | null;
    /** The tempo is being found anew. */
    pending?: boolean;
    /** Something to look at (a grid that changes tempo). */
    warn?: boolean;
    label: string;
    title: string;
    /** What the tempo belongs to, for the menu's label. */
    name: string;
    /** What holding a tempo does. */
    holdTitle: string;
    testid: string;
    onchoose: (bpm: number | null) => void;
  } = $props();

  const player = usePlayer();
  const app = player.store;
  let open = $state(false);
  let button: HTMLButtonElement;
  let menu = $state<HTMLDivElement>();
  /** Where the menu opens: below the badge, or above it in the lower half of the window. */
  let position = $state<{ top: number | null; bottom: number | null; right: number }>({
    top: 0,
    bottom: null,
    right: 0,
  });
  /** The tempo typed or tapped, as typed. */
  let typed = $state('');
  let taps: number[] = [];

  const CHOICES = [
    { factor: 2, label: '× 2', id: 'double' },
    { factor: 1 / 2, label: '÷ 2', id: 'half' },
    { factor: 3 / 2, label: '× 1.5', id: 'three-halves' },
    { factor: 2 / 3, label: '÷ 1.5', id: 'two-thirds' },
  ] as const;
  const RANGE_LABELS: Record<TempoRangeId, string> = {
    auto: 'Auto',
    slow: range('slow'),
    mid: range('mid'),
    fast: range('fast'),
  };
  /** Taps further apart than this start a new count. */
  const TAP_GAP_MS = 2000;
  const TAPS_KEPT = 16;

  function range(id: TempoRangeId): string {
    return `${TEMPO_RANGES[id].min}–${TEMPO_RANGES[id].max}`;
  }

  /** The tempo the choices start from: the one set, or the one found. */
  const base = $derived(manual ?? tempo);
  const typedBpm = $derived(Number(typed.replace(',', '.')));
  const typedValid = $derived(typed.trim() !== '' && inRange(typedBpm));

  function inRange(bpm: number): boolean {
    return bpm >= TEMPO_HINT_RANGE.min && bpm <= TEMPO_HINT_RANGE.max;
  }

  function toggle() {
    if (open) return close();
    const rect = button.getBoundingClientRect();
    const above = rect.top > window.innerHeight / 2;
    position = {
      top: above ? null : rect.bottom + 4,
      bottom: above ? window.innerHeight - rect.top + 4 : null,
      right: window.innerWidth - rect.right,
    };
    typed = '';
    taps = [];
    open = true;
    queueMicrotask(() => menu?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
  }

  function close() {
    open = false;
  }

  /** Sets the tempo; from the keyboard (a click without a count), the badge keeps the focus. */
  function choose(bpm: number | null, event: MouseEvent | KeyboardEvent) {
    onchoose(bpm);
    close();
    if (!(event instanceof MouseEvent) || event.detail === 0) button.focus();
  }

  function chooseRange(id: TempoRangeId, event: MouseEvent) {
    player.updateSettings({ bpmRange: id });
    close();
    if (event.detail === 0) button.focus();
  }

  /** A tap: the tempo of the taps so far (from the first to the last), once there are two. */
  function tap() {
    const now = performance.now();
    const last = taps[taps.length - 1];
    if (last !== undefined && now - last > TAP_GAP_MS) taps = [];
    taps = [...taps, now].slice(-TAPS_KEPT);
    if (taps.length < 2) return;
    const interval = (taps[taps.length - 1]! - taps[0]!) / (taps.length - 1);
    typed = (60000 / interval).toFixed(1);
  }

  function onKey(event: KeyboardEvent) {
    // The queue entry must not see Enter (it plays the track) or Delete (it removes it); the
    // open menu keeps its keys. Space goes on to the app while the menu is closed (play/pause).
    const menuKey = open && [' ', 'Escape', 'ArrowDown', 'ArrowUp'].includes(event.key);
    if (menuKey || ['Enter', 'Delete', 'Backspace'].includes(event.key)) event.stopPropagation();
    const inField = event.target instanceof HTMLInputElement;
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
      button.focus();
    } else if (inField && event.key === 'Enter') {
      event.preventDefault();
      if (typedValid) choose(typedBpm, event);
    } else if (open && !inField && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const items = [
        ...(menu?.querySelectorAll<HTMLElement>('button:not(:disabled), input') ?? []),
      ];
      const at = items.indexOf(document.activeElement as HTMLElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    }
  }

  function onOutside(event: PointerEvent) {
    const target = event.target as Node;
    if (open && !button.contains(target) && !menu?.contains(target)) close();
  }
</script>

<svelte:window onpointerdown={onOutside} onresize={close} onscrollcapture={close} />

<span class="tempo" role="presentation" onkeydown={onKey} ondblclick={(e) => e.stopPropagation()}>
  <button
    bind:this={button}
    class="bpm"
    class:manual={manual !== null}
    class:changes={warn}
    class:pending
    onclick={(event) => {
      event.stopPropagation();
      toggle();
    }}
    aria-haspopup="menu"
    aria-expanded={open}
    {title}
    data-testid={testid}
    data-pending={pending}
  >
    {label}
  </button>
  {#if open}
    <div
      bind:this={menu}
      class="menu"
      role="menu"
      tabindex="-1"
      aria-label="Tempo of {name}"
      style:top={position.top === null ? null : `${position.top}px`}
      style:bottom={position.bottom === null ? null : `${position.bottom}px`}
      style:right="{position.right}px"
      data-testid="tempo-menu"
    >
      {#each CHOICES as choice (choice.id)}
        {@const bpm = base * choice.factor}
        <button
          role="menuitem"
          disabled={!inRange(bpm)}
          onclick={(event) => {
            event.stopPropagation();
            choose(bpm, event);
          }}
          data-testid="tempo-{choice.id}"
        >
          <span>{choice.label}</span>
          <span class="value">{bpm.toFixed(0)} BPM</span>
        </button>
      {/each}
      <div class="separator" role="separator"></div>
      {#each tempos as bpm, index (index)}
        <button
          role="menuitem"
          disabled={!inRange(bpm) || sameTempo(manual, Math.round(bpm * 100) / 100)}
          title={holdTitle}
          onclick={(event) => {
            event.stopPropagation();
            choose(bpm, event);
          }}
          data-testid="tempo-hold"
        >
          <span>Hold at</span>
          <span class="value">{bpm.toFixed(0)} BPM</span>
        </button>
      {/each}
      <div class="entry">
        <input
          type="text"
          inputmode="decimal"
          placeholder="BPM"
          bind:value={typed}
          onclick={(event) => event.stopPropagation()}
          aria-label="Tempo in BPM ({TEMPO_HINT_RANGE.min}–{TEMPO_HINT_RANGE.max})"
          title="Type the tempo, or tap it: then Enter or Set"
          data-testid="tempo-input"
        />
        <button
          role="menuitem"
          onclick={(event) => {
            event.stopPropagation();
            tap();
          }}
          title="Tap on every beat (click, or Space while it has the focus)"
          data-testid="tempo-tap">Tap</button
        >
        <button
          role="menuitem"
          disabled={!typedValid}
          onclick={(event) => {
            event.stopPropagation();
            choose(typedBpm, event);
          }}
          data-testid="tempo-set">Set</button
        >
      </div>
      <button
        role="menuitem"
        disabled={manual === null}
        onclick={(event) => {
          event.stopPropagation();
          choose(null, event);
        }}
        data-testid="tempo-auto"
      >
        <span>Automatic</span>
        <span class="value">as found</span>
      </button>
      <div class="separator" role="separator"></div>
      <div
        class="ranges"
        role="group"
        aria-label="Tempo range of the analysis"
        title="Where the analysis looks for the tempo: of every track without one set by hand, and of the live input without one. 120–200 for drum & bass"
      >
        <span class="caption">Tempo range, for all</span>
        <div class="range-buttons">
          {#each TEMPO_RANGE_IDS as id (id)}
            <button
              role="menuitemradio"
              aria-checked={$app.settings.bpmRange === id}
              class:on={$app.settings.bpmRange === id}
              onclick={(event) => {
                event.stopPropagation();
                chooseRange(id, event);
              }}
              data-testid="bpm-range-{id}">{RANGE_LABELS[id]}</button
            >
          {/each}
        </div>
      </div>
    </div>
  {/if}
</span>

<style>
  .tempo {
    display: contents;
  }
  .bpm {
    padding: 0 4px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    font-family: var(--mono);
    font-size: 10px;
    line-height: 16px;
    color: var(--muted);
    white-space: nowrap;
  }
  .bpm:hover {
    border-color: var(--border);
    color: var(--text);
  }
  .bpm.changes {
    color: var(--warning);
  }
  .bpm.manual {
    color: var(--accent-2);
  }
  .bpm.pending {
    animation: pulse 1s ease-in-out infinite alternate;
  }
  @keyframes pulse {
    to {
      opacity: 0.35;
    }
  }
  .menu {
    position: fixed;
    z-index: 50;
    display: flex;
    flex-direction: column;
    min-width: 200px;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.5);
  }
  .menu button {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 5px 8px;
    border: none;
    border-radius: 5px;
    background: transparent;
    font-size: 13px;
    text-align: left;
  }
  .menu button:hover:not(:disabled),
  .menu button:focus-visible {
    background: var(--surface-2);
  }
  .value {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
  }
  .separator {
    height: 1px;
    margin: 4px 2px;
    background: var(--border);
  }
  .entry {
    display: flex;
    gap: 4px;
    padding: 3px 4px;
  }
  .entry input {
    width: 0;
    flex: 1;
    min-width: 56px;
    padding: 3px 6px;
    font: 12px var(--mono);
  }
  .entry button {
    flex: none;
    padding: 4px 8px;
    border: 1px solid var(--border);
  }
  .ranges {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 2px 4px 4px;
  }
  .caption {
    font-size: 11px;
    color: var(--muted);
  }
  .range-buttons {
    display: flex;
    gap: 3px;
  }
  .range-buttons button {
    flex: 1;
    justify-content: center;
    padding: 3px 4px;
    border: 1px solid var(--border);
    font: 11px var(--mono);
    white-space: nowrap;
  }
  .range-buttons button.on {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
