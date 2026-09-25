/**
 * Probes the browser features the app depends on. The report tells us per machine which
 * encoders exist (hardware or software), whether WebGL2 float rendering works, and whether the
 * storage/file APIs for long exports are available.
 */

export interface EncoderProbe {
  label: string;
  codec: string;
  supported: boolean;
  /** true: a hardware encoder accepted the config; false: software only; null: unknown. */
  hardware: boolean | null;
}

export interface CapabilityReport {
  userAgent: string;
  platform: string;
  cpuThreads: number;
  deviceMemoryGb: number | null;
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  audioWorklet: boolean;
  offscreenCanvas: boolean;
  webgpu: boolean;
  webgl2: {
    supported: boolean;
    renderer: string;
    maxTextureSize: number;
    colorBufferFloat: boolean;
    floatLinearFiltering: boolean;
  };
  webCodecs: boolean;
  videoEncoders: EncoderProbe[];
  audioEncoders: EncoderProbe[];
  fileSystemAccess: boolean;
  opfs: boolean;
  storageQuotaBytes: number | null;
  storageUsageBytes: number | null;
  wakeLock: boolean;
  measureMemory: boolean;
}

export const VIDEO_TARGETS = [
  {
    label: 'H.264 1080p60 (YouTube)',
    codec: 'avc1.64002A',
    width: 1920,
    height: 1080,
    fps: 60,
    bitrate: 12e6,
  },
  {
    label: 'H.264 4K30 (YouTube)',
    codec: 'avc1.640033',
    width: 3840,
    height: 2160,
    fps: 30,
    bitrate: 40e6,
  },
  {
    label: 'H.264 1080×1920 30 (TikTok)',
    codec: 'avc1.640028',
    width: 1080,
    height: 1920,
    fps: 30,
    bitrate: 10e6,
  },
  {
    label: 'HEVC 4K30',
    codec: 'hvc1.1.6.L153.B0',
    width: 3840,
    height: 2160,
    fps: 30,
    bitrate: 30e6,
  },
  {
    label: 'VP9 1080p60',
    codec: 'vp09.00.41.08',
    width: 1920,
    height: 1080,
    fps: 60,
    bitrate: 12e6,
  },
  {
    label: 'AV1 1080p60',
    codec: 'av01.0.09M.08',
    width: 1920,
    height: 1080,
    fps: 60,
    bitrate: 10e6,
  },
] as const;

const AUDIO_TARGETS = [
  { label: 'AAC-LC 48 kHz stereo', codec: 'mp4a.40.2', bitrate: 320_000 },
  { label: 'Opus 48 kHz stereo', codec: 'opus', bitrate: 192_000 },
] as const;

async function probeVideo(target: (typeof VIDEO_TARGETS)[number]): Promise<EncoderProbe> {
  const base: VideoEncoderConfig = {
    codec: target.codec,
    width: target.width,
    height: target.height,
    framerate: target.fps,
    bitrate: target.bitrate,
  };
  const isSupported = async (hardwareAcceleration: HardwareAcceleration) => {
    try {
      const result = await VideoEncoder.isConfigSupported({ ...base, hardwareAcceleration });
      return result.supported === true;
    } catch {
      return false;
    }
  };
  const [any, hardware, software] = await Promise.all([
    isSupported('no-preference'),
    isSupported('prefer-hardware'),
    isSupported('prefer-software'),
  ]);
  return {
    label: target.label,
    codec: target.codec,
    supported: any || hardware || software,
    hardware: hardware ? true : software ? false : null,
  };
}

async function probeAudio(target: (typeof AUDIO_TARGETS)[number]): Promise<EncoderProbe> {
  try {
    const result = await AudioEncoder.isConfigSupported({
      codec: target.codec,
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: target.bitrate,
    });
    return {
      label: target.label,
      codec: target.codec,
      supported: !!result.supported,
      hardware: null,
    };
  } catch {
    return { label: target.label, codec: target.codec, supported: false, hardware: null };
  }
}

function probeWebGl2(): CapabilityReport['webgl2'] {
  const empty = {
    supported: false,
    renderer: 'n/a',
    maxTextureSize: 0,
    colorBufferFloat: false,
    floatLinearFiltering: false,
  };
  try {
    const canvas = new OffscreenCanvas(1, 1);
    const gl = canvas.getContext('webgl2');
    if (!gl) return empty;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(
      debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    );
    const report = {
      supported: true,
      renderer,
      maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
      colorBufferFloat: !!gl.getExtension('EXT_color_buffer_float'),
      floatLinearFiltering: !!gl.getExtension('OES_texture_float_linear'),
    };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return report;
  } catch {
    return empty;
  }
}

export async function probeCapabilities(): Promise<CapabilityReport> {
  const webCodecs = typeof VideoEncoder === 'function' && typeof AudioEncoder === 'function';
  const [videoEncoders, audioEncoders, storage] = await Promise.all([
    webCodecs ? Promise.all(VIDEO_TARGETS.map(probeVideo)) : Promise.resolve([]),
    webCodecs ? Promise.all(AUDIO_TARGETS.map(probeAudio)) : Promise.resolve([]),
    navigator.storage?.estimate?.().catch(() => null) ?? Promise.resolve(null),
  ]);
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: { platform?: string };
  };
  return {
    userAgent: navigator.userAgent,
    platform: nav.userAgentData?.platform ?? navigator.platform,
    cpuThreads: navigator.hardwareConcurrency,
    deviceMemoryGb: nav.deviceMemory ?? null,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
    audioWorklet: typeof AudioWorkletNode === 'function',
    offscreenCanvas: typeof OffscreenCanvas === 'function',
    webgpu: 'gpu' in navigator,
    webgl2: probeWebGl2(),
    webCodecs,
    videoEncoders,
    audioEncoders,
    fileSystemAccess: 'showSaveFilePicker' in globalThis,
    opfs: typeof navigator.storage?.getDirectory === 'function',
    storageQuotaBytes: storage?.quota ?? null,
    storageUsageBytes: storage?.usage ?? null,
    wakeLock: 'wakeLock' in navigator,
    measureMemory: 'measureUserAgentSpecificMemory' in performance,
  };
}
