import { aspectRatio, type AspectRatio } from '../core/export/video-format';

/**
 * The mini player (DS-06): the visuals in a small window of their own, which stays on top while
 * the user works in other tabs and apps. A Document Picture-in-Picture window (Chrome and Edge);
 * other browsers have none, and the app offers no mini player there.
 */

/** The part of the Document Picture-in-Picture API used here (not in TypeScript's DOM types). */
interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}

function pictureInPicture(): DocumentPictureInPicture | null {
  return (
    (globalThis as { documentPictureInPicture?: DocumentPictureInPicture })
      .documentPictureInPicture ?? null
  );
}

/** Whether this browser can show the mini player. */
export function supportsMiniPlayer(): boolean {
  return pictureInPicture() !== null;
}

/** The area of the window asked for (CSS pixels): that of 480 × 270, whatever the aspect ratio. */
const AREA = 480 * 270;

/**
 * The size of the mini player's window: the aspect ratio of the visuals, as large as 480 × 270
 * (16:9), in even pixels. The browser may make it larger or smaller; the stage letterboxes in it.
 */
export function miniPlayerSize(aspect: AspectRatio): { width: number; height: number } {
  const ratio = aspectRatio(aspect);
  const even = (value: number) => Math.round(value / 2) * 2;
  return { width: even(Math.sqrt(AREA * ratio)), height: even(Math.sqrt(AREA / ratio)) };
}

/**
 * Opens the mini player's window with the app's style sheets, so that what moves into it looks as
 * it does in the tab. The browser opens it only right after a click or a key: nothing may be
 * awaited before.
 */
export async function openMiniPlayerWindow(aspect: AspectRatio, title: string): Promise<Window> {
  const api = pictureInPicture();
  if (!api) throw new Error('This browser has no picture-in-picture windows for pages.');
  const view = await api.requestWindow(miniPlayerSize(aspect));
  const doc = view.document;
  for (const node of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
    doc.head.append(node.cloneNode(true));
  }
  doc.documentElement.lang = document.documentElement.lang;
  doc.title = title;
  return view;
}
