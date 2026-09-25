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
}

/** What the stage shows: a visual mode (VE-04; the Kaleidoscope follows in M3) or the analysis. */
export type VisualMode = 'logoSpectrum' | 'analysis';
export const VISUAL_MODES: readonly VisualMode[] = ['logoSpectrum', 'analysis'];

export interface Settings {
  volume: number;
  visualMode: VisualMode;
  panel: 'queue' | 'visuals';
  panelOpen: boolean;
}

export interface AppState {
  tracks: Track[];
  currentId: string | null;
  playing: boolean;
  settings: Settings;
  /** Parameters of the Logo Spectrum mode. */
  visuals: LogoSpectrumSettings;
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
  | { type: 'player/current'; id: string | null }
  | { type: 'player/playing'; playing: boolean }
  | { type: 'player/seeked'; seconds: number }
  | { type: 'player/error'; message: string | null }
  | { type: 'settings/changed'; changes: Partial<Settings> }
  | { type: 'visuals/changed'; changes: Partial<LogoSpectrumSettings> }
  /** A preset was applied: all visual parameters at once. */
  | { type: 'visuals/replaced'; visuals: LogoSpectrumSettings };

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.8,
  visualMode: 'logoSpectrum',
  panel: 'queue',
  panelOpen: true,
};

export function initialState(
  settings: Settings = DEFAULT_SETTINGS,
  visuals: LogoSpectrumSettings = DEFAULT_LOGO_SPECTRUM,
): AppState {
  return { tracks: [], currentId: null, playing: false, settings, visuals, error: null };
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
  };
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
  }
}
