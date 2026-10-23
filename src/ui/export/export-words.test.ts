import { describe, expect, it } from 'vitest';
import { DEFAULT_SOUND } from '../../core/audio/dsp/sound-settings';
import { DEFAULT_AUTO_PRESETS } from '../../core/render/preset-director';
import { newTrack } from '../../core/state/app-state';
import {
  codecLabel,
  hasColors,
  namesOf,
  rangeLabel,
  readyText,
  remaining,
  soundSummary,
  switchingSummary,
} from './export-words';

const track = (marks = { in: null as number | null, out: null as number | null }) => ({
  ...newTrack('a', { name: 'a.wav', size: 1 }),
  duration: 200,
  marks,
});

describe('what the export dialog says', () => {
  it('says what is ready, also of a batch, and of sounds', () => {
    expect(readyText(1, 1, 'Set.mp4')).toBe('Your video is ready.');
    expect(readyText(3, 3, 'Set.mp4')).toBe('Your 3 videos are ready.');
    expect(readyText(2, 3, 'Set.wav')).toBe('2 of 3 sounds are ready.');
  });

  it('names tracks in a sentence', () => {
    expect(namesOf([])).toBe('');
    expect(namesOf(['A'])).toBe('A');
    expect(namesOf(['A', 'B', 'C'])).toBe('A, B and C');
  });

  it('gives the play range of a track, and where it lies when it is marked', () => {
    expect(rangeLabel(track())).toBe('3:20');
    expect(rangeLabel(track({ in: 20, out: 80 }))).toBe('1:00 (0:20–1:20)');
  });

  it('sums the sound, the encoders and the switching of the presets up', () => {
    expect(soundSummary(DEFAULT_SOUND)).toBe('As the file sounds');
    expect(
      soundSummary({ ...DEFAULT_SOUND, rate: 0.85, tempoMode: 'keylock', reverbOn: true }),
    ).toBe('85 % speed, key lock, reverb');
    expect(
      codecLabel({
        video: 'avc',
        videoCodecString: null,
        audio: 'aac',
        container: 'mp4',
      } as Parameters<typeof codecLabel>[0]),
    ).toBe('H.264 + AAC, MP4');
    expect(switchingSummary({ ...DEFAULT_AUTO_PRESETS, trigger: 'bars', bars: 1 })).toBe(
      'switching presets every 1 bar',
    );
    expect(switchingSummary({ ...DEFAULT_AUTO_PRESETS, trigger: 'drops' })).toBe(
      'switching presets on the drops',
    );
  });

  it('says how long is left, roughly', () => {
    expect(remaining(null)).toBe('');
    expect(remaining(42)).toBe('less than a minute left');
    expect(remaining(130)).toBe('about 3:00 left');
  });

  it('knows a track with colours of its own', () => {
    expect(hasColors(track())).toBe(false);
    expect(hasColors({ ...track(), coverUrl: 'blob:cover' })).toBe(true);
    expect(hasColors({ ...track(), colors: { source: 'own', colors: [] } } as never)).toBe(true);
  });
});
