import { describe, expect, it } from 'vitest';
import { FakeAccess } from './fake-midi';
import { ControllerHub } from './hub';
import { learnedProfile } from './learn';
import { PIONEER_DDJ_FLX2 } from './profiles/pioneer-ddj-flx2';
import type { ControlEvent } from './types';

function hub(access: FakeAccess): ControllerHub {
  return new ControllerHub({ profiles: [PIONEER_DDJ_FLX2], requestAccess: access.request });
}

describe('ControllerHub', () => {
  it('finds a controller by its port name and decodes what it sends', async () => {
    const access = new FakeAccess();
    const { input, output } = access.device('DDJ-FLX2 MIDI 1');
    access.device('Other Keyboard');
    const controllers = hub(access);
    const events: ControlEvent[] = [];
    const raw: number[][] = [];
    controllers.onControl((event) => events.push(event));
    controllers.onMessage((message) => raw.push([...message.data]));
    await controllers.start();

    expect(controllers.devices.map((device) => [device.name, device.profile?.id ?? null])).toEqual([
      ['DDJ-FLX2 MIDI 1', 'pioneer-ddj-flx2'],
      ['Other Keyboard', null],
    ]);
    // Its lights start off.
    expect(output.sent.length).toBeGreaterThan(0);
    expect(output.sent.every((message) => message[2] === 0)).toBe(true);

    input.receive([0x97, 0x00, 0x7f], 42);
    expect(events).toEqual([
      expect.objectContaining({ control: 'pad', index: 1, padMode: 'hotcue', time: 42 }),
    ]);
    expect(raw).toEqual([[0x97, 0x00, 0x7f]]);
  });

  it('sets lights, also on a controller that is plugged in later', async () => {
    const access = new FakeAccess();
    const controllers = hub(access);
    await controllers.start();
    controllers.setLight({ control: 'play', deck: 1 }, 'on');
    expect(controllers.devices).toEqual([]);

    const { input, output } = access.device('DDJ-FLX2');
    const seen: string[][] = [];
    controllers.onDevices((devices) => seen.push(devices.map((device) => device.name)));
    access.plug(input);
    expect(seen.at(-1)).toEqual(['DDJ-FLX2']);
    expect(output.sent.at(-1)).toEqual([0x90, 0x0b, 0x7f]);

    controllers.setLight({ control: 'play', deck: 1 }, 'off');
    expect(output.sent.at(-1)).toEqual([0x90, 0x0b, 0x00]);
  });

  it('forgets an unplugged controller, and lets go of all on stop', async () => {
    const access = new FakeAccess();
    const first = access.device('DDJ-FLX2 A');
    const second = access.device('DDJ-FLX2 B');
    const controllers = hub(access);
    const events: ControlEvent[] = [];
    controllers.onControl((event) => events.push(event));
    await controllers.start();

    access.unplug(first.input);
    expect(controllers.devices.map((device) => device.name)).toEqual(['DDJ-FLX2 B']);
    expect(first.input.onmidimessage).toBeNull();

    controllers.setLight({ control: 'cue', deck: 2 }, 'on');
    controllers.stop();
    expect(second.output.sent.at(-1)?.[2]).toBe(0);
    expect(controllers.devices).toEqual([]);
    second.input.receive([0x90, 0x0b, 0x7f]);
    expect(events).toEqual([]);
  });

  it('gives a device a profile learned while it is connected, with its lights', async () => {
    const access = new FakeAccess();
    const { input, output } = access.device('Generic MIDI');
    const controllers = hub(access);
    const events: ControlEvent[] = [];
    controllers.onControl((event) => events.push(event));
    await controllers.start();
    expect(controllers.devices[0]?.profile).toBeNull();
    input.receive([0x90, 0x30, 0x7f]);
    expect(events).toEqual([]);

    const play = { kind: 'button', control: 'play', deck: 1, status: 0x90, data: 0x30 } as const;
    controllers.setProfiles([learnedProfile('Generic MIDI', 'Mine', [play], true)]);
    expect(controllers.devices[0]?.profile?.name).toBe('Mine');
    controllers.setLight({ control: 'play', deck: 1 }, 'on');
    expect(output.sent.at(-1)).toEqual([0x90, 0x30, 0x7f]);
    input.receive([0x90, 0x30, 0x7f]);
    expect(events).toEqual([expect.objectContaining({ control: 'play', pressed: true })]);

    // Forgotten again: its light goes off, and it does nothing.
    controllers.setProfiles([PIONEER_DDJ_FLX2]);
    expect(output.sent.at(-1)).toEqual([0x90, 0x30, 0x00]);
    expect(controllers.devices[0]?.profile).toBeNull();
    input.receive([0x90, 0x30, 0x7f]);
    expect(events).toHaveLength(1);
  });
});
