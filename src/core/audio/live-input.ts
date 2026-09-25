/**
 * Opens live audio sources (IN-01, IN-02): an audio input (line-in, microphone, virtual audio
 * device) or the audio of another tab or the whole system, through the browser's screen-share
 * dialog. The browser's voice processing is switched off, so music stays clean.
 */

export type LiveSourceKind = 'device' | 'display';

/** An audio input. Ids can change between sessions, so the name is kept too. */
export interface InputDevice {
  id: string;
  label: string;
}

export interface OpenedInput {
  stream: MediaStream;
  kind: LiveSourceKind;
  /** The input that was opened; null for the default input and for shared tabs and screens. */
  device: InputDevice | null;
  label: string;
}

/** Chromium's aliases for the system's default devices ("Default input" covers them). */
const ALIASES = ['default', 'communications'];

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
    .filter(
      (device) =>
        device.kind === 'audioinput' && device.deviceId && !ALIASES.includes(device.deviceId),
    )
    .map((device, index) => ({ id: device.deviceId, label: device.label || `Input ${index + 1}` }));
}

/**
 * Opens an audio input: `wanted`, or the default input for null. Browsers may give a device a
 * new id in a new session (unless access was allowed permanently), so an input whose id is
 * unknown is looked up by its name once access is allowed; if it is gone, the default input
 * is used.
 */
export async function openDevice(wanted: InputDevice | null): Promise<OpenedInput> {
  if (!liveInputSupport().devices) throw new Error(unsupported());
  const open = (id: string | null) =>
    navigator.mediaDevices.getUserMedia({
      audio: id ? { ...MUSIC, deviceId: { exact: id } } : MUSIC,
      video: false,
    });
  if (wanted) {
    try {
      return opened(await open(wanted.id));
    } catch (error) {
      const gone =
        errorName(error) === 'OverconstrainedError' || errorName(error) === 'NotFoundError';
      if (!gone) throw new Error(describeError(error, 'device'), { cause: error });
    }
  }
  let stream: MediaStream;
  try {
    stream = await open(null);
  } catch (error) {
    throw new Error(describeError(error, 'device'), { cause: error });
  }
  const current = stream.getAudioTracks()[0]?.label;
  const match =
    wanted && wanted.label !== current
      ? (await listInputDevices()).find((device) => device.label === wanted.label)
      : undefined;
  if (match) {
    try {
      const again = await open(match.id);
      closeInput(stream);
      stream = again;
    } catch {
      // Keep the default input.
    }
  }
  return opened(stream);
}

function opened(stream: MediaStream): OpenedInput {
  const track = stream.getAudioTracks()[0]!;
  const id = track.getSettings().deviceId ?? '';
  const label = track.label || 'Audio input';
  return {
    stream,
    kind: 'device',
    device: id && !ALIASES.includes(id) ? { id, label } : null,
    label,
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
    device: null,
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
