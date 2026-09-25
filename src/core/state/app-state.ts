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

export type TrackStatus = 'probing' | 'ready' | 'unsupported';

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
  /** In/out markers in seconds (TR-09): the export range, e.g. a 30-second clip. */
  marks: Marks;
}

export interface Marks {
  in: number | null;
  out: number | null;
}

/** What the stage shows: one of the two visual modes (VE-04) or the analysis. */
export type VisualMode = 'logoSpectrum' | 'kaleidoscope' | 'analysis';
export const VISUAL_MODES: readonly VisualMode[] = ['logoSpectrum', 'kaleidoscope', 'analysis'];

export interface Settings {
  volume: number;
  visualMode: VisualMode;
  panel: 'queue' | 'visuals';
  panelOpen: boolean;
  /** Frame of the visuals (VE-09): the stage is letterboxed to it, and the export uses it. */
  aspect: AspectRatio;
  /** Shows the safe areas of the platforms over the stage. */
  safeAreas: boolean;
}

export interface AppState {
  tracks: Track[];
  currentId: string | null;
  playing: boolean;
  settings: Settings;
  /** Parameters of the Logo Spectrum mode. */
  visuals: LogoSpectrumSettings;
  /** Parameters of the Kaleidoscope mode. */
  kaleido: KaleidoSettings;
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
> & { title: string | null };

export type AppAction =
  | { type: 'tracks/added'; tracks: Track[] }
  | { type: 'tracks/probed'; id: string; info: ProbedInfo }
  | { type: 'tracks/removed'; id: string }
  | { type: 'tracks/moved'; from: number; to: number }
  | { type: 'tracks/cleared' }
  /** Sets (or clears, with null) the in or out marker of a track. */
  | { type: 'tracks/marked'; id: string; mark: 'in' | 'out'; seconds: number | null }
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
  | { type: 'kaleido/replaced'; kaleido: KaleidoSettings };

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.8,
  visualMode: 'logoSpectrum',
  panel: 'queue',
  panelOpen: true,
  aspect: '16:9',
  safeAreas: false,
};

export function initialState(
  settings: Settings = DEFAULT_SETTINGS,
  visuals: LogoSpectrumSettings = DEFAULT_LOGO_SPECTRUM,
  kaleido: KaleidoSettings = DEFAULT_KALEIDO,
): AppState {
  return { tracks: [], currentId: null, playing: false, settings, visuals, kaleido, error: null };
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
    marks: { in: null, out: null },
  };
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
    case 'tracks/probed':
      return {
        ...state,
        tracks: state.tracks.map((track) =>
          track.id === action.id
            ? { ...track, ...action.info, title: action.info.title ?? track.title }
            : track,
        ),
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
  }
}
