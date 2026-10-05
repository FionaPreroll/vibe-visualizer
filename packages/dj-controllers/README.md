# @fibestation/dj-controllers

DJ controllers in the browser, through Web MIDI. The library turns what a controller sends into semantic events ("deck 1, hot cue 3 pressed", "deck 1, filter at 0.7"), and semantic lights back into MIDI. What each model sends lives in a profile, which is plain data. An app maps the controls once, and every controller with a profile works.

It has no dependencies, is written in TypeScript, and runs on the main thread (Web MIDI does not exist in workers). Chrome and Edge support Web MIDI after a permission prompt, Firefox after installing a site permission add-on that it offers itself, and Safari not at all.

For now it is a workspace package of FibeStation (`private`). It will be published once its API has settled.

## Use

```ts
import { ControllerHub, PROFILES, SoftTakeover } from '@fibestation/dj-controllers';

const hub = new ControllerHub({ profiles: PROFILES });
const takeover = new SoftTakeover();

hub.onControl((event) => {
  if (event.kind === 'button' && event.control === 'play' && event.pressed) togglePlay();
  if (event.kind === 'button' && event.control === 'pad' && event.padMode === 'hotcue') {
    if (event.pressed) hotCue(event.index!, event.shift);
  }
  if (event.kind === 'absolute' && event.control === 'filter') {
    // Only once the knob has reached the app's value, so the value does not jump.
    if (takeover.accept('filter', event.value, filterAsZeroToOne())) setFilter(event.value);
  }
});

await hub.start(); // From a click: the browser asks for permission the first time.
hub.setLight({ control: 'play', deck: 1 }, 'on');
hub.setLight({ control: 'pad', deck: 1, index: 3, padMode: 'hotcue' }, 'blink');
```

- `hub.devices` and `hub.onDevices()`: the MIDI inputs, each with its profile, or `null` for a device the library does not know. Controllers can be plugged in and out at any time.
- `hub.onMessage()`: the raw messages, for a MIDI monitor.
- `hub.stop()`: turns the lights off and lets the controllers go.

## Events

| Kind | Controls | Value |
|---|---|---|
| `button` | `play`, `cue`, `sync`, `shift`, `load`, `headphoneCue`, `pad`, `jogTouch`, `browsePress` | `pressed`; pads also have `index` (1–8) and `padMode` |
| `absolute` | `eqHigh`, `eqMid`, `eqLow`, `trim`, `filter`, `volume`, `tempo`, `crossfader`, `masterLevel`, `headphoneLevel`, `headphoneMix` | `value`, 0–1 (0.5 in the middle of a knob with a centre) |
| `relative` | `jog`, `browse` | `delta`: steps (+ clockwise), or turns where the profile knows the steps per turn |

Every event has `device` (the profile's id), `deck` (1-based, or `null` for the mixer's own controls), `shift` (whether SHIFT was held) and `time` (when the message arrived, on the clock of `performance.now()`).

## Profiles

A profile names the MIDI port it belongs to and lists its controls and lights:

```ts
const profile: ControllerProfile = {
  id: 'pioneer-ddj-flx2',
  name: 'Pioneer DJ DDJ-FLX2',
  ports: { input: 'DDJ-FLX2' }, // Found in the port names, ignoring case.
  decks: 2,
  controls: [
    { kind: 'button', control: 'play', deck: 1, status: 0x90, data: 0x0b },
    // Pads 1–8 in hot cue mode; with SHIFT on the next channel.
    { kind: 'button', control: 'pad', deck: 1, padMode: 'hotcue', status: 0x97, data: [0x00, 0x07] },
    { kind: 'button', control: 'pad', deck: 1, padMode: 'hotcue', shift: true, status: 0x98, data: [0x00, 0x07] },
    // 14 bits: the coarse part on 0x0f, the fine part on 0x2f.
    { kind: 'absolute', control: 'eqLow', deck: 1, status: 0xb0, msb: 0x0f, lsb: 0x2f },
    { kind: 'relative', control: 'jog', deck: 1, status: 0xb0, data: 0x21, encoding: 'offset64' },
  ],
  lights: [{ control: 'play', deck: 1, status: 0x90, data: 0x0b }],
};
```

Profiles are written from the manufacturers' MIDI message lists. Mappings of other programs (such as Mixxx, which is GPL-licensed) can serve as a check, but are not copied.

A button that sends a control change instead of a note (127 pressed, 0 released, as many plain MIDI controllers do) has `message: 'control'`. A pad bound alone (one data byte, not a range) gives its number with `index`.

### MIDI learn

For a controller without a profile, `learnBinding(target, messages)` turns what one control sent while the user moved it into a binding: a button from its first note on (or a control change above 0); a knob or fader from its most frequent control change, with the fine part of a 14-bit value 32 above the coarse one, and `invert` when it was moved from its lowest to its highest end and the values fell; a jog wheel or encoder from its control change and how it writes its steps, for a turn to the right first (`offset64` for 65 and up, `signBit` when the left turn gives 65 and up, else `twosComplement`). `learnedProfile(port, name, bindings, lights)` makes a profile of them, and `guessLights` lights the buttons with their own notes, as most controllers expect.

`sanitizeProfile(value)` checks a profile from a file: only bindings of known controls with MIDI bytes in range are kept. `ControllerHub.setProfiles` gives the connected devices the profile that fits them now, e.g. after MIDI learn.

### A profile from a report

The app's DJ controller dialog saves a *controller report* (JSON, `format: "fibestation-controller-report"`): for each control it asks for (`steps`), the messages the controller sent as hex (`"90 30 7F"`), what was learned, and the profile learned (`profile`), with the names of the MIDI ports (`ports`) and the browser. To build a controller in:

1. Check `profile` against the messages of each step, and against the manufacturer's MIDI message list where there is one (14-bit values, SHIFT on another channel, pad modes, the second deck).
2. Write it as `src/profiles/<maker>-<model>.ts` with `ports.input` a part of the port name that every operating system reports (`ports.inputs` in the report), and add it to `PROFILES` in `src/index.ts` and to the table below.
3. Add a test in the style of `decoder.test.ts` with messages from the report.

## Controllers

| Controller | Profile | Notes |
|---|---|---|
| Pioneer DJ DDJ-FLX2 | `PIONEER_DDJ_FLX2` | Both decks, the pads in all four modes, EQ, CFX, faders, tempo sliders, jog wheels; the lights of PLAY, CUE and the hot cue pads |

## Tests

`src/fake-midi.ts` stands in for Web MIDI (ports that can be plugged in, receive messages and record what is sent). The tests run with the app's: `pnpm test`.
