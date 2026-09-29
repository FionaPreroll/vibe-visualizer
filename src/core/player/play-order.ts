import { isPlayable, type RepeatMode, type Track } from '../state/app-state';

/**
 * The order of play (PL-04): the queue in order or shuffled, and what happens at the end: stop,
 * start again (repeat all) or play the track again (repeat one). Pure functions of the queue,
 * so the next track can be planned ahead (for gapless playback) and tested.
 */

export interface PlayOrder {
  shuffle: boolean;
  repeat: RepeatMode;
}

function playable(tracks: readonly Track[]): Track[] {
  return tracks.filter(isPlayable);
}

/**
 * The track after `currentId`. `ended`: the current track has played to its end (repeat one
 * then plays it again); otherwise the next one was asked for. In shuffle mode it is a random
 * track that has not played in this round (`played`), and a new round starts once all have.
 */
export function nextTrack(
  tracks: readonly Track[],
  currentId: string | null,
  played: readonly string[],
  order: PlayOrder,
  ended: boolean,
  random: () => number = Math.random,
): string | null {
  const candidates = playable(tracks);
  if (candidates.length === 0) return null;
  if (ended && order.repeat === 'one' && candidates.some((track) => track.id === currentId)) {
    return currentId;
  }
  if (order.shuffle) {
    const done = new Set(played);
    let open = candidates.filter((track) => !done.has(track.id) && track.id !== currentId);
    if (open.length === 0) {
      // Everything has played: a new round with repeat, or when asked for; else the end.
      if (order.repeat === 'off' && ended) return null;
      open = candidates.filter((track) => track.id !== currentId);
      if (open.length === 0) return order.repeat === 'off' ? null : currentId;
    }
    return open[Math.min(open.length - 1, Math.floor(random() * open.length))]!.id;
  }
  const index = candidates.findIndex((track) => track.id === currentId);
  if (index + 1 < candidates.length) return candidates[index + 1]!.id;
  return order.repeat === 'all' ? candidates[0]!.id : null;
}

/**
 * The track before `currentId`: in shuffle mode the one played before it (`played`, oldest
 * first), otherwise the previous one in the queue (with repeat all, the last after the first).
 */
export function previousTrack(
  tracks: readonly Track[],
  currentId: string | null,
  played: readonly string[],
  order: PlayOrder,
): string | null {
  const candidates = playable(tracks);
  if (order.shuffle) {
    const ids = new Set(candidates.map((track) => track.id));
    const history = played.filter((id) => ids.has(id) && id !== currentId);
    return history[history.length - 1] ?? null;
  }
  const index = candidates.findIndex((track) => track.id === currentId);
  if (index > 0) return candidates[index - 1]!.id;
  return order.repeat === 'all' && candidates.length > 1 && index === 0
    ? candidates[candidates.length - 1]!.id
    : null;
}
