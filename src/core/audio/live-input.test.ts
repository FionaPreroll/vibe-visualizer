import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDevice } from './live-input';

/** A fake input: the stream of a device with this id and name. */
function fakeStream(id: string, label: string) {
  const track = { label, getSettings: () => ({ deviceId: id }), stop: vi.fn() };
  return { track, stream: { getAudioTracks: () => [track], getTracks: () => [track] } };
}

/**
 * Fake media devices: `devices` are the inputs by their current id; opening an unknown id
 * fails like a browser does.
 */
function stubDevices(devices: Record<string, string>, deny = false) {
  const opened: ReturnType<typeof fakeStream>[] = [];
  const getUserMedia = vi.fn(async (constraints: { audio: { deviceId?: { exact: string } } }) => {
    if (deny) throw new DOMException('denied', 'NotAllowedError');
    const id = constraints.audio.deviceId?.exact ?? 'default';
    if (!(id in devices)) throw new DOMException('no such device', 'OverconstrainedError');
    const input = fakeStream(id, devices[id]!);
    opened.push(input);
    return input.stream;
  });
  const enumerateDevices = vi.fn(async () =>
    Object.entries(devices).map(([deviceId, label]) => ({ kind: 'audioinput', deviceId, label })),
  );
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, enumerateDevices } });
  return { opened, getUserMedia };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('opening audio inputs', () => {
  const devices = { default: 'Default - Mic', a1: 'Mic', b2: 'Line In' };

  it('opens the wanted input by its id', async () => {
    stubDevices(devices);
    const input = await openDevice({ id: 'b2', label: 'Line In' });
    expect(input.device).toEqual({ id: 'b2', label: 'Line In' });
    expect(input.label).toBe('Line In');
  });

  it('finds an input by its name when its id changed', async () => {
    const { opened } = stubDevices(devices);
    const input = await openDevice({ id: 'old-id', label: 'Line In' });
    expect(input.device).toEqual({ id: 'b2', label: 'Line In' });
    // The default input opened on the way is closed again.
    expect(opened[0]!.track.label).toBe('Default - Mic');
    expect(opened[0]!.track.stop).toHaveBeenCalled();
    expect(opened[1]!.track.stop).not.toHaveBeenCalled();
  });

  it('falls back to the default input when the wanted one is gone', async () => {
    stubDevices(devices);
    const input = await openDevice({ id: 'old-id', label: 'USB Interface' });
    expect(input.device).toBeNull();
    expect(input.label).toBe('Default - Mic');
  });

  it('opens the default input when asked for it', async () => {
    const { getUserMedia } = stubDevices(devices);
    const input = await openDevice(null);
    expect(input.device).toBeNull();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const constraints = getUserMedia.mock.calls[0]![0].audio as Record<string, unknown>;
    expect(constraints).toMatchObject({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
  });

  it('explains a denied permission', async () => {
    stubDevices(devices, true);
    await expect(openDevice(null)).rejects.toThrow('Access to audio inputs was denied');
  });
});
