import { getContext, setContext } from 'svelte';
import type { Exporter } from '../core/export/exporter';

const KEY = Symbol('exporter');

export function provideExporter(exporter: Exporter): void {
  setContext(KEY, exporter);
}

export function useExporter(): Exporter {
  const exporter = getContext<Exporter | undefined>(KEY);
  if (!exporter) throw new Error('useExporter() outside of the app shell');
  return exporter;
}
