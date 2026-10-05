import { F } from '../analysis/features';
import { Prng } from '../util/prng';
import { coverBlend, type CoverColors } from './cover-palette';
import {
  bindTarget,
  createFullscreenTriangle,
  createImageTexture,
  createTarget,
  deleteTarget,
  FRAGMENT_HEADER,
  FULLSCREEN_VERTEX,
  Program,
  setSampling,
  supportsFloatTargets,
  type Target,
} from './gl';
import type { KaleidoSettings } from './kaleido-settings';
import { NO_CAMERA, PostProcessing, type Camera } from './post';
import type { Scene, SceneInput, SceneSnapshot } from './scene';
import { CURVE_POINTS, SpectrumShaper } from './spectrum-shaper';
import {
  DEFAULT_LOGO_SPECTRUM,
  layerColors,
  MAX_LAYERS,
  parseColor,
  RING_DIRECTIONS,
  RING_STYLES,
  type LogoSpectrumSettings,
} from './visual-settings';

/**
 * Mode B, "Logo Spectrum" (LS-*): background image, particles (stars or rain), a mirrored
 * spectrum ring of colour layers with a glow, and a round logo that pulses with the bass.
 * Rendered in WebGL2 into a half-float buffer, then bloom and dithering (VE-02). Everything moves
 * in real time (dt), so it looks the same at any frame rate and in the export (VE-03).
 */

export type ImageKind = 'background' | 'logo';

const BACKGROUND = `${FRAGMENT_HEADER}
uniform sampler2D image;
uniform int hasImage;
/** The Kaleidoscope behind (VE-08): the picture's size, rows bottom first. */
uniform sampler2D layer;
uniform int hasLayer;
/** How much of the image shows under the layer (0: none), and the scale that fits it. */
uniform float imageUnder;
uniform vec2 imageScale;
uniform vec2 scale;
uniform vec2 pan;
uniform float dim;
uniform float time;
uniform vec2 resolution;
uniform vec3 tint;
uniform float tintAmount;
/** The image under the layer, tinted on its own (VE-08). */
uniform vec3 imageTint;
uniform float imageTintAmount;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

/** A colour tinted towards another, keeping its brightness (LS-02). */
vec3 tinted(vec3 c, vec3 towards) {
  return dot(c, LUMA) * towards / max(dot(towards, LUMA), 0.2);
}

void main() {
  vec3 col;
  if (hasLayer == 1) {
    vec2 c = (uv - 0.5) * scale + 0.5 + pan * 0.5 * max(1.0 - scale, 0.0);
    col = texture(layer, c).rgb;
    if (hasImage == 1 && imageUnder > 0.0) {
      // The image under the Kaleidoscope, screened: its light adds where the layer is dark.
      vec2 ci = (uv - 0.5) * imageScale + 0.5 + pan * 0.5 * max(1.0 - imageScale, 0.0);
      bool outside = any(lessThan(ci, vec2(0.0))) || any(greaterThan(ci, vec2(1.0)));
      vec4 t = texture(image, vec2(ci.x, 1.0 - ci.y));
      vec3 under = outside ? vec3(0.0) : t.rgb * t.a;
      under = mix(under, tinted(under, imageTint), imageTintAmount) * imageUnder;
      col = 1.0 - (1.0 - col) * (1.0 - under);
    }
  } else if (hasImage == 1) {
    // pan moves the visible window within the part of the image that is cropped away.
    vec2 c = (uv - 0.5) * scale + 0.5 + pan * 0.5 * max(1.0 - scale, 0.0);
    bool outside = any(lessThan(c, vec2(0.0))) || any(greaterThan(c, vec2(1.0)));
    // Images are stored top row first (v = 0), straight alpha.
    vec4 t = texture(image, vec2(c.x, 1.0 - c.y));
    col = outside ? vec3(0.0) : t.rgb * t.a;
  } else {
    // Neutral default: a deep violet glow with slowly drifting light.
    vec2 p = (uv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
    vec2 q = p / scale.y;
    float r = length(q);
    col = mix(vec3(0.11, 0.06, 0.2), vec3(0.012, 0.01, 0.028), smoothstep(0.0, 0.95, r));
    col += vec3(0.05, 0.02, 0.09) * (0.5 + 0.5 * sin(time * 0.15 + q.x * 2.5 + q.y * 1.5));
    col += vec3(0.0, 0.03, 0.05) * (0.5 + 0.5 * sin(time * 0.11 - q.y * 3.0));
  }
  // Tinted towards a colour, keeping the brightness of each part (LS-02).
  col = mix(col, tinted(col, tint), tintAmount);
  color = vec4(col * (1.0 - dim), 1.0);
}`;

const COPY = `${FRAGMENT_HEADER}
uniform sampler2D source;
void main() {
  // Keeps the image orientation (top row at v = 0), so the result samples like the image.
  color = texture(source, uv);
}`;

const BLUR = `${FRAGMENT_HEADER}
uniform sampler2D source;
uniform vec2 direction;
uniform float sigma;
void main() {
  vec4 sum = vec4(0.0);
  float total = 0.0;
  int radius = int(ceil(sigma * 2.5));
  for (int i = -40; i <= 40; i++) {
    if (i < -radius || i > radius) continue;
    float weight = exp(-0.5 * float(i * i) / (sigma * sigma));
    sum += texture(source, uv + direction * float(i)) * weight;
    total += weight;
  }
  color = sum / total;
}`;

const PARTICLE_VERTEX = `#version 300 es
layout(location = 1) in vec4 particle;
uniform vec2 resolution;
/** The way the particles move (a unit vector), and how much longer than wide they are. */
uniform vec2 along;
uniform float stretch;
out vec2 local;
out float alpha;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  local = corner;
  alpha = particle.w;
  vec2 across = vec2(along.y, -along.x);
  vec2 position = particle.xy + (across * corner.x + along * corner.y * stretch) * particle.z;
  gl_Position = vec4(position / (resolution * 0.5), 0.0, 1.0);
}`;

const PARTICLE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 local;
in float alpha;
out vec4 color;
uniform vec3 tint;
/** 0 stars, 1 rain. */
uniform int style;
void main() {
  float light;
  if (style == 1) {
    // A streak of rain: thin, brightest at its head (ahead, local.y near 1), its tail fading.
    float head = smoothstep(-1.0, 0.8, local.y) * (1.0 - smoothstep(0.8, 1.0, local.y));
    light = exp(-local.x * local.x * 9.0) * head * head;
  } else {
    float r2 = dot(local, local);
    light = exp(-r2 * 5.0) * 0.5 + exp(-r2 * 40.0);
  }
  color = vec4(tint * light * alpha, 0.0);
}`;

const RING = `${FRAGMENT_HEADER}
uniform sampler2D curves;
uniform vec2 center;
uniform float radius;
uniform float amplitude;
uniform float spread;
uniform int layers;
uniform vec3 colors[${MAX_LAYERS}];
uniform vec3 topColor;
uniform float rotation;
uniform float glow;
uniform float glowRadius;
uniform float hue;
/** 0 filled shape, 1 bars, 2 lines, 3 dots (LS-11). */
uniform int style;
/** 0 outward, 1 inward, 2 both ways. */
uniform int direction;
uniform float bars;
uniform float thickness;

const float TAU = 6.28318530718;

vec3 hueRotate(vec3 c, float angle) {
  const vec3 k = vec3(0.57735027);
  float cosine = cos(angle);
  return c * cosine + cross(k, c) * sin(angle) + k * dot(k, c) * (1.0 - cosine);
}

/** Coverage of a shape from its signed distance (positive inside), smoothed over a pixel. */
float cover(float d) {
  return clamp(0.5 + d / max(fwidth(d), 1e-3), 0.0, 1.0);
}

/**
 * Signed distance (pixels, positive inside) to the dots of a bar that starts at the radius
 * \`from\` and is \`to - from\` long: round dots of radius w, one every 2.6 w, going out (way 1)
 * or in (way -1).
 */
float dots(float rho, float across, float from, float to, float w, float way) {
  float pitch = 2.6 * w;
  float count = max(floor((to - from - w) / pitch), 0.0);
  float j = clamp(floor((way * (rho - from) - w) / pitch + 0.5), 0.0, count);
  float centre = from + way * (w + j * pitch);
  return w - length(vec2(across, rho - centre));
}

void main() {
  vec2 p = gl_FragCoord.xy - center;
  float rho = length(p);
  // Angle clockwise from the top, in turns.
  float turn = fract((atan(p.x, p.y) - rotation) / TAU);
  // Bars and dots take the value at the middle of their bar; across is the distance from it.
  float sampled = turn;
  float across = 0.0;
  if (style == 1 || style == 3) {
    sampled = (floor(turn * bars) + 0.5) / bars;
    across = (turn - sampled) * TAU * rho;
  }
  float halfWidth = 0.5 * thickness * TAU * radius / bars;
  float lineHalf = max(0.75, 0.012 * thickness * radius);
  // Bars and dots stay visible in silence.
  float least = style == 1 || style == 3 ? max(2.0 * halfWidth, 0.02 * radius) : 0.0;
  float halo = radius * glowRadius;
  vec4 acc = vec4(0.0);
  for (int i = ${MAX_LAYERS}; i >= 0; i--) {
    if (i > layers) continue;
    float value = texture(curves, vec2(sampled, (float(i) + 0.5) / ${MAX_LAYERS + 1}.0)).r;
    // Layers further back are a little bigger, more so at the peaks.
    float depth = float(i);
    float height = max(least, spread * radius * 0.25 * depth + amplitude * value * (1.0 + 5.0 * spread * depth));
    float outer = direction == 1 ? radius : radius + height;
    float inner = direction == 0 ? radius : radius - height;
    float d;
    float inside;
    if (style == 0) {
      // The filled shape reaches in to the logo when it grows outward.
      d = direction == 0 ? outer - rho : min(outer - rho, rho - inner);
      inside = cover(d);
    } else if (style == 2) {
      float toOuter = rho - outer;
      float toInner = rho - inner;
      float line = lineHalf - abs(toOuter) / max(length(vec2(dFdx(toOuter), dFdy(toOuter))), 1e-3);
      if (direction == 1) line = lineHalf - abs(toInner) / max(length(vec2(dFdx(toInner), dFdy(toInner))), 1e-3);
      if (direction == 2) line = max(line, lineHalf - abs(toInner) / max(length(vec2(dFdx(toInner), dFdy(toInner))), 1e-3));
      d = line;
      inside = clamp(0.5 + d, 0.0, 1.0);
    } else if (style == 1) {
      // A bar with round ends, in pixels.
      d = halfWidth - length(vec2(across, rho - clamp(rho, inner, outer)));
      inside = clamp(0.5 + d, 0.0, 1.0);
    } else {
      float w = halfWidth;
      d = direction == 1 ? dots(rho, across, radius, radius + height, w, -1.0) : dots(rho, across, radius, radius + height, w, 1.0);
      if (direction == 2) d = max(d, dots(rho, across, radius, radius + height, w, -1.0));
      inside = clamp(0.5 + d, 0.0, 1.0);
    }
    vec3 c = i == 0 ? topColor : max(hueRotate(colors[i - 1], hue), 0.0);
    vec4 layer = vec4(c * inside, inside);
    acc = layer + acc * (1.0 - layer.a);
    float light = glow * exp(-max(-d, 0.0) / halo) * (1.0 - inside) * (i == 0 ? 0.08 : 0.3);
    acc.rgb += c * light * (1.0 - acc.a);
  }
  color = acc;
}`;

const LOGO = `${FRAGMENT_HEADER}
uniform sampler2D logo;
uniform int hasLogo;
uniform vec2 center;
uniform float radius;
uniform float rim;
uniform vec3 rimColor;
uniform vec2 imageScale;
uniform vec2 pan;
uniform float shadow;
// How far the logo has turned (radians), clockwise like a record (LS-16).
uniform float turn;

// Neutral placeholder: a four-pointed star on a dark disc.
vec3 placeholder(vec2 q) {
  vec3 base = mix(vec3(0.1, 0.07, 0.18), vec3(0.03, 0.03, 0.06), length(q));
  float star = sqrt(abs(q.x)) + sqrt(abs(q.y)) - sqrt(0.5);
  float inside = clamp(0.5 - star / max(fwidth(star), 1e-3), 0.0, 1.0);
  vec3 tint = mix(vec3(0.25, 0.85, 1.0), vec3(0.7, 0.44, 1.0), clamp(length(q) * 1.8, 0.0, 1.0));
  return mix(base, tint, inside);
}

void main() {
  vec2 p = gl_FragCoord.xy - center;
  float rho = length(p);
  float outer = radius + rim;
  float wDisc = radius - rho;
  float wOuter = outer - rho;
  float disc = clamp(0.5 + wDisc / max(fwidth(wDisc), 1e-3), 0.0, 1.0);
  float covered = clamp(0.5 + wOuter / max(fwidth(wOuter), 1e-3), 0.0, 1.0);
  // The picture turns clockwise: each point shows what lies the turn further on.
  vec2 q = mat2(cos(turn), sin(turn), -sin(turn), cos(turn)) * (p / radius);
  vec3 inner;
  if (hasLogo == 1) {
    vec2 c = 0.5 + q * imageScale * 0.5 + pan * 0.5 * (1.0 - imageScale);
    // Images are stored top row first (v = 0), straight alpha.
    vec4 t = texture(logo, vec2(c.x, 1.0 - c.y));
    inner = t.rgb * t.a + vec3(0.03, 0.03, 0.05) * (1.0 - t.a);
  } else {
    inner = placeholder(q);
  }
  vec4 result = vec4(inner * disc + rimColor * (covered - disc), covered);
  float shade = shadow * 0.8 * exp(-max(rho - outer, 0.0) / (radius * 0.1)) * (1.0 - covered);
  result.a += shade * (1.0 - result.a);
  color = result;
}`;

const MAX_PARTICLES = 600;
/** How quickly a logo that stops turning comes back upright (time constant, s). */
const UPRIGHT_SECONDS = 0.25;

/**
 * The slow drift of the background (LS-03, Ken Burns): a gentle zoom, and a pan within what
 * the zoom crops away, on periods of about half a minute that never line up.
 */
export function backgroundDrift(
  amount: number,
  time: number,
): { zoom: number; x: number; y: number } {
  if (amount <= 0) return { zoom: 1, x: 0, y: 0 };
  const turn = Math.PI * 2;
  return {
    zoom: 1 + amount * (0.06 + 0.06 * Math.sin((time * turn) / 37)),
    x: amount * 0.8 * Math.sin((time * turn) / 53),
    y: amount * 0.8 * Math.cos((time * turn) / 41),
  };
}

/**
 * The camera shake on kicks (LS-03): an offset of the whole picture that follows the kick's
 * envelope, in a direction that wanders quickly (the same for the same time, so exports match),
 * and the zoom that keeps the edges out of sight.
 */
export function cameraShake(amount: number, kick: number, time: number, aspect: number): Camera {
  if (amount <= 0) return NO_CAMERA;
  const reach = 0.012 * amount;
  const size = reach * Math.min(1, kick);
  const x = Math.sin(time * 71.3 + Math.sin(time * 23.1) * 2) * size;
  const y = Math.sin(time * 59.7 + Math.cos(time * 17.9) * 2 + 1.3) * size;
  // Offsets in parts of the shorter side, as UV offsets.
  return {
    x: aspect >= 1 ? x / aspect : x,
    y: aspect >= 1 ? y : y * aspect,
    zoom: 1 + 2.5 * reach,
  };
}

/** Scale of a logo image inside the circle: its shorter side fills the diameter. */
function imageScale(image: { width: number; height: number } | null): [number, number] {
  if (!image) return [1, 1];
  const aspect = image.width / image.height;
  return aspect > 1 ? [1 / aspect, 1] : [1, aspect];
}

class Follower {
  value = 0;
  constructor(
    private readonly attack: number,
    private readonly release: number,
  ) {}

  update(target: number, dt: number): number {
    const tau = target > this.value ? this.attack : this.release;
    this.value += (target - this.value) * (1 - Math.exp(-dt / tau));
    return this.value;
  }
}

export class LogoSpectrumScene implements Scene {
  readonly floatTargets: boolean;
  private readonly gl: WebGL2RenderingContext;
  private readonly triangle: WebGLVertexArrayObject;
  private readonly particleArray: WebGLVertexArrayObject;
  private readonly particleBuffer: WebGLBuffer;
  private readonly programs: {
    background: Program;
    copy: Program;
    blur: Program;
    particles: Program;
    ring: Program;
    logo: Program;
  };
  private readonly post: PostProcessing;
  private readonly curveTexture: WebGLTexture;
  private readonly shaper = new SpectrumShaper();
  private settings: LogoSpectrumSettings = DEFAULT_LOGO_SPECTRUM;
  private width = 1;
  private height = 1;
  private scene: Target | null = null;
  private frameCount = 0;

  private background: { texture: WebGLTexture; width: number; height: number } | null = null;
  /** The picture of the layer behind (VE-08), for this frame. */
  private layer: WebGLTexture | null = null;
  private blurred: Target | null = null;
  private blurredFor = -1;
  private logo: { texture: WebGLTexture; width: number; height: number } | null = null;
  /** The cover art of the track playing, and whether it takes the logo's place (LS-15). */
  private cover: { texture: WebGLTexture; width: number; height: number } | null = null;
  private coverLogo = false;
  /** The colours of the covers heard (VE-12) for the colour layers; null: the look's own. */
  private coverColors: CoverColors | null = null;
  /** How far the logo has turned with the music (LS-16), in turns (0…1). */
  private logoTurns = 0;

  private readonly bass = new Follower(0.015, 0.22);
  private readonly energy = new Follower(0.05, 0.5);
  private readonly colors = new Float32Array(MAX_LAYERS * 3);
  private readonly particleData = new Float32Array(MAX_PARTICLES * 4);
  private readonly particleState = new Float32Array(MAX_PARTICLES * 6);
  private readonly random = new Prng(1234);
  private particleCount = 0;
  /** Rain (LS-17): the wind's slant (sideways per downwards) and the time it sways by. */
  private wind = 0;
  private windTime = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.floatTargets = supportsFloatTargets(gl);
    this.triangle = createFullscreenTriangle(gl);
    this.programs = {
      background: new Program(gl, FULLSCREEN_VERTEX, BACKGROUND),
      copy: new Program(gl, FULLSCREEN_VERTEX, COPY),
      blur: new Program(gl, FULLSCREEN_VERTEX, BLUR),
      particles: new Program(gl, PARTICLE_VERTEX, PARTICLE_FRAGMENT),
      ring: new Program(gl, FULLSCREEN_VERTEX, RING),
      logo: new Program(gl, FULLSCREEN_VERTEX, LOGO),
    };
    this.post = new PostProcessing(gl, this.floatTargets);

    this.curveTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R16F,
      CURVE_POINTS,
      MAX_LAYERS + 1,
      0,
      gl.RED,
      gl.FLOAT,
      null,
    );
    setSampling(gl, gl.LINEAR, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);

    this.particleArray = gl.createVertexArray()!;
    gl.bindVertexArray(this.particleArray);
    this.particleBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.particleData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
  }

  /** Reduce flashing (VE-06): sudden jumps in brightness are damped. */
  setReduceFlashing(on: boolean): void {
    this.post.setReduceFlashing(on);
  }

  /** True when the settings show the Kaleidoscope behind (VE-08). */
  get wantsLayer(): boolean {
    return this.settings.backgroundSource === 'kaleidoscope';
  }

  /** The Kaleidoscope look behind of the settings shown now (null: the Kaleidoscope's own). */
  get layerLook(): KaleidoSettings | null {
    return this.settings.layerLook;
  }

  /** The picture of the layer behind for the next frame (null: none). */
  setBackgroundLayer(texture: WebGLTexture | null): void {
    this.layer = texture;
  }

  setSettings(settings: LogoSpectrumSettings): void {
    const blurChanged = settings.backgroundBlur !== this.settings.backgroundBlur;
    // Stars and raindrops move differently: the other kind starts afresh, all over the picture.
    if (settings.particleStyle !== this.settings.particleStyle) this.particleCount = 0;
    this.settings = settings;
    if (blurChanged) this.blurredFor = -1;
  }

  /** Replaces the background or logo image (null: the neutral default). */
  setImage(kind: ImageKind, image: ImageBitmap | null): void {
    const gl = this.gl;
    const current = kind === 'background' ? this.background : this.logo;
    if (current) gl.deleteTexture(current.texture);
    const next = image
      ? {
          texture: createImageTexture(gl, image),
          width: image.width,
          height: image.height,
        }
      : null;
    if (kind === 'background') {
      this.background = next;
      this.blurredFor = -1;
    } else {
      this.logo = next;
    }
  }

  /** The cover art of the track playing (null: none); it shows while {@link setCoverLogo}. */
  setCover(image: ImageBitmap | null): void {
    if (this.cover) this.gl.deleteTexture(this.cover.texture);
    this.cover = image
      ? { texture: createImageTexture(this.gl, image), width: image.width, height: image.height }
      : null;
  }

  /** Shows the cover art of the track playing as the logo, where it has one (LS-15). */
  setCoverLogo(on: boolean): void {
    this.coverLogo = on;
  }

  /** The colour layers take the colours of the covers heard (VE-12); null: the look's own. */
  setCoverColors(colors: CoverColors | null): void {
    this.coverColors = colors;
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height && this.scene) return;
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    deleteTarget(this.gl, this.scene);
    this.scene = createTarget(this.gl, this.width, this.height, this.floatTargets);
    this.post.resize(this.width, this.height);
  }

  render(input: SceneInput): void {
    const gl = this.gl;
    const s = this.settings;
    const { features } = input;
    const dt = Math.min(Math.max(input.dt, 0), 0.1);
    const scene = this.scene;
    if (!scene) return;
    this.frameCount++;
    // The logo turns with the music like a record: it stands while paused (LS-16). Not
    // turning at all, it comes back upright, the short way.
    if (s.logoSpin > 0) {
      const played = Math.min(Math.max(input.played ?? dt, -0.5), 0.5);
      this.logoTurns = (((this.logoTurns + (played * s.logoSpin) / 60) % 1) + 1) % 1;
    } else if (this.logoTurns !== 0) {
      const off = this.logoTurns > 0.5 ? this.logoTurns - 1 : this.logoTurns;
      const eased = off * Math.exp(-dt / UPRIGHT_SECONDS);
      this.logoTurns = Math.abs(eased) < 1e-4 ? 0 : (eased + 1) % 1;
    }

    // Audio drives.
    const low = 0.5 * features[F.bands]! + 0.5 * features[F.bands + 1]!;
    const bass = this.bass.update(Math.min(1, 0.6 * low ** 2 + 0.55 * features[F.kick]!), dt);
    const energy = this.energy.update(features[F.energy]!, dt);
    this.shaper.update(features, s, dt);

    // Geometry in pixels. The logo pulses with the bass, as far as the camera moves.
    const motion = input.motion ?? 1;
    const short = Math.min(this.width, this.height);
    const pulse = 1 + 0.07 * s.bassPulse * bass * motion;
    const radius = s.ringRadius * short * pulse;
    const cx = this.width * (0.5 + s.centerX);
    const cy = this.height * (0.5 + s.centerY);

    gl.bindVertexArray(this.triangle);
    gl.disable(gl.BLEND);
    this.ensureBlurredBackground();

    // Background, with the bass zoom and the slow drift (LS-03).
    bindTarget(gl, scene, this.width, this.height);
    const drift = backgroundDrift(s.drift, input.time);
    const zoom = (1 + 0.05 * s.backgroundPulse * bass * motion) * drift.zoom;
    const layered = this.wantsLayer && this.layer !== null;
    // The layer has the picture's size: it fills it as it is; an image under it fits as it does
    // alone.
    const [bx, by] = this.backgroundScale();
    const [sx, sy] = layered ? [1, 1] : [bx, by];
    const [tintR, tintG, tintB] = parseColor(s.backgroundTint);
    const [imageR, imageG, imageB] = parseColor(s.layerImageTint);
    this.programs.background
      .use()
      .texture('image', this.backgroundTexture(), 0)
      .texture('layer', layered ? this.layer : null, 1)
      .int('hasImage', this.background ? 1 : 0)
      .int('hasLayer', layered ? 1 : 0)
      .float('imageUnder', layered ? s.layerImage : 0)
      .vec2('imageScale', bx / zoom, by / zoom)
      .vec2('scale', sx / zoom, sy / zoom)
      .vec2(
        'pan',
        Math.max(-1, Math.min(1, s.backgroundX + drift.x)),
        Math.max(-1, Math.min(1, s.backgroundY + drift.y)),
      )
      .float('dim', s.backgroundDim)
      .float('time', input.time)
      .vec2('resolution', this.width, this.height)
      .vec3('tint', tintR, tintG, tintB)
      .float('tintAmount', s.backgroundTintAmount)
      .vec3('imageTint', imageR, imageG, imageB)
      .float('imageTintAmount', layered ? s.layerImageTintAmount : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Particles (additive).
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const rain = s.particleStyle === 'rain';
    const count = rain
      ? this.updateRain(dt, energy, bass, features)
      : this.updateParticles(dt, energy, features);
    if (count > 0) {
      gl.bindVertexArray(this.particleArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.particleData, 0, count * 4);
      const [tr, tg, tb] = parseColor(s.topColor);
      // The streaks fall along the wind, longer the faster they fall.
      const slant = Math.hypot(this.wind, 1);
      this.programs.particles
        .use()
        .vec2('resolution', this.width, this.height)
        .vec3('tint', 0.6 + 0.4 * tr, 0.6 + 0.4 * tg, 0.6 + 0.4 * tb)
        .int('style', rain ? 1 : 0)
        .vec2('along', rain ? this.wind / slant : 0, rain ? -1 / slant : 1)
        .float('stretch', rain ? Math.min(30, 8 + 12 * this.rainFall(energy, features)) : 1);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.bindVertexArray(this.triangle);
    }

    // Spectrum ring (premultiplied alpha).
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      CURVE_POINTS,
      MAX_LAYERS + 1,
      gl.RED,
      gl.FLOAT,
      this.shaper.curves,
    );
    const palette = coverBlend(this.coverColors, layerColors(s), (cover) => cover.layers);
    for (let i = 0; i < MAX_LAYERS; i++) {
      const [r, g, b] = parseColor(palette[i % palette.length]!);
      this.colors[i * 3] = r;
      this.colors[i * 3 + 1] = g;
      this.colors[i * 3 + 2] = b;
    }
    const [tr, tg, tb] = parseColor(s.topColor);
    const rotation = ((s.rotation / 360 + (s.spin * input.time) / 60) % 1) * Math.PI * 2;
    this.programs.ring
      .use()
      .texture('curves', this.curveTexture, 0)
      .vec2('center', cx, cy)
      .float('radius', radius)
      .float('amplitude', s.amplitude * s.ringRadius * short)
      .float('spread', s.layerSpread)
      .int('layers', s.layers)
      .vec3Array('colors', this.colors)
      .vec3('topColor', tr, tg, tb)
      .float('rotation', rotation)
      .float('glow', s.glow)
      .float('glowRadius', s.glowRadius)
      .float('hue', ((s.hueCycle * input.time) / 60) * Math.PI * 2)
      .int('style', RING_STYLES.indexOf(s.ringStyle))
      .int('direction', RING_DIRECTIONS.indexOf(s.ringDirection))
      .float('bars', s.bars)
      .float('thickness', s.thickness);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Logo: the cover art fills the circle; zoom and pan are for the logo image.
    const cover = this.coverLogo ? this.cover : null;
    const logo = cover ?? this.logo;
    const logoZoom = cover ? 1 : s.logoZoom;
    const logoRadius = radius * s.logoSize;
    const [lr, lg, lb] = parseColor(s.rimColor);
    const [ix, iy] = imageScale(logo);
    this.programs.logo
      .use()
      .texture('logo', logo?.texture ?? null, 0)
      .int('hasLogo', logo ? 1 : 0)
      .vec2('center', cx, cy)
      .float('radius', logoRadius)
      .float('rim', s.rimWidth * logoRadius)
      .vec3('rimColor', lr, lg, lb)
      .vec2('imageScale', ix / logoZoom, iy / logoZoom)
      .vec2('pan', cover ? 0 : s.logoPanX, cover ? 0 : s.logoPanY)
      .float('shadow', s.logoShadow)
      .float('turn', this.logoTurns * Math.PI * 2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);

    this.post.present(
      scene,
      s.bloom,
      this.width,
      this.height,
      this.frameCount,
      cameraShake(s.shake * motion, features[F.kick]!, input.time, this.width / this.height),
      input.dt,
    );
    gl.bindVertexArray(null);
  }

  saveState(): SceneSnapshot {
    const calm = this.post.saveState();
    return {
      values: {
        frameCount: this.frameCount,
        bass: this.bass.value,
        energy: this.energy.value,
        particleCount: this.particleCount,
        wind: this.wind,
        windTime: this.windTime,
        random: this.random.state,
        logoTurns: this.logoTurns,
        calm: calm !== null,
      },
      buffers: [
        ...this.shaper.saveState(),
        this.particleState.slice(),
        this.particleData.slice(),
        ...(calm ? [calm] : []),
      ],
    };
  }

  restoreState(snapshot: SceneSnapshot): void {
    const { values, buffers } = snapshot;
    const [curves, bands, particleState, particleData, calm] = buffers;
    if (
      !(particleState instanceof Float32Array) ||
      !(particleData instanceof Float32Array) ||
      particleState.length !== this.particleState.length ||
      particleData.length !== this.particleData.length
    ) {
      throw new Error('Snapshot does not match the Logo Spectrum scene');
    }
    this.shaper.restoreState([curves as Float32Array, bands as Float32Array]);
    this.particleState.set(particleState);
    this.particleData.set(particleData);
    this.frameCount = Number(values['frameCount']);
    this.bass.value = Number(values['bass']);
    this.energy.value = Number(values['energy']);
    this.particleCount = Number(values['particleCount']);
    // Snapshots of before the rain have no wind.
    this.wind = Number(values['wind'] ?? 0);
    this.windTime = Number(values['windTime'] ?? 0);
    this.random.state = Number(values['random']);
    // Snapshots of before the logo turned have none.
    this.logoTurns = Number(values['logoTurns'] ?? 0);
    this.post.restoreState(values['calm'] === true ? calm : null);
  }

  dispose(): void {
    const gl = this.gl;
    this.post.dispose();
    deleteTarget(gl, this.scene);
    deleteTarget(gl, this.blurred);
    if (this.background) gl.deleteTexture(this.background.texture);
    if (this.logo) gl.deleteTexture(this.logo.texture);
    if (this.cover) gl.deleteTexture(this.cover.texture);
    gl.deleteTexture(this.curveTexture);
  }

  /** UV scale that fits the background image (cover or contain). */
  private backgroundScale(): [number, number] {
    if (!this.background) return [1, 1];
    const canvas = this.width / this.height;
    const image = this.background.width / this.background.height;
    const cover = this.settings.backgroundFit === 'cover';
    if (image > canvas === cover) return [canvas / image, 1];
    return [1, image / canvas];
  }

  private backgroundTexture(): WebGLTexture | null {
    if (!this.background) return null;
    return this.blurred ? this.blurred.texture : this.background.texture;
  }

  /** Blurs a downscaled copy of the background when the image or the blur amount changed. */
  private ensureBlurredBackground(): void {
    const gl = this.gl;
    const blur = this.settings.backgroundBlur;
    if (this.blurredFor === blur) return;
    this.blurredFor = blur;
    deleteTarget(gl, this.blurred);
    this.blurred = null;
    if (!this.background || blur <= 0) return;
    const long = 768;
    const aspect = this.background.width / this.background.height;
    const width = aspect >= 1 ? long : Math.round(long * aspect);
    const height = aspect >= 1 ? Math.round(long / aspect) : long;
    const a = createTarget(gl, width, height, this.floatTargets);
    const b = createTarget(gl, width, height, this.floatTargets);
    bindTarget(gl, a, width, height);
    this.programs.copy.use().texture('source', this.background.texture, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const sigma = Math.max(0.5, blur * 14);
    bindTarget(gl, b, width, height);
    this.programs.blur
      .use()
      .texture('source', a.texture, 0)
      .vec2('direction', 1 / width, 0)
      .float('sigma', sigma);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    bindTarget(gl, a, width, height);
    this.programs.blur.texture('source', b.texture, 0).vec2('direction', 0, 1 / height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    deleteTarget(gl, b);
    this.blurred = a;
  }

  /**
   * Star particles drifting outward from the middle; faster and brighter with the music.
   * State per particle: x, y (pixels from the centre, as a fraction of the shorter side),
   * velocity x, y, depth (size and speed), twinkle phase.
   */
  private updateParticles(dt: number, energy: number, features: Float32Array): number {
    const s = this.settings;
    const wanted = Math.min(MAX_PARTICLES, s.particles);
    const state = this.particleState;
    while (this.particleCount < wanted) this.spawnParticle(this.particleCount++, true);
    this.particleCount = wanted;
    const short = Math.min(this.width, this.height);
    const halfWidth = this.width / short / 2 + 0.05;
    const halfHeight = this.height / short / 2 + 0.05;
    const speed = s.particleSpeed * (0.35 + 1.4 * energy + 1.2 * features[F.kick]!);
    const sparkle = 0.65 + 0.35 * features[F.hat]! + 0.3 * features[F.beat]!;
    const data = this.particleData;
    for (let i = 0; i < wanted; i++) {
      const o = i * 6;
      const depth = state[o + 4]!;
      state[o]! += state[o + 2]! * speed * depth * dt;
      state[o + 1]! += state[o + 3]! * speed * depth * dt;
      state[o + 5]! += dt * (0.8 + depth);
      const x = state[o]!;
      const y = state[o + 1]!;
      if (Math.abs(x) > halfWidth || Math.abs(y) > halfHeight) {
        this.spawnParticle(i, false);
        continue;
      }
      // Fade in near the middle, twinkle.
      const distance = Math.hypot(x, y);
      const fade = Math.min(1, distance / 0.25);
      const twinkle = 0.75 + 0.25 * Math.sin(state[o + 5]! * 3);
      data[i * 4] = x * short;
      data[i * 4 + 1] = y * short;
      data[i * 4 + 2] = s.particleSize * short * (0.0025 + 0.005 * depth);
      data[i * 4 + 3] = fade * twinkle * sparkle * (0.35 + 0.65 * depth);
    }
    return wanted;
  }

  /** How fast the rain falls now: its speed, more with the music (louder, on the kicks). */
  private rainFall(energy: number, features: Float32Array): number {
    return this.settings.particleSpeed * (0.7 + 0.8 * energy + 0.6 * features[F.kick]!);
  }

  /**
   * Rain (LS-17, Kanban 21): streaks fall from above the picture, nearer ones faster, longer and
   * brighter; faster with the music. A wind slants them: it sways slowly, and the bass blows it
   * further. State per drop as for the stars: x, y, (unused) x, y, depth, phase.
   */
  private updateRain(dt: number, energy: number, bass: number, features: Float32Array): number {
    const s = this.settings;
    const wanted = Math.min(MAX_PARTICLES, s.particles);
    const state = this.particleState;
    while (this.particleCount < wanted) this.spawnDrop(this.particleCount++, true);
    this.particleCount = wanted;
    this.windTime += dt;
    const sway = 0.18 * Math.sin(this.windTime * 0.11) + 0.08 * Math.sin(this.windTime * 0.37 + 1);
    const target = sway + 0.3 * bass * Math.sign(sway || 1);
    this.wind += (target - this.wind) * (1 - Math.exp(-dt / 0.8));
    const short = Math.min(this.width, this.height);
    const halfWidth = this.width / short / 2;
    const halfHeight = this.height / short / 2;
    const fall = this.rainFall(energy, features);
    const sparkle = 0.75 + 0.25 * features[F.hat]!;
    const data = this.particleData;
    for (let i = 0; i < wanted; i++) {
      const o = i * 6;
      const depth = state[o + 4]!;
      const speed = (1.1 + 1.9 * depth) * fall;
      state[o]! += this.wind * speed * dt;
      state[o + 1]! -= speed * dt;
      const x = state[o]!;
      const y = state[o + 1]!;
      if (y < -halfHeight - 0.15 || Math.abs(x) > halfWidth + 0.4) {
        this.spawnDrop(i, false);
        continue;
      }
      data[i * 4] = x * short;
      data[i * 4 + 1] = y * short;
      data[i * 4 + 2] = s.particleSize * short * (0.0008 + 0.0016 * depth);
      data[i * 4 + 3] = sparkle * (0.2 + 0.8 * depth);
    }
    return wanted;
  }

  /** A raindrop above the picture, or anywhere on it (when the rain starts). */
  private spawnDrop(index: number, anywhere: boolean): void {
    const random = () => this.random.next();
    const o = index * 6;
    const short = Math.min(this.width, this.height);
    const halfWidth = this.width / short / 2;
    const halfHeight = this.height / short / 2;
    const state = this.particleState;
    // Upwind of the picture too, so the slanted rain also fills its far side.
    state[o] = (random() * 2 - 1) * (halfWidth + 0.3);
    state[o + 1] = anywhere ? (random() * 2 - 1) * halfHeight : halfHeight + 0.1 + random() * 0.3;
    state[o + 2] = 0;
    state[o + 3] = 0;
    state[o + 4] = random() ** 1.5;
    state[o + 5] = random() * 10;
    this.particleData[index * 4 + 3] = 0;
  }

  private spawnParticle(index: number, anywhere: boolean): void {
    const random = () => this.random.next();
    const o = index * 6;
    const angle = random() * Math.PI * 2;
    const distance = anywhere ? 0.05 + random() * 0.9 : 0.08 + random() * 0.25;
    const state = this.particleState;
    state[o] = Math.cos(angle) * distance;
    state[o + 1] = Math.sin(angle) * distance;
    const velocity = 0.04 + random() * 0.08;
    // Mostly outward, with a slight upward drift.
    state[o + 2] = Math.cos(angle) * velocity;
    state[o + 3] = Math.sin(angle) * velocity + 0.01;
    state[o + 4] = 0.25 + random() * 0.75;
    state[o + 5] = random() * 10;
    this.particleData[index * 4 + 3] = 0;
  }
}
