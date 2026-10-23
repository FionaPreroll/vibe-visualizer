<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  /** An entry of a ⋯ menu: an action, or a switch (with `checked`). */
  export interface MoreMenuItem {
    label: string;
    icon: IconName;
    /** The key that does the same, shown at the right. */
    key?: string;
    /** A switch, on or off; an action has none. */
    checked?: boolean;
    disabled?: boolean;
    /** Shown at the right instead of the key, e.g. that a controller is connected. */
    note?: string;
    title?: string;
    testid: string;
    onselect: () => void;
  }
</script>

<script lang="ts">
  import Icon from './Icon.svelte';

  /**
   * A ⋯ menu: the actions used now and then, behind one button, so that the top bar fits narrower
   * windows and the presets leave room for the settings. Opens below its button, and follows it
   * when what holds it scrolls; closes on a choice, Escape, a click elsewhere, a resize, or when
   * its button scrolls out of sight. The arrow keys move between the entries.
   */
  let {
    items,
    dot = false,
    label = 'More',
    title,
    testid = 'more',
  }: {
    items: readonly MoreMenuItem[];
    /** A green dot on the button: a DJ controller is connected. */
    dot?: boolean;
    /** The name of the button and its menu. */
    label?: string;
    title: string;
    /** The button is `<testid>-button`, its menu `<testid>-menu`. */
    testid?: string;
  } = $props();

  let open = $state(false);
  let button: HTMLButtonElement;
  let menu = $state<HTMLDivElement>();
  let position = $state({ top: 0, right: 0 });

  function toggle() {
    if (open) return close();
    place();
    open = true;
    queueMicrotask(() => menu?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
  }

  /** Puts the menu below its button. */
  function place() {
    const rect = button.getBoundingClientRect();
    position = { top: rect.bottom + 6, right: window.innerWidth - rect.right };
  }

  /** The menu stays with its button while the side panel scrolls, until the button is hidden. */
  function follow() {
    if (!open) return;
    if (inSight(button)) place();
    else close();
  }

  /** Whether `element` shows in each box around it that scrolls or clips, and in the window. */
  function inSight(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    for (let box = element.parentElement; box; box = box.parentElement) {
      if (getComputedStyle(box).overflowY === 'visible') continue;
      const { top, bottom } = box.getBoundingClientRect();
      if (rect.bottom <= top || rect.top >= bottom) return false;
    }
    return rect.bottom > 0 && rect.top < window.innerHeight;
  }

  function close() {
    open = false;
  }

  /**
   * Does what the entry says. From the keyboard (a click without a count), the ⋯ takes the focus
   * back first, so that a dialog the entry opens can take it and give it back to the ⋯.
   */
  function choose(item: MoreMenuItem, event: MouseEvent) {
    close();
    if (event.detail === 0) button.focus();
    item.onselect();
  }

  /** Tab out of the open menu closes it. */
  function onFocusOut(event: FocusEvent) {
    const next = event.relatedTarget;
    if (open && next instanceof Node && !button.contains(next) && !menu?.contains(next)) close();
  }

  function onKey(event: KeyboardEvent) {
    if (!open) return;
    // The open menu keeps its keys: Space and Enter choose, they do not play or pause.
    if ([' ', 'Enter', 'Escape', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.stopPropagation();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      button.focus();
      return;
    }
    const entries = [...(menu?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
    if (entries.length === 0) return;
    const at = entries.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'ArrowDown'
        ? (at + 1) % entries.length
        : event.key === 'ArrowUp'
          ? (at - 1 + entries.length) % entries.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? entries.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    entries[next]?.focus();
  }

  function onOutside(event: PointerEvent) {
    const target = event.target as Node;
    if (open && !button.contains(target) && !menu?.contains(target)) close();
  }
</script>

<svelte:window onpointerdown={onOutside} onresize={close} onscrollcapture={follow} />

<span class="more" role="presentation" onkeydown={onKey} onfocusout={onFocusOut}>
  <button
    bind:this={button}
    class="toggle"
    class:on={open}
    onclick={toggle}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={label}
    {title}
    data-testid="{testid}-button"
  >
    <Icon name="more" size={18} />
    {#if dot}<span class="dot" data-testid="more-dot"></span>{/if}
  </button>
  {#if open}
    <div
      bind:this={menu}
      class="menu"
      role="menu"
      tabindex="-1"
      aria-label={label}
      style:top="{position.top}px"
      style:right="{position.right}px"
      data-testid="{testid}-menu"
    >
      {#each items as item (item.testid)}
        <button
          role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={item.checked}
          class:on={item.checked}
          disabled={item.disabled}
          title={item.title}
          onclick={(event) => choose(item, event)}
          data-testid={item.testid}
        >
          <Icon name={item.icon} size={16} />
          <span class="label">{item.label}</span>
          {#if item.note}
            <span class="note">{item.note}</span>
          {:else if item.checked !== undefined}
            <span class="check" aria-hidden="true">{item.checked ? '✓' : ''}</span>
          {/if}
          {#if item.key}<kbd>{item.key}</kbd>{/if}
        </button>
      {/each}
    </div>
  {/if}
</span>

<style>
  .more {
    display: contents;
  }
  .toggle {
    position: relative;
    display: flex;
    align-items: center;
    padding: 5px 10px;
    background: transparent;
    border-color: transparent;
    color: var(--muted);
  }
  .toggle:hover,
  .toggle.on {
    color: var(--text);
    border-color: var(--border);
  }
  .toggle.on {
    background: var(--surface-2);
  }
  .dot {
    position: absolute;
    top: 4px;
    right: 5px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #4ade80;
  }
  .menu {
    position: fixed;
    z-index: 50;
    display: flex;
    flex-direction: column;
    min-width: 240px;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.5);
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text);
    font-size: 13px;
    text-align: left;
    white-space: nowrap;
  }
  .menu button:disabled {
    color: var(--muted);
  }
  .menu button:hover:not(:disabled),
  .menu button:focus-visible {
    background: var(--surface-2);
  }
  .label {
    flex: 1;
  }
  .check,
  .note {
    font-size: 12px;
    color: var(--accent-2);
  }
  .check {
    width: 1em;
    text-align: center;
  }
  kbd {
    min-width: 1.6em;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font: 11px var(--mono);
    color: var(--muted);
    text-align: center;
  }
</style>
