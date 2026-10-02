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

/**
 * A WAV file as {@link createWav}, with an ID3v2.3 tag in an "id3 " chunk (as many tools write
 * it): a title, an artist, and a PNG as the front cover.
 */
export function createTaggedWav(
  seconds: number,
  tags: { title?: string; artist?: string; cover?: Buffer },
): Buffer {
  const frame = (id: string, body: Buffer) => {
    const header = Buffer.alloc(10);
    header.write(id, 0, 'latin1');
    header.writeUInt32BE(body.length, 4);
    return Buffer.concat([header, body]);
  };
  // Encoding 0 (ISO-8859-1) and the text.
  const text = (value: string) => Buffer.concat([Buffer.from([0]), Buffer.from(value, 'latin1')]);
  const frames: Buffer[] = [];
  if (tags.title) frames.push(frame('TIT2', text(tags.title)));
  if (tags.artist) frames.push(frame('TPE1', text(tags.artist)));
  if (tags.cover) {
    // Encoding, MIME type, picture type 3 (front cover), an empty description, the image.
    const head = Buffer.concat([
      Buffer.from([0]),
      Buffer.from('image/png\0', 'latin1'),
      Buffer.from([3, 0]),
    ]);
    frames.push(frame('APIC', Buffer.concat([head, tags.cover])));
  }
  const body = Buffer.concat(frames);
  const id3 = Buffer.alloc(10);
  id3.write('ID3', 0, 'latin1');
  id3[3] = 3;
  // The size in four bytes of seven bits.
  for (let i = 0; i < 4; i++) id3[9 - i] = (body.length >> (7 * i)) & 0x7f;
  const tag = Buffer.concat([id3, body]);
  const chunk = Buffer.alloc(8);
  chunk.write('id3 ', 0, 'latin1');
  chunk.writeUInt32LE(tag.length, 4);
  const wav = createWav(seconds);
  const padding = tag.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
  const file = Buffer.concat([wav, chunk, tag, padding]);
  file.writeUInt32LE(file.length - 8, 4);
  return file;
}
