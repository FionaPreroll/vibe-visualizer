import {
  DEFAULT_SOUND,
  rateLimits,
  sanitizeSound,
  type SoundSettings,
} from '../audio/dsp/sound-settings';
import type { LiveSourceKind } from '../audio/live-input';
import type { AspectRatio } from '../export/video-format';
import {
  DEFAULT_KALEIDO,
  sanitizeKaleido,
  sceneDefaults,
  type KaleidoSceneId,
  type KaleidoSettings,
  type ParamValue,
} from '../render/kaleido-settings';
import {
  DEFAULT_LOGO_SPECTRUM,
  sanitizeSettings,
  type LogoSpectrumSettings,
} from '../render/visual-settings';

/** Application state: the queue, what plays, and user settings. Pure data, no side effects. */

/**
 * Where a queue entry stands. From the last visit (SRC-05), an entry may be `locked` (the
 * browser asks the user before the app may read the file again) or `missing` (the file is not
 * there: it has to be added again).
 */
export type TrackStatus = 'probing' | 'ready' | 'unsupported' | 'locked' | 'missing';

/** True for the entries that can play now (or once probed). */
export function isPlayable(track: Track): boolean {
  return track.status === 'ready' || track.status === 'probing';
}

export interface Track {
  id: string;
  fileName: string;
  size: number;
  status: TrackStatus;
  /** Why the file cannot be played (status "unsupported"). */
  reason: string | null;
  title: string;
  artist: string | null;
  album: string | null;
  duration: number | null;
  sampleRate: number | null;
  codec: string | null;
  format: string | null;
  coverUrl: string | null;
  /** Recognises the file (its cues, its analysis); null until probed. */
  fingerprint: string | null;
  /** In/out markers in seconds (TR-09): the export range, e.g. a 30-second clip. */
  marks: Marks;
  /** Hot cues in seconds (TR-04), {@link CUE_COUNT} slots, null where none is set. */
  cues: Cues;
}

export interface Marks {
  in: number | null;
  out: number | null;
}

/** Hot cues per track (TR-04). */
export const CUE_COUNT = 8;
export type Cues = readonly (number | null)[];
export const NO_CUES: Cues = Array.from({ length: CUE_COUNT }, () => null);

/** What the stage shows: one of the two visual modes (VE-04) or the analysis. */
export type VisualMode = 'logoSpectrum' | 'kaleidoscope' | 'analysis';
export const VISUAL_MODES: readonly VisualMode[] = ['logoSpectrum', 'kaleidoscope', 'analysis'];

export type PanelTab = 'queue' | 'sound' | 'visuals' | 'live';
export const PANEL_TABS: readonly PanelTab[] = ['queue', 'sound', 'visuals', 'live'];

/** Input gain range in dB (IN-03). */
export const INPUT_GAIN_RANGE = { min: -24, max: 24 } as const;

/**
 * Range of the A/V sync offset in ms (AN-06): positive when the sound is heard later than the
 * browser reports (Bluetooth), negative when it reports too much.
 */
export const SYNC_OFFSET_RANGE = { min: -200, max: 500 } as const;

export interface Settings {
  volume: number;
  visualMode: VisualMode;
  panel: PanelTab;
  panelOpen: boolean;
  /** Frame of the visuals (VE-09): the stage is letterboxed to it, and the export uses it. */
  aspect: AspectRatio;
  /** Shows the safe areas of the platforms over the stage. */
  safeAreas: boolean;
  /** The audio input used last ('' for the default one), and its name (ids can change). */
  inputDevice: string;
  inputDeviceLabel: string;
  /** Gain of the live input in dB. */
  inputGain: number;
  /** Shows the detail waveform with the hot cues above the transport (TR-08). */
  detailWaveform: boolean;
  /** Plays the queue in random order (PL-04). */
  shuffle: boolean;
  /** At the end: stop, start the queue again, or repeat the track (PL-04). */
  repeat: RepeatMode;
  /** The visuals come this much later (ms), on top of the latency the browser reports (AN-06). */
  syncOffset: number;
}

export type RepeatMode = 'off' | 'all' | 'one';
export const REPEAT_MODES: readonly RepeatMode[] = ['off', 'all', 'one'];

/**
 * Live input (IN-01…04): music from an audio input or another app instead of the queue. The
 * stream itself lives in the player; this is what the UI shows.
 */
export interface LiveState {
  status: 'off' | 'starting' | 'on';
  kind: LiveSourceKind | null;
  label: string | null;
  /** Hearing the input through the app; always off at the start (feedback). */
  monitor: boolean;
  /** Why the last attempt failed or the input stopped. */
  error: string | null;
}

export const LIVE_OFF: LiveState = {
  status: 'off',
  kind: null,
  label: null,
  monitor: false,
  error: null,
};

export interface AppState {
  tracks: Track[];
  currentId: string | null;
  playing: boolean;
  settings: Settings;
  /** Parameters of the Logo Spectrum mode. */
  visuals: LogoSpectrumSettings;
  /** Parameters of the Kaleidoscope mode. */
  kaleido: KaleidoSettings;
  /** Tempo and effects (TMP, FX): what the player and the export do to the sound. */
  sound: SoundSettings;
  live: LiveState;
  error: string | null;
}

export type ProbedInfo = Pick<
  Track,
  | 'status'
  | 'reason'
  | 'artist'
  | 'album'
  | 'duration'
  | 'sampleRate'
  | 'codec'
  | 'format'
  | 'coverUrl'
  | 'fingerprint'
> & {
  title: string | null;
  /** Cues and markers stored for this file earlier (TR-05). */
  stored?: { cues: Cues; marks: Marks };
};

export type AppAction =
  | { type: 'tracks/added'; tracks: Track[] }
  /** The queue of the last visit, ahead of anything added meanwhile (SRC-05). */
  | { type: 'tracks/restored'; tracks: Track[]; currentId: string | null }
  /** The entry's file became readable (probing), or is not available (locked, missing). */
  | { type: 'tracks/access'; id: string; status: 'probing' | 'locked' | 'missing' }
  /** The listed tracks take the places they hold, in this order (sorted by track number). */
  | { type: 'tracks/arranged'; ids: string[] }
  | { type: 'tracks/probed'; id: string; info: ProbedInfo }
  | { type: 'tracks/removed'; id: string }
  | { type: 'tracks/moved'; from: number; to: number }
  | { type: 'tracks/cleared' }
  /** Sets (or clears, with null) the in or out marker of a track. */
  | { type: 'tracks/marked'; id: string; mark: 'in' | 'out'; seconds: number | null }
  /** Sets (or clears, with null) hot cue `index` of a track. */
  | { type: 'tracks/cue'; id: string; index: number; seconds: number | null }
  | { type: 'player/current'; id: string | null }
  | { type: 'player/playing'; playing: boolean }
  | { type: 'player/seeked'; seconds: number }
  | { type: 'player/error'; message: string | null }
  | { type: 'settings/changed'; changes: Partial<Settings> }
  | { type: 'visuals/changed'; changes: Partial<LogoSpectrumSettings> }
  /** A preset was applied: all visual parameters at once. */
  | { type: 'visuals/replaced'; visuals: LogoSpectrumSettings }
  /** Another Kaleidoscope scene, with the look that suits it. */
  | { type: 'kaleido/scene'; scene: KaleidoSceneId }
  /** One parameter: a common one or one of a scene. */
  | { type: 'kaleido/param'; scope: 'common' | KaleidoSceneId; key: string; value: ParamValue }
  | { type: 'kaleido/replaced'; kaleido: KaleidoSettings }
  | { type: 'sound/changed'; changes: Partial<SoundSettings> }
  /** A sound preset was applied (FX-10): all sound settings at once. */
  | { type: 'sound/replaced'; sound: SoundSettings }
  | { type: 'live/starting'; kind: LiveSourceKind }
  | { type: 'live/started'; kind: LiveSourceKind; label: string }
  /** Opening failed; `running` when the previous input keeps going. */
  | { type: 'live/failed'; message: string; running: boolean }
  /** Back to the queue; `reason` when the input ended by itself. */
  | { type: 'live/stopped'; reason: string | null }
  | { type: 'live/monitor'; monitor: boolean };

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.8,
  visualMode: 'logoSpectrum',
  panel: 'queue',
  panelOpen: true,
  aspect: '16:9',
  safeAreas: false,
  inputDevice: '',
  inputDeviceLabel: '',
  inputGain: 0,
  detailWaveform: true,
  shuffle: false,
  repeat: 'off',
  syncOffset: 0,
};

export function initialState(
  settings: Settings = DEFAULT_SETTINGS,
  visuals: LogoSpectrumSettings = DEFAULT_LOGO_SPECTRUM,
  kaleido: KaleidoSettings = DEFAULT_KALEIDO,
  sound: SoundSettings = DEFAULT_SOUND,
): AppState {
  return {
    tracks: [],
    currentId: null,
    playing: false,
    settings,
    visuals,
    kaleido,
    sound,
    live: LIVE_OFF,
    error: null,
  };
}

/** A new queue entry for `file`, before its metadata is known. */
export function newTrack(id: string, file: { name: string; size: number }): Track {
  return {
    id,
    fileName: file.name,
    size: file.size,
    status: 'probing',
    reason: null,
    title: file.name.replace(/\.[^.]+$/, ''),
    artist: null,
    album: null,
    duration: null,
    sampleRate: null,
    codec: null,
    format: null,
    coverUrl: null,
    fingerprint: null,
    marks: { in: null, out: null },
    cues: NO_CUES,
  };
}

/**
 * An entry of the last visit's queue (SRC-05) with what was known about it; `status` says
 * whether its file is there (probing) or not.
 */
export function restoredTrack(
  id: string,
  info: Pick<
    Track,
    | 'fileName'
    | 'size'
    | 'title'
    | 'artist'
    | 'album'
    | 'duration'
    | 'sampleRate'
    | 'codec'
    | 'format'
    | 'fingerprint'
  >,
  status: 'probing' | 'locked' | 'missing',
  stored: { cues: Cues; marks: Marks } | null = null,
): Track {
  return {
    ...newTrack(id, { name: info.fileName, size: info.size }),
    ...info,
    status,
    ...(stored ? { cues: stored.cues, marks: stored.marks } : {}),
  };
}

/** The cues after setting cue `index` to `seconds` (clamped to the track), or clearing it. */
export function setCue(track: Track, index: number, seconds: number | null): Cues {
  if (index < 0 || index >= CUE_COUNT) return track.cues;
  const cues = [...track.cues];
  cues[index] =
    seconds === null ? null : Math.max(0, Math.min(track.duration ?? Infinity, seconds));
  return cues;
}

/**
 * The markers after setting `mark` to `seconds` (clamped to the track). A marker on the wrong
 * side of the other one clears the other.
 */
export function setMark(track: Track, mark: 'in' | 'out', seconds: number | null): Marks {
  const value =
    seconds === null ? null : Math.max(0, Math.min(track.duration ?? Infinity, seconds));
  if (mark === 'in') {
    const out = value !== null && track.marks.out !== null && track.marks.out <= value;
    return { in: value, out: out ? null : track.marks.out };
  }
  const clearIn = value !== null && track.marks.in !== null && track.marks.in >= value;
  return { in: clearIn ? null : track.marks.in, out: value };
}

/**
 * The part of `track` to export: between the markers (a missing one means the start or the end)
 * or the whole track. Null while the duration is unknown.
 */
export function trackRange(track: Track, useMarks: boolean): { start: number; end: number } | null {
  if (track.duration === null) return null;
  if (!useMarks) return { start: 0, end: track.duration };
  return { start: track.marks.in ?? 0, end: track.marks.out ?? track.duration };
}

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'tracks/added':
      return { ...state, tracks: [...state.tracks, ...action.tracks] };
    case 'tracks/restored': {
      const tracks = [...action.tracks, ...state.tracks];
      const known = tracks.some((track) => track.id === action.currentId);
      return {
        ...state,
        tracks,
        currentId: state.currentId ?? (known ? action.currentId : null),
      };
    }
    case 'tracks/access':
      return {
        ...state,
        tracks: state.tracks.map((track) =>
          track.id === action.id ? { ...track, status: action.status, reason: null } : track,
        ),
      };
    case 'tracks/arranged': {
      const byId = new Map(state.tracks.map((track) => [track.id, track]));
      const order = action.ids.filter((id) => byId.has(id));
      const listed = new Set(order);
      let next = 0;
      return {
        ...state,
        tracks: state.tracks.map((track) =>
          listed.has(track.id) ? byId.get(order[next++]!)! : track,
        ),
      };
    }
    case 'tracks/probed':
      return {
        ...state,
        tracks: state.tracks.map((track) => {
          if (track.id !== action.id) return track;
          const { stored, ...info } = action.info;
          return {
            ...track,
            ...info,
            title: info.title ?? track.title,
            ...(stored ? { cues: stored.cues, marks: stored.marks } : {}),
          };
        }),
      };
    case 'tracks/removed':
      return {
        ...state,
        tracks: state.tracks.filter((track) => track.id !== action.id),
        currentId: state.currentId === action.id ? null : state.currentId,
        playing: state.currentId === action.id ? false : state.playing,
      };
    case 'tracks/moved': {
      const { from, to } = action;
      if (from === to || from < 0 || from >= state.tracks.length) return state;
      const tracks = [...state.tracks];
      const [moved] = tracks.splice(from, 1);
      tracks.splice(Math.max(0, Math.min(to, tracks.length)), 0, moved!);
      return { ...state, tracks };
    }
    case 'tracks/cleared':
      return { ...state, tracks: [], currentId: null, playing: false };
    case 'tracks/marked':
      return {
        ...state,
        tracks: state.tracks.map((track) =>
          track.id === action.id
            ? { ...track, marks: setMark(track, action.mark, action.seconds) }
            : track,
        ),
      };
    case 'tracks/cue':
      return {
        ...state,
        tracks: state.tracks.map((track) =>
          track.id === action.id
            ? { ...track, cues: setCue(track, action.index, action.seconds) }
            : track,
        ),
      };
    case 'player/current':
      return { ...state, currentId: action.id };
    case 'player/playing':
      return state.playing === action.playing ? state : { ...state, playing: action.playing };
    case 'player/seeked':
      return state; // only recorded in the action log
    case 'player/error':
      return state.error === action.message ? state : { ...state, error: action.message };
    case 'settings/changed':
      return { ...state, settings: { ...state.settings, ...action.changes } };
    case 'visuals/changed':
      return { ...state, visuals: sanitizeSettings({ ...state.visuals, ...action.changes }) };
    case 'visuals/replaced':
      return { ...state, visuals: sanitizeSettings(action.visuals) };
    case 'sound/changed': {
      const changes = { ...action.changes };
      // A narrower tempo range keeps the speed if it fits, else the nearest one it can reach.
      if (changes.tempoRange !== undefined && changes.rate === undefined) {
        const [low, high] = rateLimits(changes.tempoRange);
        changes.rate = Math.min(high, Math.max(low, state.sound.rate));
      }
      return { ...state, sound: sanitizeSound({ ...state.sound, ...changes }) };
    }
    case 'sound/replaced':
      return { ...state, sound: sanitizeSound(action.sound) };
    case 'kaleido/scene': {
      if (action.scene === state.kaleido.scene) return state;
      const look = sceneDefaults(action.scene).common;
      return {
        ...state,
        kaleido: sanitizeKaleido({
          ...state.kaleido,
          scene: action.scene,
          common: { ...state.kaleido.common, ...look },
        }),
      };
    }
    case 'kaleido/param': {
      const { scope, key, value } = action;
      const kaleido =
        scope === 'common'
          ? { ...state.kaleido, common: { ...state.kaleido.common, [key]: value } }
          : {
              ...state.kaleido,
              scenes: {
                ...state.kaleido.scenes,
                [scope]: { ...state.kaleido.scenes[scope], [key]: value },
              },
            };
      return { ...state, kaleido: sanitizeKaleido(kaleido) };
    }
    case 'kaleido/replaced':
      return { ...state, kaleido: sanitizeKaleido(action.kaleido) };
    case 'live/starting':
      return { ...state, live: { ...state.live, status: 'starting', error: null } };
    case 'live/started':
      return {
        ...state,
        playing: false,
        live: { status: 'on', kind: action.kind, label: action.label, monitor: false, error: null },
      };
    case 'live/failed':
      return {
        ...state,
        live: action.running
          ? { ...state.live, status: 'on', error: action.message }
          : { ...LIVE_OFF, error: action.message },
      };
    case 'live/stopped':
      return { ...state, live: { ...LIVE_OFF, error: action.reason } };
    case 'live/monitor':
      return { ...state, live: { ...state.live, monitor: action.monitor } };
  }
}
