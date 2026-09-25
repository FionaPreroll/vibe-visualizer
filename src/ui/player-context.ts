import { getContext, setContext } from 'svelte';
import type { Player } from '../core/player/player';

const KEY = Symbol('player');

export function providePlayer(player: Player): void {
  setContext(KEY, player);
}

export function usePlayer(): Player {
  const player = getContext<Player | undefined>(KEY);
  if (!player) throw new Error('usePlayer() outside of the app shell');
  return player;
}
