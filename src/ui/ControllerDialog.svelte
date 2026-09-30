<script lang="ts">
  import type { MonitorEntry } from '../core/control/controller-service';
  import { useControllers } from './controller-context';
  import Icon from './Icon.svelte';

  /**
   * DJ controllers (CTL-03): connect one, see which devices the browser reports, what the
   * controls of the DDJ-FLX2 do, and every MIDI message in a monitor (to check a device).
   */
  interface Props {
    open: boolean;
    onclose: () => void;
  }
  let { open, onclose }: Props = $props();

  const controllers = useControllers();
  let dialog: HTMLDialogElement | undefined = $state();
  let copied = $state(false);

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  const STATUS: Record<string, string> = {
    off: 'Not connected',
    connecting: 'Connecting…',
    on: 'Connected',
    denied: 'The browser did not allow access to MIDI devices',
    unsupported: 'This browser has no Web MIDI',
  };

  const MAPPING: readonly [string, string][] = [
    ['PLAY/PAUSE', 'Play and pause; it lights while the music plays and blinks while paused'],
    ['CUE', 'Back to the in marker (or the start), and stop'],
    ['Pads (HOT CUE mode)', 'Hot cues 1–8: set one where the pad is dark, jump to it where lit'],
    ['SHIFT + pad', 'Delete the hot cue'],
    ['CFX', 'The DJ filter: low-pass to the left, high-pass to the right, off in the middle'],
    ['Tempo slider', 'The tempo, within the range set in the Sound tab'],
    ['Channel fader', 'The volume'],
    ['Jog wheel', 'Nudge: faster or slower while it turns'],
  ];

  function describe(entry: MonitorEntry): string {
    return entry.control ?? (entry.known ? 'first half of a value' : 'not used');
  }

  async function copyMonitor() {
    const lines = $controllers.messages
      .map((entry) => `${entry.bytes}  ${describe(entry)}  ${entry.device}`)
      .reverse();
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // Clipboard blocked: the list stays readable on screen.
    }
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="controller-title"
  {onclose}
  onclick={(event) => event.target === dialog && onclose()}
  data-testid="controller-dialog"
>
  <header>
    <h2 id="controller-title">DJ controller</h2>
    <button class="close" onclick={onclose} aria-label="Close">
      <Icon name="close" size={18} />
    </button>
  </header>
  <div class="body">
    <p class="muted">
      Play the app from a DJ controller over USB. Supported so far: the Pioneer DJ DDJ-FLX2.
    </p>

    <div class="status">
      <span
        class="dot"
        class:on={$controllers.status === 'on'}
        class:bad={$controllers.status === 'denied' || $controllers.status === 'unsupported'}
      ></span>
      <span data-testid="controller-status">{STATUS[$controllers.status]}</span>
      {#if $controllers.status === 'on'}
        <button onclick={() => controllers.disconnect()} data-testid="controller-disconnect">
          Disconnect
        </button>
      {:else if $controllers.status !== 'unsupported'}
        <button
          class="primary"
          disabled={$controllers.status === 'connecting'}
          onclick={() => void controllers.connect()}
          data-testid="controller-connect"
        >
          Connect
        </button>
      {/if}
    </div>

    {#if $controllers.status === 'unsupported'}
      <p class="hint">
        Use Chrome or Edge. Firefox works too; it asks to install a small add-on that allows MIDI
        for this site.
      </p>
    {:else if $controllers.status === 'denied'}
      <p class="hint">
        Allow MIDI devices for this site in the browser (the icon next to the address), then connect
        again.
      </p>
    {:else if $controllers.status === 'on'}
      {#if $controllers.devices.length === 0}
        <p class="hint">
          No MIDI device found. Plug the controller in; it shows up here. On Windows, close other DJ
          software first: only one program can use a MIDI device there.
        </p>
      {:else}
        <ul class="devices" data-testid="controller-devices">
          {#each $controllers.devices as device (device.id)}
            <li>
              <strong>{device.name}</strong>
              <span class="muted">{device.profile ? device.profile.name : 'not supported yet'}</span
              >
            </li>
          {/each}
        </ul>
      {/if}
    {/if}

    <h3>Pioneer DJ DDJ-FLX2, deck 1</h3>
    <table>
      <tbody>
        {#each MAPPING as [control, action] (control)}
          <tr><th scope="row">{control}</th><td>{action}</td></tr>
        {/each}
      </tbody>
    </table>
    <p class="muted">
      Knobs and faders take over once they reach the app's value, so nothing jumps. Deck 2, the EQ
      knobs and the crossfader do nothing yet.
    </p>

    <details data-testid="controller-monitor">
      <summary>MIDI monitor</summary>
      <p class="muted">
        Every message the browser receives, newest first. If a control does not do what it should,
        copy the list and send it with your bug report.
      </p>
      <div class="actions">
        <button onclick={() => void copyMonitor()} disabled={$controllers.messages.length === 0}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          onclick={() => controllers.clearMonitor()}
          disabled={$controllers.messages.length === 0}
        >
          Clear
        </button>
      </div>
      <ol class="monitor">
        {#each $controllers.messages as entry (entry.id)}
          <li>
            <code>{entry.bytes}</code>
            <span class:muted={!entry.control}>{describe(entry)}</span>
          </li>
        {:else}
          <li class="muted">No messages yet.</li>
        {/each}
      </ol>
    </details>
  </div>
</dialog>

<style>
  dialog {
    width: min(620px, 94vw);
    max-height: 90vh;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
  }
  dialog::backdrop {
    background: rgb(5 5 10 / 0.7);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px 12px 24px;
    border-bottom: 1px solid var(--border);
  }
  h2 {
    margin: 0;
    font-size: 20px;
  }
  h3 {
    margin: 18px 0 8px;
    font-size: 15px;
  }
  .close {
    padding: 4px;
    background: transparent;
    border-color: transparent;
  }
  .body {
    padding: 16px 24px 24px;
    overflow-y: auto;
    line-height: 1.5;
  }
  p {
    margin: 0 0 10px;
  }
  .muted {
    color: var(--muted);
  }
  .hint {
    color: var(--warning);
  }
  .status {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 6px 0 12px;
  }
  .status button {
    margin-left: auto;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--muted);
  }
  .dot.on {
    background: #4ade80;
  }
  .dot.bad {
    background: var(--warning);
  }
  .devices {
    margin: 0 0 8px;
    padding-left: 18px;
  }
  .devices li {
    display: flex;
    gap: 10px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  th,
  td {
    padding: 5px 0;
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
  }
  th {
    width: 38%;
    padding-right: 12px;
    font-weight: 600;
  }
  table + p {
    margin-top: 10px;
    font-size: 13px;
  }
  details {
    margin-top: 14px;
  }
  summary {
    cursor: pointer;
    font-weight: 600;
  }
  details p {
    margin-top: 8px;
    font-size: 13px;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  }
  .monitor {
    max-height: 220px;
    margin: 0;
    padding: 8px 10px;
    overflow-y: auto;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-2);
    font-size: 12px;
  }
  .monitor li {
    display: flex;
    gap: 12px;
  }
  .monitor code {
    min-width: 7.5em;
    font: 12px var(--mono);
  }
</style>
