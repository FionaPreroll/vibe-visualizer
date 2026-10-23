import { isClean, type SoundSettings } from '../../core/audio/dsp/sound-settings';
import { isSoundFile, type ExportCodecs } from '../../core/export/export-job';
import type { RunningExport } from '../../core/export/exporter';
import type { AutoPresets } from '../../core/render/preset-director';
import { shownCover, trackRange, type Track } from '../../core/state/app-state';
import { formatDuration } from '../../core/util/format';

/** What the export dialog says about an export, in words (#56). */

/** What a running export does, in a few words. */
export const PHASES: Record<RunningExport['phase'], string> = {
  starting: 'Preparing',
  audio: 'Analysing and encoding the audio',
  video: 'Rendering the video',
  join: 'Writing the file',
};

/** "Your video is ready.", or how many of a batch's videos are; for sounds, "sound". */
export function readyText(count: number, planned: number, fileName: string): string {
  const [one, many] = isSoundFile(fileName) ? ['sound', 'sounds'] : ['video', 'videos'];
  if (count < planned) return `${count} of ${planned} ${many} are ready.`;
  return count === 1 ? `Your ${one} is ready.` : `Your ${count} ${many} are ready.`;
}

/** "A", "A and B", "A, B and C". */
export function namesOf(names: readonly string[]): string {
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Whether `entry` has colours of its own for the visuals (VE-12): its cover's or as set. */
export function hasColors(entry: Track): boolean {
  const source = entry.colors?.source ?? 'cover';
  return source === 'own' || (source === 'cover' && shownCover(entry) !== null);
}

/** How the presets switch, for the summary. */
export function switchingSummary(config: AutoPresets): string {
  if (config.trigger === 'drops') return 'switching presets on the drops';
  if (config.trigger === 'bars') {
    return `switching presets every ${config.bars} bar${config.bars === 1 ? '' : 's'}`;
  }
  return `switching presets every ${config.seconds.toFixed(0)} s`;
}

/** The play range of `entry` in a few words: its length, and where it is if it is marked. */
export function rangeLabel(entry: Track): string {
  const duration = entry.duration ?? 0;
  const range = trackRange(entry, true) ?? { start: 0, end: duration };
  const length = formatDuration(range.end - range.start);
  if (range.start <= 0 && range.end >= duration) return length;
  return `${length} (${formatDuration(range.start)}–${formatDuration(range.end)})`;
}

/** "H.264 + AAC, MP4". */
export function codecLabel(value: ExportCodecs): string {
  const video = value.video === 'avc' ? 'H.264' : 'VP9';
  const audio = value.audio === 'aac' ? 'AAC' : 'Opus';
  return `${video} + ${audio}, ${value.container.toUpperCase()}`;
}

/** The sound in a few words, e.g. "85 % speed, key lock, reverb". */
export function soundSummary(value: SoundSettings): string {
  if (isClean(value)) return 'As the file sounds';
  const parts: string[] = [];
  if (value.rate !== 1) {
    parts.push(`${(value.rate * 100).toFixed(1).replace(/\.0$/, '')} % speed`);
    parts.push(value.tempoMode === 'keylock' ? 'key lock' : 'vinyl');
  }
  if (value.filter !== 0) parts.push(value.filter < 0 ? 'low-pass filter' : 'high-pass filter');
  if (value.delayOn) parts.push('delay');
  if (value.reverbOn) parts.push('reverb');
  return parts.join(', ');
}

/** How long a running export has left, roughly. */
export function remaining(seconds: number | null): string {
  if (seconds === null) return '';
  if (seconds < 60) return 'less than a minute left';
  return `about ${formatDuration(Math.ceil(seconds / 60) * 60)} left`;
}
