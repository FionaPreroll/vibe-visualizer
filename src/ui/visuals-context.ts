import { getContext, setContext } from 'svelte';
import type { VisualAssets } from '../core/render/visual-assets';

const KEY = Symbol('visual-assets');

export function provideAssets(assets: VisualAssets): void {
  setContext(KEY, assets);
}

export function useAssets(): VisualAssets {
  const assets = getContext<VisualAssets | undefined>(KEY);
  if (!assets) throw new Error('useAssets() outside of the app shell');
  return assets;
}
