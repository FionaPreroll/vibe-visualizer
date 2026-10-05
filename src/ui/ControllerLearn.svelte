<script lang="ts">
  import type { ControlBinding, ControllerProfile } from '@fibestation/dj-controllers';
  import { LEARN_STEPS, type LearnStep } from '../core/control/learn-steps';
  import { useControllers } from './controller-context';

  /**
   * MIDI learn (CTL-04) in the DJ controller dialog: a controller the app does not know is taught
   * control by control, and kept as a profile of the user's, which can be exported and imported.
   * A report of everything it sent goes to the developer, so the controller can come with the app.
   */
  const controllers = useControllers();
  const learn = $derived($controllers.learn);
  const used = LEARN_STEPS.filter((step) => step.used);
  const more = LEARN_STEPS.filter((step) => !step.used);

  /**
   * The devices that can be taught: those the app has no profile for, or one of the user's (taught
   * again). A controller the app supports, such as the DDJ-FLX2, needs no teaching.
   */
  const teachable = $derived(
    $controllers.devices.filter(
      (device) => !device.profile || $controllers.profiles.includes(device.profile),
    ),
  );
  /** The device to teach: the one chosen, else the first. */
  let chosen = $state('');
  const deviceId = $derived(
    teachable.some((device) => device.id === chosen) ? chosen : (teachable[0]?.id ?? ''),
  );

  let name = $state('');
  let lights = $state(false);
  let note = $state<{ text: string; error: boolean } | null>(null);

  function start() {
    const device = $controllers.devices.find((entry) => entry.id === deviceId);
    if (!device) return;
    controllers.startLearning(device.id);
    const yours = $controllers.profiles.find((profile) => profile === device.profile);
    name = yours?.name ?? device.name;
    lights = !!yours?.lights?.length;
    note = null;
  }

  function describe(binding: ControlBinding | null | undefined): string {
    if (binding === undefined) return '';
    if (binding === null) return 'Nothing usable came: try again';
    const at = (byte: number) => byte.toString(16).toUpperCase().padStart(2, '0');
    if (binding.kind === 'button') {
      const data = typeof binding.data === 'number' ? at(binding.data) : '';
      return `${binding.message === 'control' ? 'Control change' : 'Note'} ${at(binding.status)} ${data}`;
    }
    if (binding.kind === 'absolute') {
      return `Control change ${at(binding.status)} ${at(binding.msb)}${binding.lsb !== undefined ? ' (14 bits)' : ''}${binding.invert ? ', reversed' : ''}`;
    }
    return `Control change ${at(binding.status)} ${at(binding.data)}, ${binding.encoding === 'offset64' ? '64 ± steps' : 'steps'}`;
  }

  function stepState(step: LearnStep): 'listening' | 'learned' | 'failed' | 'open' {
    if (learn?.listening === step.id) return 'listening';
    const binding = learn?.learned[step.id];
    if (binding === undefined) return 'open';
    return binding ? 'learned' : 'failed';
  }

  const learnedCount = $derived(
    learn ? Object.values(learn.learned).filter((binding) => binding).length : 0,
  );

  function save() {
    const profile = controllers.saveLearned(name, lights);
    note = profile
      ? { text: `Saved as “${profile.name}”: the controller works now.`, error: false }
      : { text: 'Teach it a control first.', error: true };
  }

  function download(fileName: string, text: string) {
    const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName.replace(/[\\/:*?"<>|]+/g, ' ').trim();
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function saveReport() {
    download(`${learn?.deviceName ?? 'Controller'} report.json`, controllers.report());
  }

  function exportProfile(profile: ControllerProfile) {
    download(`${profile.name} profile.json`, JSON.stringify(profile, null, 2));
  }

  async function importProfile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const profile = controllers.importProfile(await file.text());
      note = { text: `Imported “${profile.name}”.`, error: false };
    } catch (error) {
      note = { text: error instanceof Error ? error.message : String(error), error: true };
    }
  }
</script>

{#snippet stepRow(step: LearnStep)}
  {@const state = stepState(step)}
  <li data-testid="learn-step-{step.id}" data-state={state} class={state}>
    <span class="label">{step.label}</span>
    <span class="what">
      {#if state === 'listening'}
        {step.hint}
        {#if learn?.counts[step.id]}<span class="count">({learn.counts[step.id]} heard)</span>{/if}
      {:else}
        {describe(learn?.learned[step.id])}
      {/if}
    </span>
    {#if state === 'listening'}
      <button onclick={() => controllers.stopListening()}>Stop</button>
    {:else}
      <button onclick={() => controllers.listen(step.id)} data-testid="learn-listen-{step.id}">
        {state === 'open' ? 'Learn' : 'Again'}
      </button>
    {/if}
  </li>
{/snippet}

<section class="learn" data-testid="controller-learn">
  <h3>Another controller</h3>
  {#if !learn}
    <p class="muted">
      A controller the app does not know yet can be taught, control by control. Save a report of it
      too and send it to us, so that it can come with the app.
    </p>
    {#if $controllers.status === 'on' && teachable.length > 0}
      <div class="row">
        {#if teachable.length > 1}
          <select
            bind:value={chosen}
            aria-label="The controller to teach"
            data-testid="learn-device"
          >
            {#each teachable as device (device.id)}
              <option value={device.id} selected={device.id === deviceId}>{device.name}</option>
            {/each}
          </select>
        {/if}
        <button onclick={start} data-testid="learn-start">
          Teach the app {teachable.length > 1 ? 'this one' : teachable[0]?.name}
        </button>
      </div>
    {/if}
  {:else}
    <p class="muted">
      Click <strong>Learn</strong> next to a control, then use it on
      <strong>{learn.deviceName}</strong>; the app listens until it rests. Its controls do nothing
      meanwhile.
    </p>
    <ol class="steps">
      {#each used as step (step.id)}{@render stepRow(step)}{/each}
    </ol>
    <details>
      <summary>More controls, for the report</summary>
      <p class="muted">
        The app does not use these yet. Taught too, they make a full profile of the controller.
      </p>
      <ol class="steps">
        {#each more as step (step.id)}{@render stepRow(step)}{/each}
      </ol>
    </details>
    <div class="save">
      <label>
        Name
        <input bind:value={name} maxlength="120" data-testid="learn-name" />
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={lights} data-testid="learn-lights" />
        Light its buttons (most controllers light a button when they get its note back)
      </label>
      <div class="row">
        <button
          class="primary"
          onclick={save}
          disabled={learnedCount === 0}
          data-testid="learn-save"
        >
          Save
        </button>
        <button onclick={saveReport} data-testid="learn-report">Save a report…</button>
        <button onclick={() => controllers.endLearning()} data-testid="learn-done">Done</button>
      </div>
      <p class="muted small">
        The report holds what the controller sent, the names of the MIDI devices, and the version of
        the app and the browser; it stays on your computer until you send it.
      </p>
    </div>
  {/if}

  {#if $controllers.profiles.length > 0}
    <h4>Your controllers</h4>
    <ul class="profiles" data-testid="controller-profiles">
      {#each $controllers.profiles as profile (profile.id)}
        <li>
          <span class="label">{profile.name}</span>
          <span class="muted">{profile.ports.input}</span>
          <button onclick={() => exportProfile(profile)} data-testid="profile-export">Export</button
          >
          <button
            onclick={() => controllers.removeProfile(profile.id)}
            data-testid="profile-remove"
          >
            Remove
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <label class="import">
    <input
      type="file"
      accept=".json,application/json"
      onchange={importProfile}
      data-testid="profile-import"
    />
    <span>Import a profile…</span>
  </label>
  {#if note}
    <p class:error={note.error} class:ok={!note.error} role="status" data-testid="learn-note">
      {note.text}
    </p>
  {/if}
</section>

<style>
  .learn {
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }
  h3 {
    margin: 0 0 8px;
    font-size: 16px;
  }
  h4 {
    margin: 14px 0 6px;
    font-size: 14px;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 12px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .steps,
  .profiles {
    margin: 8px 0;
    padding: 0;
    list-style: none;
  }
  .steps li,
  .profiles li {
    display: grid;
    grid-template-columns: 9.5em 1fr auto;
    gap: 10px;
    align-items: center;
    padding: 4px 0;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
  }
  .profiles li {
    grid-template-columns: 1fr 1fr auto auto;
  }
  .label {
    font-weight: 600;
  }
  .what {
    font-family: var(--mono);
    font-size: 12px;
  }
  .listening .what {
    font-family: inherit;
    color: var(--accent);
  }
  .failed .what {
    color: var(--warning);
  }
  .count {
    color: var(--muted);
  }
  details {
    margin: 6px 0 10px;
  }
  summary {
    cursor: pointer;
    font-weight: 600;
  }
  .save {
    display: grid;
    gap: 8px;
  }
  .save label {
    display: grid;
    gap: 4px;
  }
  .save label.check {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .import {
    display: inline-flex;
    margin-top: 10px;
    cursor: pointer;
  }
  .import input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }
  .import span {
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .import:focus-within span {
    outline: 2px solid var(--accent);
  }
  .error {
    color: var(--warning);
  }
  .ok {
    color: #4ade80;
  }
</style>
