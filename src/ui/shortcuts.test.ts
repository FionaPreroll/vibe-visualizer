import { describe, expect, it, vi } from 'vitest';
import type { Player } from '../core/player/player';
import {
  releasedShortcut,
  SHORTCUTS,
  shortcutFor,
  type Shortcut,
  type ShortcutActions,
} from './shortcuts';

/** A key pressed: its character, its place, and the modifiers held. */
function press(
  key: string,
  code = '',
  modifiers: Partial<Pick<KeyboardEvent, 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>> = {},
): KeyboardEvent {
  return {
    key,
    code,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    ...modifiers,
  } as KeyboardEvent;
}

const ALL = SHORTCUTS.flatMap((group) => group.shortcuts);
const labelOf = (event: KeyboardEvent) => shortcutFor(event)?.label ?? null;
const labelled = (label: string) => ALL.find((shortcut) => shortcut.label === label)!;

describe('the keyboard shortcuts (UI-04)', () => {
  it('each have keys and a text for the help, and keys to answer to where they act', () => {
    for (const shortcut of ALL) {
      expect(shortcut.keys.length, shortcut.label).toBeGreaterThan(0);
      expect(shortcut.label).not.toBe('');
      const bound = (shortcut.key?.length ?? 0) + (shortcut.code?.length ?? 0) > 0;
      // What acts here answers to keys; what only shows in the help is handled elsewhere.
      expect(bound, shortcut.label).toBe(shortcut.run !== undefined);
    }
    const labels = ALL.map((shortcut) => shortcut.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('bind no key twice', () => {
    const bindings = ALL.filter((shortcut) => shortcut.run).flatMap((shortcut: Shortcut) => {
      const shifts = shortcut.shift === undefined ? [false, true] : [shortcut.shift];
      const keys = [
        ...(shortcut.key ?? []).map((key) => `key ${key}`),
        ...(shortcut.code ?? []).map((code) => `code ${code}`),
      ];
      return keys.flatMap((key) =>
        shifts.map((shift) => `${shortcut.command ? 'Ctrl ' : ''}${shift ? 'Shift ' : ''}${key}`),
      );
    });
    const twice = bindings.filter((binding, index) => bindings.indexOf(binding) !== index);
    expect(twice).toEqual([]);
  });

  it('find the shortcut of a key, the hot cues by their place', () => {
    expect(labelOf(press(' ', 'Space'))).toBe('Play or pause');
    expect(labelOf(press('3', 'Digit3'))).toBe('Jump to a hot cue, or set it where it is empty');
    expect(labelOf(press('#', 'Digit3', { shiftKey: true }))).toBe('Delete a hot cue');
    // On a French keyboard, the key of 6 gives "-": it is a hot cue still, not the tempo.
    expect(labelOf(press('-', 'Digit6'))).toBe('Jump to a hot cue, or set it where it is empty');
    expect(labelOf(press('-', 'Minus'))).toBe('Tempo down or up by 0.1 %');
    expect(labelOf(press('I', 'KeyI', { shiftKey: true }))).toBe(
      'Set the in or out marker (with Shift: clear it)',
    );
    expect(labelOf(press('x', 'KeyX'))).toBeNull();
  });

  it('leave keys with Ctrl, Cmd or Alt to the browser, but for undo and the brackets', () => {
    const undo = 'Undo removing a track, clearing the queue, or deleting a cue or the markers';
    expect(labelOf(press('z', 'KeyZ', { ctrlKey: true }))).toBe(undo);
    expect(labelOf(press('z', 'KeyZ', { metaKey: true }))).toBe(undo);
    expect(labelOf(press('z', 'KeyZ'))).toBeNull();
    expect(labelOf(press('z', 'KeyZ', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(labelOf(press('n', 'KeyN', { ctrlKey: true }))).toBeNull();
    expect(labelOf(press('n', 'KeyN', { altKey: true }))).toBeNull();
    expect(labelOf(press('1', 'Digit1', { metaKey: true }))).toBeNull();
    // AltGr (Ctrl and Alt on Windows) or Option gives the brackets on some layouts: on a German
    // one, [ is AltGr+8 (Option+5 on a Mac), which is not hot cue 8 (5) then.
    const preset = 'Previous or next preset';
    expect(labelOf(press('[', 'Digit8', { ctrlKey: true, altKey: true }))).toBe(preset);
    expect(labelOf(press(']', 'Digit9', { altKey: true }))).toBe(preset);
    expect(labelOf(press('[', 'BracketLeft', { ctrlKey: true }))).toBe(preset);
    expect(labelOf(press('[', 'BracketLeft', { metaKey: true }))).toBeNull();
  });

  it('act on the player and the shell', () => {
    const player = {
      position: 40,
      state: { settings: { repeat: 'off', shuffle: false }, undo: null },
      seek: vi.fn(),
      setCue: vi.fn(),
      mark: vi.fn(),
      nudge: vi.fn(),
      updateSettings: vi.fn(),
      undo: vi.fn(),
    };
    const actions = {
      player: player as unknown as Player,
      toggleFullscreen: vi.fn(),
      toggleMiniPlayer: vi.fn(),
      takePicture: vi.fn(),
      openHelp: vi.fn(),
    } satisfies ShortcutActions;
    const run = (event: KeyboardEvent) => shortcutFor(event)!.run!(actions, event);

    run(press('ArrowLeft', 'ArrowLeft', { shiftKey: true }));
    expect(player.seek).toHaveBeenLastCalledWith(10);
    run(press('ArrowRight', 'ArrowRight'));
    expect(player.seek).toHaveBeenLastCalledWith(45);
    run(press('*', 'Digit8', { shiftKey: true }));
    expect(player.setCue).toHaveBeenLastCalledWith(7, null);
    run(press('O', 'KeyO', { shiftKey: true }));
    expect(player.mark).toHaveBeenLastCalledWith('out', null);
    run(press('r', 'KeyR'));
    expect(player.updateSettings).toHaveBeenLastCalledWith({ repeat: 'all' });
    run(press('?', 'Slash', { shiftKey: true }));
    expect(actions.openHelp).toHaveBeenCalledWith('keyboard-shortcuts');
    // Nothing to undo: the key goes on to the browser.
    expect(run(press('z', 'KeyZ', { ctrlKey: true }))).toBe(false);
    expect(player.undo).not.toHaveBeenCalled();

    // Held to nudge, and let go, also with a modifier pressed meanwhile.
    run(press(',', 'Comma'));
    expect(player.nudge).toHaveBeenLastCalledWith(-1);
    releasedShortcut(press(',', 'Comma', { ctrlKey: true }))!.release!(actions);
    expect(player.nudge).toHaveBeenLastCalledWith(0);
    expect(labelled('Hold to slow down or speed up').release).toBeDefined();
  });
});
