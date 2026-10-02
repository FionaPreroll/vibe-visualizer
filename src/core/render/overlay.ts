import { Program } from './gl';
import { loadOverlayFont, overlayFont } from './overlay-fonts';
import {
  DEFAULT_OVERLAY,
  overlayAlpha,
  overlayProgress,
  overlayTime,
  type OverlaySettings,
  type OverlayTrack,
} from './overlay-settings';
import { parseColor } from './visual-settings';

/**
 * Draws the track overlay (LS-18, LS-19) over the picture on the canvas, after the scene: the
 * title, the artist, and the bar and time of the progress. The text is drawn with a 2D canvas
 * into a texture, again only when it changes (the time once a second); the filled part of the
 * bar is drawn by the shader, so it moves smoothly. Nothing here depends on earlier frames, so
 * exports need no state of it.
 */

const VERTEX = `#version 300 es
/** The texture's place on the canvas: x, y from the top left, width, height (pixels). */
uniform vec4 rect;
uniform vec2 resolution;
out vec2 local;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  local = corner * rect.zw;
  vec2 pixel = rect.xy + local;
  gl_Position = vec4(pixel.x / resolution.x * 2.0 - 1.0, 1.0 - pixel.y / resolution.y * 2.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 local;
out vec4 color;
uniform sampler2D text;
uniform vec2 size;
uniform float alpha;
/** The progress bar in the texture's pixels (width 0: none), and the share played. */
uniform vec4 bar;
uniform float progress;
uniform vec3 tint;

float roundedBox(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

void main() {
  // Premultiplied; the canvas's top row is at v = 0.
  vec4 c = texture(text, local / size);
  if (bar.z > 0.0) {
    float radius = bar.w * 0.5;
    float end = bar.x + max(bar.w, bar.z * progress);
    vec2 centre = vec2((bar.x + end) * 0.5, bar.y + radius);
    float d = roundedBox(local - centre, vec2((end - bar.x) * 0.5, radius), radius);
    float cover = clamp(0.5 - d, 0.0, 1.0);
    c = vec4(tint, 1.0) * cover + c * (1.0 - cover);
  }
  color = c * alpha;
}`;

/** Shown while the settings change and no track plays, so the change can be seen. */
export const SAMPLE_TRACK: OverlayTrack = {
  title: 'Track title',
  artist: 'Artist',
  start: 0,
  end: 225,
};
export const SAMPLE_POSITION = 83;

interface Line {
  text: string;
  font: string;
  x: number;
  baseline: number;
  alpha: number;
}

interface Layout {
  /** The texture's place on the canvas (pixels, from the top left). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The bar in the texture (width 0: none). */
  bar: [number, number, number, number];
}

/** Ascent and descent of the font set on `context`, `px` high. */
function metrics(context: OffscreenCanvasRenderingContext2D, px: number): [number, number] {
  const measured = context.measureText('Hg');
  const ascent = measured.fontBoundingBoxAscent;
  const descent = measured.fontBoundingBoxDescent;
  return ascent > 0 ? [ascent, Math.max(0, descent)] : [px * 0.8, px * 0.22];
}

/** `text`, cut with an ellipsis to fit `width` with the font set on `context`. */
function fit(context: OffscreenCanvasRenderingContext2D, text: string, width: number): string {
  if (context.measureText(text).width <= width) return text;
  const characters = [...text];
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${characters.slice(0, middle).join('').trimEnd()}…`;
    if (context.measureText(candidate).width <= width) low = middle;
    else high = middle - 1;
  }
  return `${characters.slice(0, low).join('').trimEnd()}…`;
}

const DIGIT = /\d/;

/** Width of `text` with every digit as wide as the widest (the time does not jitter). */
function tabularWidth(context: OffscreenCanvasRenderingContext2D, text: string, digit: number) {
  let width = 0;
  for (const character of text) {
    width += DIGIT.test(character) ? digit : context.measureText(character).width;
  }
  return width;
}

function drawTabular(
  context: OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  digit: number,
): void {
  for (const character of text) {
    const width = context.measureText(character).width;
    if (DIGIT.test(character)) {
      context.fillText(character, x + (digit - width) / 2, y);
      x += digit;
    } else {
      context.fillText(character, x, y);
      x += width;
    }
  }
}

function roundedRect(
  context: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const radius = Math.min(height, width) / 2;
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.arc(x + width - radius, y + radius, radius, -Math.PI / 2, Math.PI / 2);
  context.lineTo(x + radius, y + height);
  context.arc(x + radius, y + radius, radius, Math.PI / 2, (Math.PI * 3) / 2);
  context.closePath();
}

export class TrackOverlay {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: Program;
  private readonly vertexArray: WebGLVertexArrayObject;
  private readonly texture: WebGLTexture;
  private canvas: OffscreenCanvas | null = null;
  private context: OffscreenCanvasRenderingContext2D | null = null;
  private settings: OverlaySettings = DEFAULT_OVERLAY;
  private width = 1;
  private height = 1;
  /** Counts changes of the settings, the size and the fonts: the text is drawn anew. */
  private version = 0;
  private painted: { track: OverlayTrack; time: string; version: number } | null = null;
  /**
   * Fonts loaded (or given up on). Text is drawn only once its font is here: in a worker,
   * Chromium keeps the font it found for a CSS font, so text drawn before would stay in the
   * fallback font.
   */
  private readonly loaded = new Set<OverlaySettings['font']>();
  private layout: Layout | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = new Program(gl, VERTEX, FRAGMENT);
    this.vertexArray = gl.createVertexArray()!;
    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  setSettings(settings: OverlaySettings): void {
    this.settings = settings;
    this.version++;
    // The text is drawn again once its font is there.
    const font = settings.font;
    if (settings.on && !this.loaded.has(font)) {
      void loadOverlayFont(font).then(() => {
        this.loaded.add(font);
        this.version++;
      });
    }
  }

  /** Resolves once the font of the settings is loaded (or cannot be): exports wait for it. */
  async ready(): Promise<void> {
    if (!this.settings.on) return;
    await loadOverlayFont(this.settings.font);
    this.loaded.add(this.settings.font);
    this.version++;
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.version++;
  }

  /**
   * Draws the overlay of `track` at `position` (seconds in its file), played at `rate`, over the
   * canvas. `boost` (0…1) shows it at least that much (the preview, while settings change).
   */
  draw(track: OverlayTrack | null, position: number, rate = 1, boost = 0): void {
    const settings = this.settings;
    if (!settings.on || !track || !this.loaded.has(settings.font)) return;
    const alpha = Math.max(boost, overlayAlpha(settings, track, position, rate));
    if (alpha < 1 / 512) return;
    const time = settings.time ? overlayTime(track, position, rate) : '';
    const painted = this.painted;
    if (
      !painted ||
      painted.track !== track ||
      painted.time !== time ||
      painted.version !== this.version
    ) {
      this.paint(track, time);
      this.painted = { track, time, version: this.version };
    }
    const layout = this.layout;
    if (!layout) return;
    const gl = this.gl;
    const [r, g, b] = parseColor(settings.color);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vertexArray);
    this.program
      .use()
      .texture('text', this.texture, 0)
      .vec4('rect', layout.x, layout.y, layout.width, layout.height)
      .vec2('resolution', this.width, this.height)
      .vec2('size', layout.width, layout.height)
      .float('alpha', alpha)
      .vec4('bar', ...layout.bar)
      .float('progress', overlayProgress(track, position))
      .vec3('tint', r, g, b);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteTexture(this.texture);
    this.gl.deleteVertexArray(this.vertexArray);
    this.canvas = null;
    this.context = null;
  }

  /** Lays out the text for the canvas's size, draws it and uploads it. */
  private paint(track: OverlayTrack, time: string): void {
    this.canvas ??= new OffscreenCanvas(1, 1);
    this.context ??= this.canvas.getContext('2d');
    const canvas = this.canvas;
    const context = this.context;
    if (!context) {
      this.layout = null;
      return;
    }
    const s = this.settings;
    const { width, height } = this;
    // Letters scale with the frame's shorter side; the text keeps to the title-safe area.
    const base = 0.05 * Math.min(width, height) * s.size;
    const marginX = 0.05 * width;
    const marginY = 0.05 * height;
    const maxWidth = Math.max(1, width - 2 * marginX);
    const lines: Line[] = [];
    let y = 0;
    let widest = 0;
    const addLine = (text: string, px: number, line: 'title' | 'artist', alpha: number) => {
      context.font = overlayFont(s.font, line, px);
      // A long title gets smaller letters first, down to 60 %, then an ellipsis.
      const natural = context.measureText(text).width;
      if (natural > maxWidth && line === 'title') {
        px = Math.max(px * 0.6, (px * maxWidth) / natural);
        context.font = overlayFont(s.font, line, px);
      }
      const shown = fit(context, text, maxWidth);
      const [ascent, descent] = metrics(context, px);
      if (lines.length > 0) y += 0.14 * base;
      lines.push({ text: shown, font: context.font, x: 0, baseline: y + ascent, alpha });
      widest = Math.max(widest, context.measureText(shown).width);
      y += ascent + descent;
    };
    if (track.title) addLine(track.title, base, 'title', 1);
    if (track.artist) addLine(track.artist, base * 0.62, 'artist', 0.86);

    // The progress row: the bar and then the time, or the time alone.
    const timePx = base * 0.42;
    context.font = overlayFont(s.font, 'artist', timePx);
    const digit = Math.max(...'0123456789'.split('').map((d) => context.measureText(d).width));
    const timeFont = context.font;
    const [timeAscent, timeDescent] = metrics(context, timePx);
    // As wide as the longest time of the track, so nothing moves while it counts.
    const timeWidth = time ? tabularWidth(context, time.replace(/\d/g, '0'), digit) : 0;
    const barHeight = s.progress ? Math.max(2, Math.round(base * 0.1)) : 0;
    const rowHeight = s.progress || time ? Math.max(barHeight, timeAscent + timeDescent) : 0;
    const gap = base * 0.3;
    let rowTop = 0;
    if (rowHeight > 0) {
      if (lines.length > 0) y += base * 0.36;
      rowTop = y;
      y += rowHeight;
    }
    const blockWidth = Math.min(
      maxWidth,
      Math.max(
        widest,
        s.progress ? Math.min(maxWidth, 0.3 * Math.max(width, height)) : 0,
        time ? timeWidth : 0,
      ),
    );
    const blockHeight = y;
    if (blockHeight <= 0 || blockWidth <= 0) {
      this.layout = null;
      return;
    }

    const [row, column] = place(s.position);
    const align = (lineWidth: number) =>
      column === 'left'
        ? 0
        : column === 'right'
          ? blockWidth - lineWidth
          : (blockWidth - lineWidth) / 2;
    const pad = Math.ceil(base * 0.4);
    canvas.width = Math.ceil(blockWidth + 2 * pad);
    canvas.height = Math.ceil(blockHeight + 2 * pad);
    const left =
      column === 'left'
        ? marginX
        : column === 'right'
          ? width - marginX - blockWidth
          : (width - blockWidth) / 2;
    const top =
      row === 'top'
        ? marginY
        : row === 'bottom'
          ? height - marginY - blockHeight
          : (height - blockHeight) / 2;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = s.color;
    context.shadowColor = 'rgba(0, 0, 0, 0.55)';
    context.shadowBlur = base * 0.16;
    context.shadowOffsetY = base * 0.03;
    context.textBaseline = 'alphabetic';
    context.textAlign = 'left';
    for (const line of lines) {
      context.font = line.font;
      context.globalAlpha = line.alpha;
      context.fillText(
        line.text,
        pad + align(context.measureText(line.text).width),
        pad + line.baseline,
      );
    }
    let bar: Layout['bar'] = [0, 0, 0, 0];
    if (rowHeight > 0) {
      context.font = timeFont;
      const timeBaseline = rowTop + (rowHeight - timeAscent - timeDescent) / 2 + timeAscent;
      if (s.progress) {
        const barWidth = Math.max(barHeight, blockWidth - (time ? timeWidth + gap : 0));
        const barTop = pad + rowTop + (rowHeight - barHeight) / 2;
        context.globalAlpha = 0.3;
        roundedRect(context, pad, barTop, barWidth, barHeight);
        context.fill();
        bar = [pad, barTop, barWidth, barHeight];
        if (time) {
          context.globalAlpha = 0.86;
          drawTabular(context, time, pad + blockWidth - timeWidth, pad + timeBaseline, digit);
        }
      } else {
        context.globalAlpha = 0.86;
        drawTabular(context, time, pad + align(timeWidth), pad + timeBaseline, digit);
      }
    }
    context.globalAlpha = 1;

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.layout = {
      x: Math.round(left - pad),
      y: Math.round(top - pad),
      width: canvas.width,
      height: canvas.height,
      bar,
    };
  }
}

/** The row and the column of a position. */
function place(
  position: OverlaySettings['position'],
): ['top' | 'middle' | 'bottom', 'left' | 'center' | 'right'] {
  const [first, second] = position.split('-') as [string, string | undefined];
  if (position === 'center') return ['middle', 'center'];
  if (position === 'left' || position === 'right') return ['middle', position];
  return [first as 'top' | 'bottom', (second ?? 'center') as 'left' | 'right' | 'center'];
}
