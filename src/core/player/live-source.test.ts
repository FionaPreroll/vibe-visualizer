import { describe, expect, it, vi } from 'vitest';
import { hintRange, TEMPO_RANGES } from '../analysis/beat-grid';
import type { InputDevice, LiveSourceKind, OpenedInput } from '../audio/live-input';
import { initialState, reducer, type AppAction, type AppState } from '../state/app-state';
import { createStore } from '../state/store';
import { LiveSource, type InputOpener, type LiveEngine } from './live-source';

/** An opened input with one audio track, which can end like an unplugged one. */
function opened(kind: LiveSourceKind, device: InputDevice | null): OpenedInput {
  const track = new EventTarget();
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  return { stream: stream as unknown as MediaStream, kind, device, label: device?.label ?? kind };
}

/** A promise and the function that keeps it. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function setup() {
  const store = createStore<AppState, AppAction>(initialState(), reducer);
  const engine = {
    start: vi.fn(async () => {}),
    connectInput: vi.fn<LiveEngine['connectInput']>(),
    disconnectInput: vi.fn(),
    monitorInput: true,
    tempoRange: null as LiveEngine['tempoRange'],
  } satisfies LiveEngine;
  const inputs = {
    openDevice: vi.fn(async (device: InputDevice | null) => opened('device', device)),
    openDisplay: vi.fn(async () => opened('display', null)),
    closeInput: vi.fn<InputOpener['closeInput']>(),
  } satisfies InputOpener;
  const pauseQueue = vi.fn();
  const live = new LiveSource(store, engine, inputs, pauseQueue);
  return { store, engine, inputs, pauseQueue, live };
}

const USB = { id: 'usb-1', label: 'USB Audio' };

describe('live input as the source', () => {
  it('takes the place of the queue, is heard only when asked, and keeps the input for next time', async () => {
    const { store, engine, inputs, pauseQueue, live } = setup();
    expect(live.active).toBe(false);
    expect(live.lastDevice).toBeNull();
    await live.start('device', USB);
    const input = await inputs.openDevice.mock.results[0]!.value;
    expect(store.state.live).toMatchObject({ status: 'on', kind: 'device', label: 'USB Audio' });
    expect(live.active).toBe(true);
    expect(pauseQueue).toHaveBeenCalledTimes(1);
    expect(engine.monitorInput).toBe(false);
    expect(engine.connectInput).toHaveBeenCalledWith(input.stream);
    expect(live.lastDevice).toEqual(USB);

    live.setMonitor(true);
    expect(engine.monitorInput).toBe(true);
    expect(store.state.live.monitor).toBe(true);

    live.stop();
    expect(engine.monitorInput).toBe(false);
    expect(engine.disconnectInput).toHaveBeenCalled();
    expect(inputs.closeInput).toHaveBeenCalledWith(input.stream);
    expect(store.state.live.status).toBe('off');
  });

  it('lets an input go that opens only after a newer start or a stop', async () => {
    const { store, engine, inputs, live } = setup();
    const late = deferred<OpenedInput>();
    inputs.openDisplay.mockReturnValueOnce(late.promise);
    const starting = live.start('display');
    await vi.waitFor(() => expect(inputs.openDisplay).toHaveBeenCalled());
    expect(store.state.live.status).toBe('starting');
    live.stop();
    const input = opened('display', null);
    late.resolve(input);
    await starting;
    expect(inputs.closeInput).toHaveBeenCalledWith(input.stream);
    expect(engine.connectInput).not.toHaveBeenCalled();
    expect(store.state.live.status).toBe('off');
  });

  it('keeps the input it has when the engine cannot take a new one, and says why', async () => {
    const { store, engine, inputs, live } = setup();
    await live.start('device', USB);
    const first = await inputs.openDevice.mock.results[0]!.value;
    engine.connectInput.mockImplementationOnce(() => {
      throw new DOMException('rate', 'NotSupportedError');
    });
    await live.start('device', { id: 'mic-44k', label: 'Old microphone' });
    const second = await inputs.openDevice.mock.results[1]!.value;
    expect(inputs.closeInput).toHaveBeenCalledWith(second.stream);
    expect(inputs.closeInput).not.toHaveBeenCalledWith(first.stream);
    expect(engine.connectInput).toHaveBeenLastCalledWith(first.stream);
    expect(store.state.live).toMatchObject({ status: 'on', label: 'USB Audio' });
    expect(store.state.live.error).toContain('48 kHz');
    expect(live.lastDevice).toEqual(USB);
  });

  it('stops when the input ends, and says why', async () => {
    const { store, inputs, live } = setup();
    await live.start('display');
    const input = await inputs.openDisplay.mock.results[0]!.value;
    input.stream.getAudioTracks()[0]!.dispatchEvent(new Event('ended'));
    expect(store.state.live).toMatchObject({ status: 'off', error: 'Sharing has ended.' });
    expect(inputs.closeInput).toHaveBeenCalledWith(input.stream);
  });

  it('says why an input could not be opened', async () => {
    const { store, inputs, live } = setup();
    inputs.openDevice.mockRejectedValueOnce(new Error('No permission for the microphone.'));
    await live.start('device');
    expect(store.state.live).toMatchObject({
      status: 'off',
      error: 'No permission for the microphone.',
    });
  });

  it('tracks the beat near the tempo given for the input, otherwise in the tempo range', async () => {
    const { store, engine, live } = setup();
    expect(engine.tempoRange).toBeNull();
    store.dispatch({ type: 'settings/changed', changes: { bpmRange: 'fast' } });
    expect(engine.tempoRange).toEqual(TEMPO_RANGES.fast);

    // A tempo counts while the input runs; one out of range is ignored.
    live.setTempo(128.456);
    expect(store.state.live.tempo).toBe(128.46);
    expect(engine.tempoRange).toEqual(TEMPO_RANGES.fast);
    await live.start('display');
    expect(engine.tempoRange).toEqual(hintRange(128.46));
    live.setTempo(1000);
    expect(store.state.live.tempo).toBe(128.46);
    live.setTempo(null);
    expect(engine.tempoRange).toEqual(TEMPO_RANGES.fast);
    store.dispatch({ type: 'settings/changed', changes: { bpmRange: 'auto' } });
    expect(engine.tempoRange).toBeNull();
  });
});
