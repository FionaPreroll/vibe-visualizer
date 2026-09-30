/** Builds a 16-bit stereo WAV file with a tone and a click every half second. */
export function createWav(seconds: number, sampleRate = 44100): Buffer {
  return createBeatWav([{ seconds, bpm: 120 }], sampleRate);
}

/**
 * Builds a 16-bit stereo WAV file with a tone and a click on every beat: `sections` one after
 * the other, each so many seconds at its tempo.
 */
export function createBeatWav(
  sections: readonly { seconds: number; bpm: number }[],
  sampleRate = 44100,
): Buffer {
  const seconds = sections.reduce((sum, section) => sum + section.seconds, 0);
  const frames = Math.round(seconds * sampleRate);
  // The click of each frame: 5 ms from each beat on.
  const clicks = new Uint8Array(frames);
  let start = 0;
  for (const section of sections) {
    const end = start + section.seconds;
    for (let beat = start; beat < end - 1e-9; beat += 60 / section.bpm) {
      const from = Math.round(beat * sampleRate);
      clicks.fill(1, from, Math.min(frames, from + Math.round(0.005 * sampleRate)));
    }
    start = end;
  }
  const dataBytes = frames * 4;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(2, 22); // channels
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const click = clicks[i] ? 0.5 : 0;
    const value = Math.round((Math.sin(2 * Math.PI * 440 * t) * 0.25 + click) * 32767);
    buffer.writeInt16LE(value, 44 + i * 4);
    buffer.writeInt16LE(value, 46 + i * 4);
  }
  return buffer;
}
