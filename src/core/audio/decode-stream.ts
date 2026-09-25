import { AudioSampleSink, type AudioSample, type InputAudioTrack } from 'mediabunny';
import { Resampler } from './resampler';

/**
 * The decoded audio of `track` from `startFrame` on (frames at the output rate), as blocks of
 * planes: one plane for mono files, two for everything else (only the first two channels are
 * kept). `resampler` converts to the output rate; null when the file already has it. Silence
 * before the start of the file comes from the resampler.
 *
 * The live engine and the export both decode through here, so they get exactly the same
 * samples (the resampler's output does not depend on how the input is chunked).
 */
export async function* decodeAtRate(
  track: InputAudioTrack,
  resampler: Resampler | null,
  startFrame: number,
): AsyncGenerator<Float32Array[]> {
  const rate = track.sampleRate;
  const channels = resampler?.channels ?? Math.min(2, track.numberOfChannels);
  let nextInputFrame = resampler ? resampler.reset(startFrame) : startFrame;
  const sink = new AudioSampleSink(track);
  for await (const sample of sink.samples(nextInputFrame / rate)) {
    const sampleStart = Math.round(sample.timestamp * rate);
    const skip = Math.max(0, nextInputFrame - sampleStart);
    if (skip >= sample.numberOfFrames) {
      sample.close();
      continue;
    }
    const planes = toPlanes(sample, skip, channels);
    nextInputFrame = sampleStart + sample.numberOfFrames;
    sample.close();
    yield resampler ? resampler.push(planes, planes[0]!.length) : planes;
  }
  if (resampler) yield resampler.flush();
}

/** Copies up to `channels` channels of `sample`, from frame `skip` on. */
function toPlanes(sample: AudioSample, skip: number, channels: number): Float32Array[] {
  const frames = sample.numberOfFrames - skip;
  const planes: Float32Array[] = [];
  for (let c = 0; c < Math.min(channels, sample.numberOfChannels); c++) {
    const plane = new Float32Array(frames);
    sample.copyTo(plane, {
      planeIndex: c,
      format: 'f32-planar',
      frameOffset: skip,
      frameCount: frames,
    });
    planes.push(plane);
  }
  return planes;
}
