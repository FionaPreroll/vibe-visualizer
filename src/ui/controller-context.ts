import { getContext, setContext } from 'svelte';
import type { ControllerService } from '../core/control/controller-service';

const KEY = Symbol('controllers');

export function provideControllers(controllers: ControllerService): void {
  setContext(KEY, controllers);
}

export function useControllers(): ControllerService {
  const controllers = getContext<ControllerService | undefined>(KEY);
  if (!controllers) throw new Error('useControllers() outside of the app shell');
  return controllers;
}
