import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  NullTarget,
  Output,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type VideoCodec,
} from 'mediabunny';
import { renderTestSignal } from '../../core/audio/test-signal';
import { exposeWorker, withTransfer } from '../../core/util/worker-rpc';
import { GlTestPattern } from '../../core/video/test-pattern-gl';

const AUDIO_RATE = 48000;

export interface VideoBenchmarkArgs {
  codec: VideoCodec;
  /** Explicit codec string, e.g. H.264 level 4.2 for 1080p60 (Mediabunny would pick 4.0). */
  fullCodecString?: string;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  seconds: number;
}

export interface VideoBenchmarkResult {
  frames: number;
  elapsedMs: number;
  fps: number;
  encoderCodec: string;
}

export interface AudioBenchmarkResult {
  encoder: 'native' | 'wasm';
  seconds: number;
  elapsedMs: number;
  realtimeFactor: number;
}

export interface SampleFileResult {
  buffer: ArrayBuffer;
  videoCodec: VideoCodec;
  audioCodec: AudioCodec;
  aacEncoder: 'native' | 'wasm' | null;
}

let aacEncoder: 'native' | 'wasm' | null = null;

/** Makes AAC encodable: natively if the browser can, otherwise via the WebAssembly encoder. */
async function ensureAac(): Promise<'native' | 'wasm' | null> {
  if (aacEncoder) return aacEncoder;
  const options = { numberOfChannels: 2, sampleRate: AUDIO_RATE, bitrate: 320_000 };
  if (await canEncodeAudio('aac', options)) {
    aacEncoder = 'native';
  } else {
    const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
    registerAacEncoder();
    aacEncoder = (await canEncodeAudio('aac', options)) ? 'wasm' : null;
  }
  return aacEncoder;
}

function createAudioChunk(startFrame: number, frames: number, beep: boolean): AudioSample {
  const data = new Float32Array(frames * 2);
  const planes = [data.subarray(0, frames), data.subarray(frames)];
  renderTestSignal(planes, startFrame, frames, AUDIO_RATE, { beepEverySecond: beep });
  return new AudioSample({
    data,
    format: 'f32-planar',
    numberOfChannels: 2,
    sampleRate: AUDIO_RATE,
    timestamp: startFrame / AUDIO_RATE,
  });
}

async function videoBenchmark(args: VideoBenchmarkArgs): Promise<VideoBenchmarkResult> {
  const pattern = new GlTestPattern(args.width, args.height);
  let encoderCodec = '';
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new NullTarget(),
  });
  const source = new CanvasSource(pattern.canvas, {
    codec: args.codec,
    fullCodecString: args.fullCodecString,
    bitrate: args.bitrate,
    keyFrameInterval: 2,
    onEncoderConfig: (config) => (encoderCodec = config.codec),
  });
  output.addVideoTrack(source, { frameRate: args.fps });
  await output.start();

  const frames = Math.round(args.seconds * args.fps);
  const start = performance.now();
  for (let i = 0; i < frames; i++) {
    pattern.draw(i / args.fps);
    await source.add(i / args.fps, 1 / args.fps);
  }
  await output.finalize();
  const elapsedMs = performance.now() - start;
  pattern.dispose();
  return { frames, elapsedMs, fps: frames / (elapsedMs / 1000), encoderCodec };
}

async function audioBenchmark(args: {
  seconds: number;
  forceWasm?: boolean;
}): Promise<AudioBenchmarkResult> {
  if (args.forceWasm && !aacEncoder) {
    // Registered custom encoders take precedence over the browser's own.
    const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
    registerAacEncoder();
    aacEncoder = 'wasm';
  }
  const encoder = await ensureAac();
  if (!encoder) throw new Error('AAC encoding is not available, not even via WebAssembly');
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new NullTarget(),
  });
  const source = new AudioSampleSource({ codec: 'aac', bitrate: 320_000 });
  output.addAudioTrack(source);
  await output.start();
  const total = Math.round(args.seconds * AUDIO_RATE);
  const chunk = 4096;
  const start = performance.now();
  for (let frame = 0; frame < total; frame += chunk) {
    const sample = createAudioChunk(frame, Math.min(chunk, total - frame), false);
    await source.add(sample);
    sample.close();
  }
  await output.finalize();
  const elapsedMs = performance.now() - start;
  return {
    encoder,
    seconds: args.seconds,
    elapsedMs,
    realtimeFactor: args.seconds / (elapsedMs / 1000),
  };
}

/** Draws an A/V sync test frame: the white flash coincides with the audio beep. */
function drawSyncFrame(ctx: OffscreenCanvasRenderingContext2D, time: number, frame: number) {
  const { width, height } = ctx.canvas;
  const hue = (time * 36) % 360;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, `hsl(${hue} 70% 25%)`);
  gradient.addColorStop(1, `hsl(${(hue + 120) % 360} 70% 12%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const second = time % 1;
  if (second < 0.05) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(width * 0.35, height * 0.62, width * 0.3, height * 0.12);
  }
  ctx.fillStyle = '#3fd9ff';
  ctx.fillRect(second * width, height * 0.8, width * 0.01, height * 0.05);

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = `bold ${Math.round(height * 0.09)}px sans-serif`;
  ctx.fillText('Vibe Visualizer sync test', width / 2, height * 0.3);
  ctx.font = `${Math.round(height * 0.07)}px monospace`;
  ctx.fillText(`${time.toFixed(2)} s · frame ${frame}`, width / 2, height * 0.45);
}

async function sampleFile(args: {
  seconds: number;
  width: number;
  height: number;
  fps: number;
}): Promise<unknown> {
  const avc = await canEncodeVideo('avc', {
    width: args.width,
    height: args.height,
    bitrate: 12e6,
  });
  const videoCodec: VideoCodec = avc ? 'avc' : 'vp9';
  const aac = await ensureAac();
  const audioCodec: AudioCodec = aac ? 'aac' : 'opus';

  const canvas = new OffscreenCanvas(args.width, args.height);
  const ctx = canvas.getContext('2d')!;
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const video = new CanvasSource(canvas, {
    codec: videoCodec,
    // H.264 High profile, level 4.2: required for 1080p at 60 fps.
    fullCodecString: videoCodec === 'avc' ? 'avc1.64002A' : undefined,
    bitrate: 12e6,
    keyFrameInterval: 2,
  });
  const audio = new AudioSampleSource({
    codec: audioCodec,
    bitrate: audioCodec === 'aac' ? 320_000 : 192_000,
  });
  output.addVideoTrack(video, { frameRate: args.fps });
  output.addAudioTrack(audio);
  await output.start();

  const frames = Math.round(args.seconds * args.fps);
  let audioFrame = 0;
  for (let i = 0; i < frames; i++) {
    const time = i / args.fps;
    drawSyncFrame(ctx, time, i);
    await video.add(time, 1 / args.fps);
    const audioEnd = Math.round(((i + 1) / args.fps) * AUDIO_RATE);
    if (audioEnd > audioFrame) {
      const sample = createAudioChunk(audioFrame, audioEnd - audioFrame, true);
      await audio.add(sample);
      sample.close();
      audioFrame = audioEnd;
    }
  }
  await output.finalize();
  const buffer = target.buffer!;
  const result: SampleFileResult = { buffer, videoCodec, audioCodec, aacEncoder: aac };
  return withTransfer(result, [buffer]);
}

exposeWorker({ videoBenchmark, audioBenchmark, sampleFile });
