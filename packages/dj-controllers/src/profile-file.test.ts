import { describe, expect, it } from 'vitest';
import { PIONEER_DDJ_FLX2 } from './profiles/pioneer-ddj-flx2';
import { sanitizeProfile } from './profile-file';

describe('profiles from files', () => {
  it('keeps a whole profile as it is', () => {
    const copy = JSON.parse(JSON.stringify(PIONEER_DDJ_FLX2)) as unknown;
    expect(sanitizeProfile(copy)).toEqual(PIONEER_DDJ_FLX2);
  });

  it('keeps only bindings of known controls with MIDI bytes in range', () => {
    const profile = sanitizeProfile({
      id: ' mine ',
      name: 'Mine',
      ports: { input: 'Generic', output: 7 },
      decks: 99,
      controls: [
        { kind: 'button', control: 'play', deck: 1, status: 0x90, data: 0x30, extra: 'x' },
        { kind: 'button', control: 'explode', status: 0x90, data: 0x31 },
        { kind: 'button', control: 'cue', status: 0x40, data: 0x31 },
        { kind: 'button', control: 'cue', status: 0x90, data: 200 },
        { kind: 'button', control: 'pad', status: 0x90, data: [0x40, 0x47], padMode: 'hotcue' },
        { kind: 'absolute', control: 'filter', status: 0xb0, msb: 1, lsb: 33, invert: 'yes' },
        { kind: 'relative', control: 'jog', status: 0xb0, data: 2, encoding: 'rot13' },
      ],
      lights: [{ control: 'play', status: 0x90, data: 0x30, on: 300 }, 'light'],
      onConnect: [[0xb0, 1, 2], [0x01], 'x'],
    });
    expect(profile).toEqual({
      id: 'mine',
      name: 'Mine',
      ports: { input: 'Generic' },
      decks: 8,
      controls: [
        { kind: 'button', control: 'play', deck: 1, status: 0x90, data: 0x30 },
        { kind: 'button', control: 'pad', padMode: 'hotcue', status: 0x90, data: [0x40, 0x47] },
        { kind: 'absolute', control: 'filter', status: 0xb0, msb: 1, lsb: 33 },
      ],
      lights: [{ control: 'play', status: 0x90, data: 0x30 }],
      onConnect: [[0xb0, 1, 2]],
    });
  });

  it('refuses what is no profile, or has no control', () => {
    expect(sanitizeProfile(null)).toBeNull();
    expect(sanitizeProfile({ id: 'a', name: 'b', ports: { input: 'c' }, controls: [] })).toBeNull();
    expect(sanitizeProfile({ id: 'a', name: 'b', controls: [] })).toBeNull();
  });
});
