import type { Player } from '../core/player/player';
import { BUILT_IN_KALEIDO_PRESETS } from '../core/render/kaleido-settings';
import { BUILT_IN_PRESETS } from '../core/render/visual-settings';
import { VISUAL_MODES } from '../core/state/app-state';
import { loadKaleidoPresets, loadPresets } from '../core/state/persistence';

/**
 * The keyboard shortcuts (UI-04), as the help lists them: the keys (alternatives side by side;
 * " + " joins a combination), then what they do.
 */
export const SHORTCUTS: readonly { title: string; keys: readonly [string[], string][] }[] = [
  {
    title: 'Playback',
    keys: [
      [['Space'], 'Play or pause'],
      [['←', '→'], 'Back or forward 5 s (with Shift: 30 s)'],
      [['N', 'P'], 'Next or previous track'],
      [['S'], 'Shuffle on or off'],
      [['R'], 'Repeat: off, the queue, the track'],
    ],
  },
  {
    title: 'Cues and markers',
    keys: [
      [['1–8'], 'Jump to a hot cue, or set it where it is empty'],
      [['Shift + 1–8'], 'Delete a hot cue'],
      [['I', 'O'], 'Set the in or out marker (with Shift: clear it)'],
      [['Q'], 'Snap markers and cues to the beat, or not'],
      [['W'], 'Detail waveform on or off'],
    ],
  },
  {
    title: 'Tempo',
    keys: [
      [['−', '+'], 'Tempo down or up by 0.1 %'],
      [[',', '.'], 'Hold to slow down or speed up'],
    ],
  },
  {
    title: 'Visuals',
    keys: [
      [['V'], 'Next visual mode'],
      [['[', ']'], 'Previous or next preset'],
      [['F'], 'Fullscreen'],
    ],
  },
  {
    title: 'A track in the queue',
    keys: [
      [['Enter'], 'Play it'],
      [['Delete'], 'Remove it'],
      [['Alt + ↑', 'Alt + ↓'], 'Move it up or down'],
    ],
  },
  {
    title: 'Help',
    keys: [
      [['?'], 'These shortcuts'],
      [['Esc'], 'Close a dialog'],
    ],
  },
];

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
