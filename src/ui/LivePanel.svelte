<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { listInputDevices, liveInputSupport, type InputDevice } from '../core/audio/live-input';
  import { INPUT_GAIN_RANGE } from '../core/state/app-state';
  import Section from './controls/Section.svelte';
  import Slider from './controls/Slider.svelte';
  import Icon from './Icon.svelte';
  import LevelMeter from './LevelMeter.svelte';
  import { usePlayer } from './player-context';

  /**
   * Live input (IN-01…04): visualise music that plays somewhere else, from an audio input or
   * from another tab or app, with input gain, a level meter and optional monitoring.
   */
  const player = usePlayer();
  const app = player.store;
  const support = liveInputSupport();
  const live = $derived($app.live);
  const starting = $derived(live.status === 'starting');

  let devices = $state<InputDevice[]>([]);
  let chosen = $state(untrack(() => $app.settings.inputDevice));

  async function refresh() {
    devices = await listInputDevices().catch(() => []);
    // The input used last may have a new id in this session: find it by its name.
    const last = untrack(() => player.lastInputDevice);
    if (last && chosen === last.id && !devices.some((device) => device.id === chosen)) {
      const match = devices.find((device) => device.label === last.label);
      if (match) chosen = match.id;
    }
  }

  onMount(() => {
    void refresh();
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refresh);
  });

  // Once access was allowed, the inputs have names; the one in use is shown.
  $effect(() => {
    if (live.status !== 'on') return;
    void refresh();
    chosen = untrack(() => $app.settings.inputDevice);
  });

  /** The input in the picker: from the list, or the one used last (its id may be outdated). */
  function wanted(): InputDevice | null {
    if (!chosen) return null;
    const last = player.lastInputDevice;
    return (
      devices.find((device) => device.id === chosen) ??
      (last?.id === chosen ? last : { id: chosen, label: '' })
    );
  }

  async function startDevice() {
    await player.startLive('device', wanted());
  }

  function chooseDevice(id: string) {
    chosen = id;
    // A running input switches right away.
    if (live.status === 'on' && live.kind === 'device') void startDevice();
  }

  const decibels = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
</script>

<section class="live" aria-label="Live input">
  <p class="intro">
    Visualise music that plays somewhere else: a DJ mixer, a turntable, a music app or a browser
    tab. The visuals react to it instead of the queue.
  </p>

  {#if live.status === 'on'}
    <div class="status" data-testid="live-status" data-kind={live.kind}>
      <span class="dot" aria-hidden="true"></span>
      <span class="label"><strong>Live</strong> · {live.label}</span>
      <button onclick={() => player.stopLive()} data-testid="live-stop">Stop</button>
    </div>
  {:else if starting}
    <div class="status waiting">Waiting for the browser…</div>
  {/if}
  {#if live.error}
    <p class="problem" role="alert" data-testid="live-error">{live.error}</p>
  {/if}

  <Section title="Audio input" open>
    <p class="hint">Line-in, microphone or a virtual audio device.</p>
    <div class="row">
      <select
        value={chosen}
        onchange={(event) => chooseDevice(event.currentTarget.value)}
        aria-label="Audio input"
        disabled={!support.devices}
        data-testid="input-device"
      >
        <option value="">Default input</option>
        {#each devices as device (device.id)}
          <option value={device.id}>{device.label}</option>
        {/each}
      </select>
      {#if !(live.status === 'on' && live.kind === 'device')}
        <button
          class="primary"
          onclick={startDevice}
          disabled={!support.devices || starting}
          data-testid="live-device"
        >
          <Icon name="play" size={16} /> Start
        </button>
      {/if}
    </div>
    {#if !support.devices}
      <p class="hint">This browser cannot capture audio here.</p>
    {/if}
  </Section>

  <Section title="Another tab or app" open>
    <p class="hint">
      Opens the browser's share dialog. Choose a tab and keep “Also share tab audio” on; some
      systems also offer “Also share system audio” for the whole screen.
    </p>
    <button
      onclick={() => player.startLive('display')}
      disabled={!support.display || starting}
      data-testid="live-display"
    >
      Choose what to share…
    </button>
  </Section>

  <Section title="Level and monitoring" open>
    <LevelMeter />
    <Slider
      label="Input gain"
      value={$app.settings.inputGain}
      min={INPUT_GAIN_RANGE.min}
      max={INPUT_GAIN_RANGE.max}
      step={0.5}
      format={decibels}
      defaultValue={0}
      onchange={(value) => player.updateSettings({ inputGain: value })}
    />
    <label class="check">
      <input
        type="checkbox"
        checked={live.monitor}
        disabled={live.status !== 'on'}
        onchange={(event) => player.setMonitor(event.currentTarget.checked)}
        data-testid="live-monitor"
      />
      Hear the input through this app
    </label>
    <p class="hint">
      Off by default. With a microphone, only use it with headphones: through speakers it feeds
      back.
    </p>
  </Section>

  <Section title="Help: music from other apps">
    <div class="help">
      <p>
        To capture a music app on the same computer, route its sound through a virtual audio device
        and choose that device above.
      </p>
      <h3>macOS</h3>
      <p>
        Install the free driver BlackHole (2ch). In Audio MIDI Setup, create a Multi-Output Device
        with your speakers or headphones and BlackHole, and make it the sound output. Then choose
        “BlackHole 2ch” as the audio input here.
      </p>
      <h3>Windows</h3>
      <p>
        Install VB-Audio Virtual Cable. Play the music to “CABLE Input” and choose “CABLE Output” as
        the audio input here. To keep hearing it: Sound settings → Recording → CABLE Output →
        Properties → Listen → “Listen to this device”.
      </p>
      <h3>Linux</h3>
      <p>
        With PipeWire or PulseAudio, every output has a monitor source. Choose “Monitor of …” here;
        if it is not listed, start any input and switch this app's recording stream to the monitor
        in pavucontrol.
      </p>
      <p>
        A browser tab can also be shared directly (above). Virtual devices add only a few
        milliseconds; with Bluetooth headphones you hear the music later than you see it.
      </p>
    </div>
  </Section>
</section>

<style>
  .live {
    display: flex;
    flex-direction: column;
  }
  .intro {
    margin: 14px 16px 10px;
    font-size: 13px;
    color: var(--muted);
  }
  .status {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 16px 10px;
    padding: 8px 10px;
    border: 1px solid var(--pass);
    border-radius: 10px;
    background: color-mix(in srgb, var(--pass) 12%, var(--surface));
  }
  .status.waiting {
    border-color: var(--border);
    background: var(--surface-2);
    color: var(--muted);
  }
  .status .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--fail);
    box-shadow: 0 0 8px var(--fail);
  }
  .problem {
    margin: 0 16px 10px;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--fail);
    background: color-mix(in srgb, var(--fail) 15%, var(--surface));
    font-size: 13px;
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .row select {
    flex: 1;
    min-width: 0;
  }
  .row button,
  .live :global(button) {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .hint {
    margin: 0 0 8px;
    font-size: 12px;
    color: var(--muted);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 0 2px;
    font-size: 13px;
  }
  .help {
    font-size: 13px;
    color: var(--muted);
  }
  .help h3 {
    margin: 10px 0 2px;
    font-size: 13px;
    color: var(--text);
  }
  .help p {
    margin: 0 0 6px;
  }
</style>
