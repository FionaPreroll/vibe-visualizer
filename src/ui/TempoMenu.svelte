<script lang="ts">
  import { TEMPO_HINT_RANGE } from '../core/analysis/beat-grid';
  import type { Track } from '../core/state/app-state';
  import { usePlayer } from './player-context';

  /**
   * The tempo of a queue entry, from its beat grid, with a menu to correct it (TMP-06): double,
   * half, 3/2 or 2/3 of it for tracks the grid reads at a related tempo, or back to the tempo
   * the grid finds itself.
   */
  let { track, tempo, pending }: { track: Track; tempo: number; pending: boolean } = $props();

  const player = usePlayer();
  let open = $state(false);
  let button: HTMLButtonElement;
  let menu = $state<HTMLDivElement>();
  let position = $state({ top: 0, right: 0 });

  const CHOICES = [
    { factor: 2, label: '× 2', id: 'double' },
    { factor: 1 / 2, label: '÷ 2', id: 'half' },
    { factor: 3 / 2, label: '× 1.5', id: 'three-halves' },
    { factor: 2 / 3, label: '÷ 1.5', id: 'two-thirds' },
  ] as const;

  /** The tempo the choices start from: the one set, or the grid's. */
  const base = $derived(track.tempo ?? tempo);

  function inRange(bpm: number): boolean {
    return bpm >= TEMPO_HINT_RANGE.min && bpm <= TEMPO_HINT_RANGE.max;
  }

  function toggle() {
    if (open) return close();
    const rect = button.getBoundingClientRect();
    position = { top: rect.bottom + 4, right: window.innerWidth - rect.right };
    open = true;
    queueMicrotask(() => menu?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
  }

  function close() {
    open = false;
  }

  /** Sets the tempo; from the keyboard (a click without a count), the badge keeps the focus. */
  function choose(bpm: number | null, event: MouseEvent) {
    player.setTempo(track.id, bpm);
    close();
    if (event.detail === 0) button.focus();
  }

  function onKey(event: KeyboardEvent) {
    // The queue entry must not see Enter (it plays the track) or Delete (it removes it); the
    // open menu keeps its keys. Space goes on to the app while the menu is closed (play/pause).
    const menuKey = open && [' ', 'Escape', 'ArrowDown', 'ArrowUp'].includes(event.key);
    if (menuKey || ['Enter', 'Delete', 'Backspace'].includes(event.key)) event.stopPropagation();
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
      button.focus();
    } else if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const items = [...(menu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
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
    class:manual={track.tempo !== null}
    class:pending
    onclick={(event) => {
      event.stopPropagation();
      toggle();
    }}
    aria-haspopup="menu"
    aria-expanded={open}
    title={track.tempo !== null ? 'Tempo set by hand: click to change' : 'Correct the tempo'}
    data-testid="queue-bpm"
    data-pending={pending}
  >
    {tempo.toFixed(0)} BPM
  </button>
  {#if open}
    <div
      bind:this={menu}
      class="menu"
      role="menu"
      tabindex="-1"
      aria-label="Tempo of {track.title}"
      style:top="{position.top}px"
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
      <button
        role="menuitem"
        disabled={track.tempo === null}
        onclick={(event) => {
          event.stopPropagation();
          choose(null, event);
        }}
        data-testid="tempo-auto"
      >
        <span>Automatic</span>
        <span class="value">as found</span>
      </button>
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
  }
  .bpm:hover {
    border-color: var(--border);
    color: var(--text);
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
    min-width: 170px;
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
</style>
