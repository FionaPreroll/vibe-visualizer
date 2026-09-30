# Vibe Visualizer — DJ Controllers

> **Status:** proposal (2026-09-30), nothing built yet. The decision is open as Q18 in [FEATURES.md](FEATURES.md#6-open-questions); the planned features are CTL-01–07 and FX-11 there.

## 1. In short

- **Effort:** supporting the Pioneer DJ DDJ-FLX2 for play/pause, the hot cue pads, HI/MID/LOW and CFX is one milestone, about the size of UX C (see [§5](#5-effort)). The controller part is mostly mapping. The largest single piece is the 3-band EQ, which the sound chain does not have yet; CFX can drive the DJ filter that exists (FX-06).
- **Browsers:** controllers speak MIDI over USB, and browsers reach them through Web MIDI. Chrome and Edge support it after a permission prompt, Firefox after installing a site permission add-on that it offers itself, Safari not at all. That fits the main target, Chrome on macOS (NF-02).
- **A generic API works well:** a separate library turns MIDI messages into semantic events ("deck 1, hot cue 3 pressed", "deck 2, low EQ at 0.3") and semantic lights back into MIDI. What a device sends lives in declarative profiles, one per controller. The app only maps semantic controls to its own actions, so a second controller needs a profile, not app code.

## 2. What the DDJ-FLX2 sends

From AlphaTheta's [MIDI message list for the DDJ-FLX2](https://assets.pioneerdjhub.com/DDJ-FLX2_MIDI_Message_List_E1.pdf), as used by the open Mixxx mapping ([mixxxdj/mixxx#16567](https://github.com/mixxxdj/mixxx/pull/16567)). Status byte and data byte in hex; deck 1 uses MIDI channel 1, deck 2 channel 2.

| Control | Message | Notes |
|---|---|---|
| PLAY/PAUSE | note `90 0B` (deck 2: `91 0B`) | Its light: the same note sent back, `7F` on, `00` off |
| CUE | note `90 0C` / `91 0C` | Light like PLAY |
| SHIFT | note `90 3F` / `91 3F` | One per deck |
| Pads, hot cue mode | notes `97 00`–`97 07` (deck 2: `99 00`–`99 07`); with SHIFT on the next channel, `98` / `9A` | Hot cues 1–8 per deck. The controller switches the pad modes itself and tells them by the note range: hot cue `00`–`07`, pad FX `10`–`17`, sampler `30`–`37`, beat loop `60`–`67`. Pad lights: the same note sent back on the same channel |
| HI / MID / LOW | control changes `B0 07` / `0B` / `0F`, with the fine part on `27` / `2B` / `2F` (deck 2: `B1`) | 14-bit: the coarse and the fine value together give 16,384 steps |
| CFX | control change `B6 17` + `B6 37` (deck 2: `B6 18` + `B6 38`) | 14-bit, absolute, centre = off. The SMART CFX button (`96 09`) switches rekordbox's Smart CFX; outside rekordbox it is a free button |
| Channel fader | `B0 13` + `B0 33` / `B1 …` | 14-bit |
| Tempo slider | `B0 00` + `B0 20` / `B1 …` | 14-bit |
| Crossfader | `B6 1F` + `B6 3F` | 14-bit |
| Jog wheel | `B0 21` (outer ring), `B0 22` (top, touched), touch `90 36` | Relative: the value is the movement since the last message |
| Knob positions | SysEx `F0 00 40 05 00 00 02 0A 00 03 01 F7` | Asks the controller to send the positions of all knobs and faders. SysEx needs the stronger Web MIDI permission ("control and reprogram your MIDI devices") |

The DDJ-FLX2 also has a sound card with master and headphone outputs. The app can play through it where the browser can choose the output device (`AudioContext.setSinkId`, Chromium); pre-listening on headphones only makes sense with a second deck (CTL-06).

The Mixxx mapping (GPL-2.0-or-later) only serves as a check that the message list holds on real devices; our profile is written from the message list, not copied from the mapping.

## 3. The library

A separate package, working title `@fibestation/dj-controllers`: first a workspace package in this repository (`packages/dj-controllers`), published to npm once the API has settled. It is framework-free TypeScript without dependencies, runs on the main thread (Web MIDI is not available in workers), and knows nothing about FibeStation.

### 3.1 Layers

1. **Transport:** Web MIDI access, the connected ports, plugging and unplugging (`statechange`). Replaceable, so WebHID can follow for controllers that speak HID (CTL-07). Tests pass a fake `MIDIAccess`.
2. **Profiles:** one per controller, pure data (JSON-compatible): which ports it matches, what each message means, how the lights are set, what to send on connect and disconnect. Ranges keep a profile short (hot cues 1–8 = notes `00`–`07`).
3. **Decoding:** turns messages into semantic events: 14-bit pairs, relative encoders (two's complement, offset 64, sign bit), shift layers, pad modes, bipolar knobs with their centre.
4. **Lights:** semantic light states back into MIDI; only changes are sent, blinking runs on one shared timer, so all blinking lights stay in step.
5. **Learn (CTL-04):** for a controller without a profile: "move the control for deck 1, low EQ" records the next message and writes it into a new profile, which can be saved and shared.

### 3.2 Controls

| Control | Kind | Per deck | Value |
|---|---|---|---|
| `play`, `cue`, `sync`, `shift`, `load`, `headphoneCue` | button | yes | pressed or released |
| `pad` | button | yes | pressed or released, with `index` 1–8 and `padMode` (`hotcue`, `loop`, `sampler`, `fx`, `beatjump`) |
| `eqHigh`, `eqMid`, `eqLow`, `trim`, `filter`, `volume`, `tempo` | absolute | yes | 0–1; knobs with a centre report 0.5 there |
| `crossfader`, `masterLevel`, `headphoneLevel`, `headphoneMix` | absolute | no | 0–1 |
| `jog` | relative | yes | turns since the last event (+ clockwise), and whether the top is touched |
| `browse` | relative | no | steps |
| `browsePress` | button | no | pressed or released |

### 3.3 API sketch

```ts
type ControlKind = 'button' | 'absolute' | 'relative';
type PadMode = 'hotcue' | 'loop' | 'sampler' | 'fx' | 'beatjump';

interface ControlEvent {
  /** The profile of the device, e.g. "pioneer-ddj-flx2". */
  device: string;
  /** 1-based; null for the mixer's own controls (crossfader, master, browse). */
  deck: number | null;
  control: ControlId;
  kind: ControlKind;
  /** Pads: 1–8, and the mode the controller is in. */
  index?: number;
  padMode?: PadMode;
  /** Whether SHIFT was held. */
  shift: boolean;
  /** Buttons. */
  pressed?: boolean;
  /** Absolute controls: 0–1. */
  value?: number;
  /** Relative controls: turns (jog) or steps (browse). */
  delta?: number;
  /** When the message arrived (MIDIMessageEvent.timeStamp, the performance.now() clock). */
  time: number;
}

type LightTarget = { deck: number | null; control: ControlId; index?: number; padMode?: PadMode };
type LightState = 'off' | 'on' | 'dim' | 'blink';

interface ControllerHub {
  /** Asks for MIDI access (the browser's permission prompt) and starts listening. */
  start(options?: { sysex?: boolean }): Promise<void>;
  stop(): void;
  readonly devices: readonly ConnectedController[];
  onDevices(listener: (devices: readonly ConnectedController[]) => void): () => void;
  onControl(listener: (event: ControlEvent) => void): () => void;
  setLight(target: LightTarget, state: LightState): void;
  /** Resolves with the binding of the next message, for a profile made by hand (CTL-04). */
  learn(target: LightTarget, signal?: AbortSignal): Promise<ControlBinding>;
}

function createControllerHub(options: {
  profiles: readonly ControllerProfile[];
  /** For tests and other transports; navigator.requestMIDIAccess otherwise. */
  access?: () => Promise<MIDIAccess>;
}): ControllerHub;

/** Ignores an absolute control until it reaches the app's value ("pickup"). */
class SoftTakeover {
  accept(event: ControlEvent, appValue: number): boolean;
}
```

A profile, in short:

```ts
const DDJ_FLX2: ControllerProfile = {
  id: 'pioneer-ddj-flx2',
  name: 'Pioneer DJ DDJ-FLX2',
  /** Found in the names of the MIDI ports the browser reports. */
  ports: { input: 'DDJ-FLX2', output: 'DDJ-FLX2' },
  decks: 2,
  controls: [
    { kind: 'button', control: 'play', deck: 1, status: 0x90, data: 0x0b },
    { kind: 'button', control: 'pad', deck: 1, padMode: 'hotcue', status: 0x97, data: [0x00, 0x07], shiftStatus: 0x98 },
    { kind: 'absolute', control: 'eqLow', deck: 1, status: 0xb0, msb: 0x0f, lsb: 0x2f },
    { kind: 'absolute', control: 'filter', deck: 1, status: 0xb6, msb: 0x17, lsb: 0x37, centre: 0.5 },
    { kind: 'relative', control: 'jog', deck: 1, status: 0xb0, data: 0x21, encoding: 'offset64', perTurn: 1024 },
    // …
  ],
  lights: [
    { control: 'play', deck: 1, status: 0x90, data: 0x0b, on: 0x7f, off: 0x00 },
    { control: 'pad', deck: 1, padMode: 'hotcue', status: 0x97, data: [0x00, 0x07], on: 0x7f, off: 0x00 },
    // …
  ],
};
```

(The jog's encoding and resolution are to be read off the device with the MIDI monitor.)

### 3.4 Timing

A pad takes effect when the app gets its message, and Web MIDI delivers messages on the main thread. The rendering and the audio run in workers, so the main thread is usually free and the delay stays at a few milliseconds. Each event carries the time the message arrived, so the app can place a jump exactly where it was pressed, or on the next beat (quantised jumps, TR-06).

## 4. In FibeStation

The app gets a small controller service that maps the events to what the keyboard does already. Every action it takes is a timestamped action like all others (NF-08), so a set played with the controller can later be rendered as a video (EX-13).

| DDJ-FLX2 | FibeStation |
|---|---|
| PLAY/PAUSE | Play and pause (TR-01); its light shows whether the music plays |
| CUE | Back to the in marker or the start, and stop |
| Pads in hot cue mode | Hot cues 1–8, as the keys 1–8: set where empty, jump where set; SHIFT + pad deletes. The pads of the cues that are set light up |
| HI / MID / LOW | A new 3-band EQ with kills (FX-11), live and in the export |
| CFX | The DJ filter (FX-06): left low-pass, right high-pass, off in the middle |
| Channel fader, tempo slider | Volume; the tempo fader within its range (TMP-01). Both with pickup, so a fader that stands elsewhere does not make the value jump |
| Jog wheel | Outer ring: nudge (TMP-03); top: scrub |
| Other pad modes | Free at first. Ideas: sampler mode → visual presets 1–8, pad FX → the sound presets, beat loop → loops once they exist (TR-07) |
| Deck 2, crossfader | FibeStation has one deck: deck 2 either does the same as deck 1, or becomes the visuals deck (CTL-05) |

A "Controllers" section (in the Live tab or its own dialog) connects a controller (the permission prompt comes from a click), shows which one is connected, and later offers MIDI learn for unknown ones.

Tests: the library against a fake `MIDIAccess`; the profile against the message list; an end-to-end test with a fake controller (Playwright replaces `navigator.requestMIDIAccess`) that presses pads and turns knobs and checks the app and the lights sent back. The real device is checked with a MIDI monitor in the Spike Lab (S6: lists the ports and the messages, with **Copy report** like the other spikes), since there is no DDJ-FLX2 in CI.

## 5. Effort

| Part | Size | Contents |
|---|---|---|
| Library core | M | Web MIDI hub, profile format, decoding (14-bit, relative, shift, pad modes), lights with blinking, pickup, fake MIDI for tests |
| DDJ-FLX2 profile | S | From the message list, and the MIDI monitor (S6) for your check with the device |
| App bindings | M | Play/pause, cue, hot cues with lights, CFX → filter, tempo slider, channel fader, jog; the Controllers section; end-to-end test |
| 3-band EQ (FX-11) | M | Isolator EQ with kills in the sound chain (live and export), sound settings, knobs in the Sound tab |
| Own package | S | Workspace package, README and API docs, versions; npm once stable |
| MIDI learn (CTL-04), optional | M | Learning, saving, exporting and importing profiles |
| Visuals deck (CTL-05), optional | M | Deck 2 for the visuals: presets on the pads, knobs on visual parameters, crossfader blends two presets |

S is a few hours, M about a day. The scope asked for (play/pause, hot cues, HI/MID/LOW, CFX, with the library) is four to five days; with MIDI learn and the visuals deck, about a week.

Risks:

- **No device here:** the profile follows the message list; the first test on a real DDJ-FLX2 is yours. The MIDI monitor makes it quick to report what does not match.
- **Knob positions** are unknown until a knob moves, unless the app asks for them with SysEx, which needs the stronger permission. Pickup covers it: a knob takes over once it passes the app's value.
- **One deck:** the second deck and the crossfader have no natural job until the visuals deck (CTL-05) or two decks (PL-06).
- **rekordbox features** such as Smart CFX and Smart Fader are functions of rekordbox, not of the controller, and do not carry over.

## 6. Pro version?

Controller support could be a Pro feature, but the basic support is worth more free: it is a strong reason to choose the app, browser visualizers rarely have it, and an open-source library (MIT) lets owners of other controllers contribute profiles. What professionals would pay for is what they do with it:

- the visuals deck and MIDI learn for visual parameters, i.e. the controller as a VJ controller (CTL-04, CTL-05);
- recording a performance and rendering it in HD afterwards (EX-13);
- a second output window for a projector (DS-03) and a clean output for OBS (DS-04);
- batch and playlist exports (EX-05, EX-09).

A Pro edition fits the local, server-free app (NF-01): a licence key signed with our private key (Ed25519) and checked offline with the public key, sold through a merchant of record (Paddle, Lemon Squeezy or Gumroad, which handle VAT); no accounts and no server of our own. Since the code runs in the browser, a determined user can bypass it, which is acceptable for a tool like this. The legal and administrative side (legal notice, terms, support) costs more than the code. Proposal: decide later, and build the features so that each can be switched per edition.

## 7. More ideas

- **Lights on the beat:** the pads or PLAY pulse with the beat grid, so the controller becomes part of the show.
- **Quantised hot cues:** a pad jumps on the next beat, as in DJ software (the open part of TR-06).
- **Sound through the controller:** choose the DDJ-FLX2's sound card as the output (`setSinkId`, Chromium).
- **Two decks (PL-06):** the DDJ-FLX2 is a two-deck controller. With two decks and the crossfader, FibeStation becomes a small DJ app with visuals: a large step (a second stream, a mixer, sync, headphone pre-listening), after v1.0.
- **VJ controllers:** generic MIDI controllers (Akai APC and MPD, Novation Launch Control, Korg nanoKONTROL) are popular for visuals; MIDI learn covers them.
- **Gamepads:** the Gamepad API works in every browser; a gamepad as a cheap visuals controller.
- **HID controllers (CTL-07):** some controllers (e.g. Native Instruments Traktor Kontrol) speak HID instead of MIDI; WebHID (Chromium) can reach them through the same library.
