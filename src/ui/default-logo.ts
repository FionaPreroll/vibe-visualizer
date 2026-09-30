import fontUrl from '@fontsource/pacifico/files/pacifico-latin-400-normal.woff2?url';

/**
 * The default logo (LS-12): the app's name ("Fibe" over "Station") in Pacifico (Vernon Adams,
 * SIL Open Font License 1.1), a gradient from cyan to violet with a glow, on a dark disc. It is
 * drawn on the main thread as a PNG, so the stage and the export show the same picture, and
 * drawn again when the app is renamed.
 */

const SIZE = 1024;
/** The font family of the logo, for CSS too once {@link loadLogoFont} has loaded it. */
export const LOGO_FONT = 'FibeStation Logo';
/** The widest line spans this share of the logo; all lines together at most this much height. */
const WIDTH_SHARE = 0.72;
const HEIGHT_SHARE = 0.66;
/** Largest letters, as a share of the logo. */
const MAX_SIZE_SHARE = 0.3;
/** Longest name drawn in lines of single words. */
const MAX_WORD_LINES = 3;

let fontLoading: Promise<boolean> | null = null;

/** Loads the logo font once; false if it cannot be loaded (a generic script font is used). */
export function loadLogoFont(): Promise<boolean> {
  fontLoading ??= new FontFace(LOGO_FONT, `url(${fontUrl})`).load().then(
    (face) => {
      document.fonts.add(face);
      return true;
    },
    () => false,
  );
  return fontLoading;
}

/**
 * The lines of the logo: a name in one word by its parts in camel case ("FibeStation" → "Fibe",
 * "Station"), up to three words one per line, longer names in two lines as even as possible.
 */
export function logoLines(name: string): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    const parts = words[0]!.split(/(?<=[a-z])(?=[A-Z])/);
    return parts.length <= MAX_WORD_LINES ? parts : words;
  }
  if (words.length <= MAX_WORD_LINES) return words;
  let best = 1;
  let bestLength = Infinity;
  for (let split = 1; split < words.length; split++) {
    const length = Math.max(
      words.slice(0, split).join(' ').length,
      words.slice(split).join(' ').length,
    );
    if (length < bestLength) {
      bestLength = length;
      best = split;
    }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

/** The default logo for the app's `name`, as a square PNG (null without a 2D canvas). */
export async function renderDefaultLogo(name: string): Promise<Blob | null> {
  const lines = logoLines(name);
  const family = (await loadLogoFont()) ? `"${LOGO_FONT}"` : 'cursive';
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const middle = SIZE / 2;
  const disc = context.createRadialGradient(middle, middle * 0.8, 0, middle, middle, middle);
  disc.addColorStop(0, '#231842');
  disc.addColorStop(1, '#07070d');
  context.fillStyle = disc;
  context.fillRect(0, 0, SIZE, SIZE);
  if (lines.length > 0) {
    context.font = `100px ${family}`;
    const widest = Math.max(...lines.map((line) => context.measureText(line).width));
    const size = Math.min(
      (100 * SIZE * WIDTH_SHARE) / Math.max(1, widest),
      (SIZE * HEIGHT_SHARE) / lines.length,
      SIZE * MAX_SIZE_SHARE,
    );
    context.font = `${size}px ${family}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const half = (SIZE * WIDTH_SHARE) / 2;
    const gradient = context.createLinearGradient(middle - half, 0, middle + half, 0);
    gradient.addColorStop(0, '#3fd9ff');
    gradient.addColorStop(1, '#b370ff');
    context.fillStyle = gradient;
    context.shadowColor = 'rgba(120, 200, 255, 0.8)';
    context.shadowBlur = SIZE * 0.04;
    lines.forEach((line, index) => {
      context.fillText(line, middle, middle + (index - (lines.length - 1) / 2) * size);
    });
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
