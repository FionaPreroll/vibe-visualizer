import type { Player } from '../core/player/player';
import { BUILT_IN_KALEIDO_PRESETS } from '../core/render/kaleido-settings';
import { BUILT_IN_PRESETS } from '../core/render/visual-settings';
import { REPEAT_MODES, VISUAL_MODES } from '../core/state/app-state';
import { loadKaleidoPresets, loadPresets } from '../core/state/persistence';

/** What the shortcuts act on: the player, and what the shell around the stage does. */
export interface ShortcutActions {
  player: Player;
  /** Fullscreen, asked for in `source` (the tab, or the window the visuals are in). */
  toggleFullscreen(source: Window): void;
  toggleMiniPlayer(): void;
  takePicture(): void;
  /** Opens the help at `section`. */
  openHelp(section: string): void;
}

/** A keyboard shortcut (UI-04): how the help lists it, the keys it answers to, what it does. */
export interface Shortcut {
  /** The keys as the help shows them: alternatives side by side, " + " joins a combination. */
  keys: readonly string[];
  /** What it does, as the help says it. */
  label: string;
  /**
   * The keys it answers to, as `KeyboardEvent.key` gives them, or by their place on the keyboard
   * (`code`), so a layout that puts other characters there works too. A shortcut without them
   * is handled elsewhere (in the queue, in a dialog) and only shows in the help.
   */
  key?: readonly string[];
  code?: readonly string[];
  /** Answers only with Shift (true) or only without it (false); either way when not given. */
  shift?: boolean;
  /** Answers with Ctrl, or Cmd on a Mac, instead of without modifiers. */
  command?: boolean;
  /** What it does when pressed; false when there was nothing to do (the key goes on). */
  run?: (actions: ShortcutActions, event: KeyboardEvent) => void | false;
  /** What it does when let go (for the keys that act while held). */
  release?: (actions: ShortcutActions) => void;
}

/** The hot cues' keys, by their place: 1 to 8 over the letters. */
const CUE_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'];

/** The keyboard shortcuts (UI-04), in the groups the help shows: what a key does is here only. */
export const SHORTCUTS: readonly { title: string; shortcuts: readonly Shortcut[] }[] = [
  {
    title: 'Playback',
    shortcuts: [
      {
        keys: ['Space'],
        label: 'Play or pause',
        key: [' '],
        run: ({ player }) => void player.toggle(),
      },
      {
        keys: ['←', '→'],
        label: 'Back or forward 5 s (with Shift: 30 s)',
        key: ['ArrowLeft', 'ArrowRight'],
        run: ({ player }, event) => {
          const step = (event.shiftKey ? 30 : 5) * (event.key === 'ArrowLeft' ? -1 : 1);
          void player.seek(player.position + step);
        },
      },
      {
        keys: ['N', 'P'],
        label: 'Next or previous track',
        key: ['n', 'p'],
        run: ({ player }, event) => void (event.key === 'n' ? player.next() : player.previous()),
      },
      {
        keys: ['S'],
        label: 'Shuffle on or off',
        key: ['s'],
        run: ({ player }) => player.updateSettings({ shuffle: !player.state.settings.shuffle }),
      },
      {
        keys: ['R'],
        label: 'Repeat: off, the queue, the track',
        key: ['r'],
        run: ({ player }) => {
          const index = REPEAT_MODES.indexOf(player.state.settings.repeat);
          player.updateSettings({ repeat: REPEAT_MODES[(index + 1) % REPEAT_MODES.length]! });
        },
      },
    ],
  },
  {
    title: 'Cues and markers',
    shortcuts: [
      {
        keys: ['1–8'],
        label: 'Jump to a hot cue, or set it where it is empty',
        code: CUE_CODES,
        shift: false,
        run: ({ player }, event) => void player.cue(CUE_CODES.indexOf(event.code)),
      },
      {
        keys: ['Shift + 1–8'],
        label: 'Delete a hot cue',
        code: CUE_CODES,
        shift: true,
        run: ({ player }, event) => player.setCue(CUE_CODES.indexOf(event.code), null),
      },
      {
        keys: ['I', 'O'],
        label: 'Set the in or out marker (with Shift: clear it)',
        // With Shift, the letters come as capitals.
        key: ['i', 'I', 'o', 'O'],
        run: ({ player }, event) =>
          player.mark(
            event.key.toLowerCase() === 'i' ? 'in' : 'out',
            event.shiftKey ? null : player.position,
          ),
      },
      {
        keys: ['Q'],
        label: 'Snap markers and cues to the beat, or not',
        key: ['q'],
        run: ({ player }) => player.updateSettings({ quantize: !player.state.settings.quantize }),
      },
      {
        keys: ['W'],
        label: 'Detail waveform on or off',
        key: ['w'],
        run: ({ player }) =>
          player.updateSettings({ detailWaveform: !player.state.settings.detailWaveform }),
      },
      { keys: ['Shift + drag'], label: 'Move the beat grid, in the detail waveform' },
    ],
  },
  {
    title: 'Tempo',
    shortcuts: [
      {
        keys: ['−', '+'],
        label: 'Tempo down or up by 0.1 %',
        // "=" is the plus key without Shift on many keyboards.
        key: ['-', '+', '='],
        run: ({ player }, event) => player.stepTempo(event.key === '-' ? -1 : 1),
      },
      {
        keys: [',', '.'],
        label: 'Hold to slow down or speed up',
        key: [',', '.'],
        run: ({ player }, event) => {
          if (!event.repeat) player.nudge(event.key === ',' ? -1 : 1);
        },
        release: ({ player }) => player.nudge(0),
      },
    ],
  },
  {
    title: 'Visuals',
    shortcuts: [
      {
        keys: ['V'],
        label: 'Next visual mode',
        key: ['v'],
        run: ({ player }) => nextVisualMode(player),
      },
      {
        keys: ['[', ']'],
        label: 'Previous or next preset',
        key: ['[', ']'],
        run: ({ player }, event) => stepPreset(player, event.key === '[' ? -1 : 1),
      },
      {
        keys: ['F'],
        label: "Fullscreen (in the second screen's window: fullscreen there)",
        key: ['f'],
        run: (actions, event) => actions.toggleFullscreen(event.view ?? window),
      },
      {
        keys: ['M'],
        label: 'Mini player: the visuals in a small window on top (Chrome, Edge, Firefox)',
        key: ['m'],
        run: (actions) => actions.toggleMiniPlayer(),
      },
      {
        keys: ['C'],
        label: 'Save the picture as a PNG, e.g. as a thumbnail',
        key: ['c'],
        run: (actions) => actions.takePicture(),
      },
      {
        keys: ['B'],
        label: 'Pause the visuals, or show them again (the music plays on)',
        key: ['b'],
        run: ({ player }) =>
          player.updateSettings({ visualsPaused: !player.state.settings.visualsPaused }),
      },
    ],
  },
  {
    title: 'A track in the queue',
    shortcuts: [
      { keys: ['Enter'], label: 'Play it' },
      { keys: ['Delete'], label: 'Remove it' },
      { keys: ['F2'], label: 'Give it a title, artist, cover, colours and look' },
      { keys: ['Alt + ↑', 'Alt + ↓'], label: 'Move it up or down' },
    ],
  },
  {
    title: 'Undo',
    shortcuts: [
      {
        keys: ['Ctrl + Z', 'Cmd + Z'],
        label: 'Undo removing a track, clearing the queue, or deleting a cue or the markers',
        key: ['z', 'Z'],
        command: true,
        shift: false,
        run: ({ player }) => {
          if (!player.state.undo) return false;
          player.undo();
        },
      },
    ],
  },
  {
    title: 'Help',
    shortcuts: [
      {
        keys: ['?'],
        label: 'These shortcuts',
        key: ['?'],
        run: (actions) => actions.openHelp('keyboard-shortcuts'),
      },
      { keys: ['Esc'], label: 'Close a dialog' },
    ],
  },
];

const ALL = SHORTCUTS.flatMap((group) => group.shortcuts);

/**
 * The shortcut `event` asks for, if any. Without Ctrl, Cmd or Alt (Shift aside): by the key's
 * place first (the hot cues), then by the key. With Ctrl or Cmd: the shortcuts that ask for it
 * (undo). Alt, Ctrl or both (AltGr on Windows) type the brackets on some layouts (German, for
 * one: AltGr+8, Option+5 on a Mac), so the brackets count with them, by the key only.
 */
export function shortcutFor(event: KeyboardEvent): Shortcut | null {
  const bound = (shortcut: Shortcut, command = false) =>
    shortcut.run !== undefined &&
    (shortcut.command ?? false) === command &&
    (shortcut.shift === undefined || shortcut.shift === event.shiftKey);
  const byKey = (command = false) =>
    ALL.find((shortcut) => bound(shortcut, command) && shortcut.key?.includes(event.key)) ?? null;
  if (event.metaKey || event.ctrlKey || event.altKey) {
    const command = (event.metaKey || event.ctrlKey) && !event.altKey;
    const bracket = event.key === '[' || event.key === ']';
    return (command ? byKey(true) : null) ?? (bracket && !event.metaKey ? byKey() : null);
  }
  return ALL.find((shortcut) => bound(shortcut) && shortcut.code?.includes(event.code)) ?? byKey();
}

/** The held shortcut `event` lets go of, if any, whatever the modifiers by then. */
export function releasedShortcut(event: KeyboardEvent): Shortcut | null {
  return ALL.find((shortcut) => shortcut.release && shortcut.key?.includes(event.key)) ?? null;
}

/** Switches to the next visual mode (after the last one, the first again). */
export function nextVisualMode(player: Player): void {
  const index = VISUAL_MODES.indexOf(player.state.settings.visualMode);
  player.updateSettings({ visualMode: VISUAL_MODES[(index + 1) % VISUAL_MODES.length]! });
}

/**
 * Applies the previous or next preset of the visual mode on the stage: the built-in ones, then
 * yours. From custom settings, "next" starts at the first one.
 */
export function stepPreset(player: Player, direction: -1 | 1): void {
  const mode = player.state.settings.visualMode;
  if (mode === 'logoSpectrum') {
    const presets = [...BUILT_IN_PRESETS, ...loadPresets()].map((preset) => preset.settings);
    player.replaceVisuals(presets[step(presets, player.state.visuals, direction)]!);
  } else if (mode === 'kaleidoscope') {
    const presets = [...BUILT_IN_KALEIDO_PRESETS, ...loadKaleidoPresets()].map(
      (preset) => preset.settings,
    );
    player.replaceKaleido(presets[step(presets, player.state.kaleido, direction)]!);
  }
}

function step<S>(presets: readonly S[], current: S, direction: -1 | 1): number {
  const key = JSON.stringify(current);
  const index = presets.findIndex((settings) => JSON.stringify(settings) === key);
  if (index < 0) return direction > 0 ? 0 : presets.length - 1;
  return (index + direction + presets.length) % presets.length;
}
