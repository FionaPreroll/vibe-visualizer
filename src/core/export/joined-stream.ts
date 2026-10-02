import { decodeAtRate, openInput } from '../audio/decode-stream';
import { Resampler } from '../audio/resampler';
import { CROSSFADE_SECONDS, StreamJoiner } from '../audio/stream-joiner';
import { EXPORT_RATE } from './export-job';

/** A part of an export's stream: frames of a file at the export rate, to its end on null. */
export interface StreamPart {
  file: File;
  from: number;
  end: number | null;
}

/**
 * The decoded parts of an export, one after the other as the player joins the queue (EX-05):
 * two planes at the export rate. `onPart` learns the stream frame at which each part after the
 * first starts, as decoded.
 */
export async function* joinedStream(
  parts: readonly StreamPart[],
  onPart: (index: number, frame: number) => void = () => undefined,
): AsyncGenerator<Float32Array[]> {
  const joiner = new StreamJoiner(Math.max(1, Math.round(CROSSFADE_SECONDS * EXPORT_RATE)));
  let written = 0;
  for (let index = 0; index < parts.length; index++) {
    const { file, from, end } = parts[index]!;
    if (index > 0) onPart(index, written);
    const input = openInput(file);
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) throw new Error(`${file.name} contains no audio track.`);
      if (!(await track.canDecode())) {
        throw new Error(
          `This browser cannot decode ${track.codec ?? 'the audio of'} ${file.name}.`,
        );
      }
      const resampler =
        track.sampleRate === EXPORT_RATE
          ? null
          : new Resampler(Math.min(2, track.numberOfChannels), track.sampleRate, EXPORT_RATE);
      joiner.begin(from, index === 0);
      let position = from;
      for await (const decoded of decodeAtRate(track, resampler, from)) {
        // Started in the middle of the file, the resampler may give nothing yet.
        if (decoded[0]!.length === 0) continue;
        let count = decoded[0]!.length;
        if (end !== null) count = Math.max(0, Math.min(count, end - position));
        if (count === 0) break;
        // Two planes of their own: the joiner fades them in place (a mono file gets a copy).
        const planes = [
          decoded[0]!.subarray(0, count),
          decoded[1]?.subarray(0, count) ?? decoded[0]!.slice(0, count),
        ];
        const keep = joiner.take(planes, position, end);
        position += count;
        if (keep > 0) {
          written += keep;
          yield planes.map((plane) => plane.subarray(0, keep));
        }
        if (end !== null && position >= end) break;
      }
    } finally {
      input.dispose();
    }
    if (index + 1 < parts.length) joiner.next();
  }
  const tail = joiner.end();
  if (tail[0]!.length > 0) yield tail;
}
