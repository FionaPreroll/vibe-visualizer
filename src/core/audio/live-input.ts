/**
 * Opens live audio sources (IN-01, IN-02): an audio input (line-in, microphone, virtual audio
 * device) or the audio of another tab or the whole system, through the browser's screen-share
 * dialog. The browser's voice processing is switched off, so music stays clean.
 */

export type LiveSourceKind = 'device' | 'display';

export interface InputDevice {
  id: string;
  label: string;
}

export interface OpenedInput {
  stream: MediaStream;
  kind: LiveSourceKind;
  /** The device (for audio inputs); null for shared tabs and screens. */
  deviceId: string | null;
  label: string;
}

/** Music, not speech: no echo cancellation, noise suppression or automatic gain. */
const MUSIC: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: { ideal: 2 },
};

/** What this browser offers. */
export function liveInputSupport(): { devices: boolean; display: boolean } {
  const media = globalThis.isSecureContext ? navigator.mediaDevices : undefined;
  return {
    devices: typeof media?.getUserMedia === 'function',
    display: typeof media?.getDisplayMedia === 'function',
  };
}

/** The audio inputs; their names are only known after access was allowed once. */
export async function listInputDevices(): Promise<InputDevice[]> {
  if (!liveInputSupport().devices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'audioinput' && device.deviceId)
    .map((device, index) => ({ id: device.deviceId, label: device.label || `Input ${index + 1}` }));
}

/** Opens an audio input: `deviceId`, or the default input for null (or when it is gone). */
export async function openDevice(deviceId: string | null): Promise<OpenedInput> {
  if (!liveInputSupport().devices) throw new Error(unsupported());
  const open = (id: string | null) =>
    navigator.mediaDevices.getUserMedia({
      audio: id ? { ...MUSIC, deviceId: { exact: id } } : MUSIC,
      video: false,
    });
  let stream: MediaStream;
  try {
    stream = await open(deviceId);
  } catch (error) {
    // The remembered device may be unplugged: fall back to the default input.
    const gone =
      errorName(error) === 'OverconstrainedError' || errorName(error) === 'NotFoundError';
    if (!deviceId || !gone) throw new Error(describeError(error, 'device'), { cause: error });
    try {
      stream = await open(null);
    } catch (fallback) {
      throw new Error(describeError(fallback, 'device'), { cause: fallback });
    }
  }
  const track = stream.getAudioTracks()[0]!;
  return {
    stream,
    kind: 'device',
    deviceId: track.getSettings().deviceId ?? deviceId,
    label: track.label || 'Audio input',
  };
}

/**
 * Asks the browser for the audio of a tab, a window or the screen (IN-02). Browsers require a
 * video track as well; it is stopped right away.
 */
export async function openDisplay(): Promise<OpenedInput> {
  if (!liveInputSupport().display) throw new Error(unsupported());
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { ...MUSIC, suppressLocalAudioPlayback: false },
      // Chromium options: offer system audio, and never this app's own tab (it would feed back).
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
    } as DisplayMediaStreamOptions);
  } catch (error) {
    throw new Error(describeError(error, 'display'), { cause: error });
  }
  const audio = stream.getAudioTracks();
  const video = stream.getVideoTracks()[0];
  const surface = (video?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
  for (const track of stream.getVideoTracks()) track.stop();
  if (audio.length === 0) {
    throw new Error(
      surface === 'browser'
        ? 'The tab was shared without its sound. Share it again and keep "Also share tab audio" switched on.'
        : 'No sound was shared. Choose a tab and keep "Also share tab audio" on, or, where the dialog offers it, "Also share system audio". Otherwise use a virtual audio device (see the help below).',
    );
  }
  const labels: Record<string, string> = {
    browser: 'Shared tab',
    window: 'Shared window',
    monitor: 'System audio',
  };
  return {
    stream: new MediaStream(audio),
    kind: 'display',
    deviceId: null,
    label: labels[surface ?? ''] ?? 'Shared audio',
  };
}

/** Stops every track of `stream`. */
export function closeInput(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function errorName(error: unknown): string {
  return error instanceof DOMException || error instanceof Error ? error.name : '';
}

function unsupported(): string {
  return globalThis.isSecureContext
    ? 'This browser cannot capture audio.'
    : 'Live input needs a secure connection (https or localhost).';
}

/** A message that says what went wrong and what to do. */
export function describeError(error: unknown, kind: LiveSourceKind): string {
  switch (errorName(error)) {
    case 'NotAllowedError':
      return kind === 'display'
        ? 'Sharing was cancelled or is not allowed.'
        : 'Access to audio inputs was denied. Allow it for this site (the icon in the address bar), then try again.';
    case 'NotFoundError':
      return 'No audio input was found. Connect one, or install a virtual audio device (see the help below).';
    case 'NotReadableError':
    case 'AbortError':
      return 'The input could not be opened. Another app may be using it, or the system blocks access.';
    case 'OverconstrainedError':
      return 'This input is not available any more.';
    case 'NotSupportedError':
      return 'This browser cannot capture audio from this source.';
    case 'SecurityError':
      return 'Live input needs a secure connection (https or localhost).';
    default:
      return error instanceof Error ? error.message : String(error);
  }
}
