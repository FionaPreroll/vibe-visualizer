/** Minimal WAV reader for the evaluation scripts: PCM 16/24/32-bit and 32-bit float. */
export interface WavAudio {
  sampleRate: number;
  channels: Float32Array[];
}

export function readWav(bytes: Uint8Array): WavAudio {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  let format = 0;
  let channelCount = 0;
  let sampleRate = 0;
  let bits = 0;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = view.getUint16(body, true);
      channelCount = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the first two bytes of the sub-format GUID.
      if (format === 0xfffe) format = view.getUint16(body + 24, true);
    } else if (id === 'data') {
      const bytesPerSample = bits / 8;
      const frames = Math.floor(
        Math.min(size, bytes.length - body) / (bytesPerSample * channelCount),
      );
      const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channelCount; c++) {
          const at = body + (i * channelCount + c) * bytesPerSample;
          channels[c]![i] = decodeSample(view, at, format, bits);
        }
      }
      return { sampleRate, channels };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV file without a data chunk');
}

function decodeSample(view: DataView, at: number, format: number, bits: number): number {
  if (format === 3 && bits === 32) return view.getFloat32(at, true);
  if (format !== 1) throw new Error(`Unsupported WAV format ${format}/${bits}`);
  switch (bits) {
    case 16:
      return view.getInt16(at, true) / 32768;
    case 24: {
      const value = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16);
      return value / 8388608;
    }
    case 32:
      return view.getInt32(at, true) / 2147483648;
    default:
      throw new Error(`Unsupported PCM bit depth ${bits}`);
  }
}
