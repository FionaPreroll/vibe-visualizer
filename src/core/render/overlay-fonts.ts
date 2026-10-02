import bebasLatin from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2?url';
import bebasLatinExt from '@fontsource/bebas-neue/files/bebas-neue-latin-ext-400-normal.woff2?url';
import montserratLatin400 from '@fontsource/montserrat/files/montserrat-latin-400-normal.woff2?url';
import montserratLatin700 from '@fontsource/montserrat/files/montserrat-latin-700-normal.woff2?url';
import montserratLatinExt400 from '@fontsource/montserrat/files/montserrat-latin-ext-400-normal.woff2?url';
import montserratLatinExt700 from '@fontsource/montserrat/files/montserrat-latin-ext-700-normal.woff2?url';
import orbitronLatin400 from '@fontsource/orbitron/files/orbitron-latin-400-normal.woff2?url';
import orbitronLatin700 from '@fontsource/orbitron/files/orbitron-latin-700-normal.woff2?url';
import pacificoLatin from '@fontsource/pacifico/files/pacifico-latin-400-normal.woff2?url';
import pacificoLatinExt from '@fontsource/pacifico/files/pacifico-latin-ext-400-normal.woff2?url';
import playfairLatin400 from '@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff2?url';
import playfairLatin700 from '@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff2?url';
import playfairLatinExt400 from '@fontsource/playfair-display/files/playfair-display-latin-ext-400-normal.woff2?url';
import playfairLatinExt700 from '@fontsource/playfair-display/files/playfair-display-latin-ext-700-normal.woff2?url';
import spaceMonoLatin400 from '@fontsource/space-mono/files/space-mono-latin-400-normal.woff2?url';
import spaceMonoLatin700 from '@fontsource/space-mono/files/space-mono-latin-700-normal.woff2?url';
import spaceMonoLatinExt400 from '@fontsource/space-mono/files/space-mono-latin-ext-400-normal.woff2?url';
import spaceMonoLatinExt700 from '@fontsource/space-mono/files/space-mono-latin-ext-700-normal.woff2?url';
import type { OverlayFont } from './overlay-settings';

/**
 * The fonts of the track overlay (LS-18), all under the SIL Open Font License 1.1 and bundled
 * with the app: Montserrat (Julieta Ulanovsky), Bebas Neue (Dharma Type), Playfair Display
 * (Claus Eggers Sørensen), Space Mono (Colophon), Pacifico (Vernon Adams) and Orbitron (Matt
 * McInerney). Each loads when it is first used, in the document or in a worker; where a worker
 * cannot load fonts, a font of the system draws the text.
 */

/** The character ranges of the two subsets (as Google Fonts splits them). */
const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,' +
  'U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,' +
  'U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,' +
  'U+A720-A7FF';

interface Face {
  weight: number;
  latin: string;
  latinExt: string | null;
}

interface FontSpec {
  family: string;
  /** Used until the font is loaded, and where it cannot be. */
  fallback: string;
  title: Face;
  artist: Face;
}

const face = (weight: number, latin: string, latinExt: string | null = null): Face => ({
  weight,
  latin,
  latinExt,
});

const FONTS: Record<OverlayFont, FontSpec> = {
  sans: {
    family: 'FibeStation Overlay Sans',
    fallback: 'Helvetica, Arial, sans-serif',
    title: face(700, montserratLatin700, montserratLatinExt700),
    artist: face(400, montserratLatin400, montserratLatinExt400),
  },
  condensed: {
    family: 'FibeStation Overlay Condensed',
    fallback: '"Arial Narrow", Impact, sans-serif',
    title: face(400, bebasLatin, bebasLatinExt),
    artist: face(400, bebasLatin, bebasLatinExt),
  },
  serif: {
    family: 'FibeStation Overlay Serif',
    fallback: 'Georgia, serif',
    title: face(700, playfairLatin700, playfairLatinExt700),
    artist: face(400, playfairLatin400, playfairLatinExt400),
  },
  mono: {
    family: 'FibeStation Overlay Mono',
    fallback: '"Courier New", monospace',
    title: face(700, spaceMonoLatin700, spaceMonoLatinExt700),
    artist: face(400, spaceMonoLatin400, spaceMonoLatinExt400),
  },
  script: {
    family: 'FibeStation Overlay Script',
    fallback: 'cursive',
    title: face(400, pacificoLatin, pacificoLatinExt),
    artist: face(400, pacificoLatin, pacificoLatinExt),
  },
  tech: {
    family: 'FibeStation Overlay Tech',
    fallback: 'sans-serif',
    title: face(700, orbitronLatin700),
    artist: face(400, orbitronLatin400),
  },
};

/** The CSS font of a line of the overlay, `px` high. */
export function overlayFont(font: OverlayFont, line: 'title' | 'artist', px: number): string {
  const spec = FONTS[font];
  return `${spec[line].weight} ${px.toFixed(2)}px "${spec.family}", ${spec.fallback}`;
}

const loading = new Map<OverlayFont, Promise<boolean>>();

/** Loads `font` once (in this document or worker); false if it cannot be loaded. */
export function loadOverlayFont(font: OverlayFont): Promise<boolean> {
  let promise = loading.get(font);
  if (!promise) {
    promise = load(FONTS[font]);
    loading.set(font, promise);
  }
  return promise;
}

async function load(spec: FontSpec): Promise<boolean> {
  const fonts = (globalThis as { fonts?: FontFaceSet }).fonts;
  if (!fonts || typeof FontFace === 'undefined') return false;
  const faces: FontFace[] = [];
  const weights =
    spec.title.weight === spec.artist.weight ? [spec.title] : [spec.title, spec.artist];
  for (const { weight, latin, latinExt } of weights) {
    const descriptors = { weight: String(weight), style: 'normal' };
    faces.push(new FontFace(spec.family, `url(${latin})`, { ...descriptors, unicodeRange: LATIN }));
    if (latinExt) {
      faces.push(
        new FontFace(spec.family, `url(${latinExt})`, { ...descriptors, unicodeRange: LATIN_EXT }),
      );
    }
  }
  try {
    for (const loaded of await Promise.all(faces.map((each) => each.load()))) fonts.add(loaded);
    return true;
  } catch {
    return false;
  }
}
