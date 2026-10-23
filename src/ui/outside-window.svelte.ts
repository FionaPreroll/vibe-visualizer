import { flushSync, mount, unmount } from 'svelte';
import type { AspectRatio } from '../core/export/video-format';
import { errorMessage } from '../core/util/format';
import { openMiniPlayerWindow, supportsMiniPlayer } from './mini-player';
import MiniPlayerControls from './MiniPlayerControls.svelte';
import { openSecondScreenWindow, placeOnOtherScreen } from './second-screen';
import SecondScreenControls from './SecondScreenControls.svelte';

/** The mini player's window (DS-06), or the second screen's (DS-03). */
export type OutsideKind = 'mini' | 'screen';

/**
 * The window the visuals are in while it is open, the mini player's (DS-06) or the second
 * screen's (DS-03), and where the stage goes in it (#56). Its controls are a Svelte root of
 * their own, with the tab's contexts (the player, the assets and the rest); its keys work as
 * the tab's.
 */
export class OutsideWindow {
  /** The other window, while the visuals are in it. */
  view = $state.raw<Window | null>(null);
  kind = $state<OutsideKind | null>(null);
  /** Where the stage goes in it. */
  slot = $state.raw<HTMLElement | null>(null);
  private controls: ReturnType<typeof mount> | null = null;
  private stopKeys: (() => void) | null = null;
  private miniOpening = false;

  constructor(
    /** The contexts of the tab's components, for the controls in the other window. */
    private readonly contexts: Map<unknown, unknown>,
    /** The keyboard shortcuts in a window; returns what stops them. */
    private readonly listenToKeys: (view: Window) => () => void,
    private readonly reportError: (message: string) => void,
  ) {}

  /**
   * Opens the mini player (DS-06): the stage moves into a small window of its own, on top of
   * the other tabs and apps, with controls for the music.
   */
  async openMini(aspect: AspectRatio, title: string): Promise<void> {
    if (this.kind === 'mini' || this.miniOpening || !supportsMiniPlayer()) return;
    this.miniOpening = true;
    let view: Window | null = null;
    try {
      const opening = openMiniPlayerWindow(aspect, title);
      // The second screen gives the visuals up; the browser asked for the window first.
      this.close();
      view = await opening;
      this.take(view, 'mini');
    } catch (error) {
      view?.close();
      this.reportError(`The mini player could not open: ${errorMessage(error)}`);
    } finally {
      this.miniOpening = false;
    }
  }

  /**
   * Opens the second screen (DS-03): the stage moves into a window of its own, for a projector
   * or another monitor, while the controls stay in the tab. Where the browser can, the window
   * moves onto the other screen by itself.
   */
  openScreen(title: string): void {
    if (this.kind === 'screen') return;
    let view: Window | null = null;
    try {
      view = openSecondScreenWindow(title);
      this.close();
      this.take(view, 'screen');
      void placeOnOtherScreen(view);
    } catch (error) {
      view?.close();
      this.reportError(`The second screen could not open: ${errorMessage(error)}`);
    }
  }

  toggleMini(aspect: AspectRatio, title: string): void {
    if (this.kind === 'mini') this.close();
    else void this.openMini(aspect, title);
  }

  toggleScreen(title: string): void {
    if (this.kind === 'screen') this.close();
    else this.openScreen(title);
  }

  /** The visuals come back into the tab, and the mini player's or second screen's window goes. */
  close(): void {
    const view = this.view;
    this.bringBack();
    view?.close();
  }

  /** The app goes: the other window closes, without moving the stage back first. */
  dispose(): void {
    if (this.view) {
      this.view.removeEventListener('pagehide', this.bringBack);
      this.view.close();
    }
    this.stopKeys?.();
    this.stopKeys = null;
    if (this.controls) void unmount(this.controls);
    this.controls = null;
  }

  /** The stage and the controls move into `view`, whose keys work as the tab's. */
  private take(view: Window, kind: OutsideKind): void {
    const slot = view.document.createElement('div');
    slot.style.cssText = 'position: fixed; inset: 0';
    view.document.body.style.cssText = 'margin: 0; background: #000';
    view.document.body.append(slot);
    const onback = () => this.close();
    try {
      this.controls =
        kind === 'mini'
          ? mount(MiniPlayerControls, {
              target: view.document.body,
              props: { onback },
              context: this.contexts,
            })
          : mount(SecondScreenControls, {
              target: view.document.body,
              props: { view, onback },
              context: this.contexts,
            });
    } catch (error) {
      this.controls = null;
      throw error;
    }
    this.stopKeys = this.listenToKeys(view);
    // Its own close button, and the browser's "back to tab" or close.
    view.addEventListener('pagehide', this.bringBack, { once: true });
    this.view = view;
    this.kind = kind;
    this.slot = slot;
  }

  /** The stage comes back into the tab, before the other window goes. */
  private readonly bringBack = (): void => {
    const view = this.view;
    if (!view) return;
    this.slot = null;
    this.view = null;
    this.kind = null;
    flushSync();
    if (this.controls) void unmount(this.controls);
    this.controls = null;
    this.stopKeys?.();
    this.stopKeys = null;
    view.removeEventListener('pagehide', this.bringBack);
  };
}
