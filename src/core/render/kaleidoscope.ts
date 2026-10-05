import { F } from '../analysis/features';
import {
  bindTarget,
  createFullscreenTriangle,
  createTarget,
  deleteTarget,
  FRAGMENT_HEADER,
  FULLSCREEN_VERTEX,
  Program,
  readTarget,
  setSampling,
  supportsFloatTargets,
  writeTarget,
  type Target,
} from './gl';
import {
  COMMON_PARAMS,
  DEFAULT_KALEIDO,
  gradientColors,
  sceneById,
  type KaleidoSceneId,
  type KaleidoSettings,
  type ParamSpec,
} from './kaleido-settings';
import { NO_CAMERA, PostProcessing } from './post';
import {
  FixedStepper,
  type Scene,
  type SceneInput,
  type SceneSnapshot,
  type SnapshotBuffer,
} from './scene';
import { coverBlend, type CoverColors } from './cover-palette';
import { parseColor } from './visual-settings';

/**
 * Mode A, "Kaleidoscope" (KA-*): MilkDrop-style feedback (KA-06). Each step warps the previous
 * picture (tunnel flow, twist, swirl, fibre noise), lets it fade and adds new light from the
 * scene. A composite pass folds the result into mirrored segments (KA-05) and colours it
 * through a palette (KA-07).
 *
 * The feedback buffer stores intensity (R), intensity × palette position (G) and highlights
 * (B), so the content keeps its colour while it moves and fades, and palettes can change at any
 * time. It runs in fixed steps of 1/60 s in half-float buffers: the same at any frame rate and in
 * the export (VE-03); the display interpolates between the last two steps.
 */

const STEPS_PER_SECOND = 60;
const PALETTE_SIZE = 256;
/**
 * The state covers the circle around the frame's corners, and this much more, for the warps of
 * a step that look a little further out.
 */
const STATE_MARGIN = 1.05;
/** The largest side of the state (pixels): a 4K frame would ask for more than 4600. */
const MAX_STATE_SIZE = 4096;

/**
 * The square the feedback runs on, for a frame of `width` × `height` pixels: its side (pixels)
 * and half of it (`reach`, in units of half the frame's height). It holds the circle the
 * frame's corners turn on, at the frame's pixel density, and at most `largest` pixels.
 */
export function stateSquare(
  width: number,
  height: number,
  largest = MAX_STATE_SIZE,
): { side: number; reach: number } {
  const reach = Math.hypot(width / height, 1) * STATE_MARGIN;
  const side = Math.max(1, Math.min(largest, MAX_STATE_SIZE, Math.round(height * reach)));
  return { side, reach };
}

/**
 * How far the state must reach (units of half the frame's height) for the frame to show only
 * light that was simulated, at a zoom and a centre moved by `centerX`, `centerY` (KA-05): the
 * farthest corner from the centre, through the zoom. Zoomed out, the composite looks further out
 * than the frame's corners, and found nothing there but a dark edge, a circle around the picture.
 */
export function viewReach(aspect: number, zoom: number, centerX: number, centerY: number): number {
  const corner = Math.hypot(aspect * (1 + 2 * Math.abs(centerX)), 1 + 2 * Math.abs(centerY));
  return (corner * STATE_MARGIN) / zoom;
}

/** The reach grows and shrinks in steps of an eighth of an octave: a few redraws per zoom. */
const REACH_STEPS = 8;

/**
 * The reach the state takes, from `base` (zoom 1, in the middle) for a view that needs `needed`,
 * having `current`: the step that holds it, never less than `base` (zoomed in, the light still
 * comes from as far out as before). It grows at once and shrinks once the view needs two steps
 * less, so a slider moved to and fro over a step does not redraw the state each time.
 */
export function nextReach(base: number, needed: number, current: number): number {
  const step = (reach: number) =>
    Math.max(0, Math.ceil(Math.log2(reach / base) * REACH_STEPS - 1e-6));
  const want = step(needed);
  const have = step(current);
  const next = want > have || want < have - 1 ? want : have;
  return base * 2 ** (next / REACH_STEPS);
}

/** How long the colours take to come back when the hue cycle stops (s). */
const HUE_RETURN = 0.5;

/**
 * The hue after `dt` seconds at `cycle` turns a minute (radians). At 0 it goes back to the look's
 * own colours, the short way round, instead of staying where the cycle left it.
 */
export function nextHue(hue: number, cycle: number, dt: number): number {
  const turn = Math.PI * 2;
  if (cycle !== 0) return (hue + (cycle / 60) * turn * dt) % turn;
  const back = hue - turn * Math.round(hue / turn);
  const next = back * Math.exp(-dt / HUE_RETURN);
  return Math.abs(next) < 1e-3 ? 0 : next;
}

/** Noise and helpers shared by the step shaders. */
const NOISE = `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec2 gradient(vec2 cell) {
  float angle = hash(cell) * 6.28318530718;
  return vec2(cos(angle), sin(angle));
}
/** Gradient noise, about 0…1: smoother than value noise, without its grid-aligned ridges. */
float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = dot(gradient(i), f);
  float b = dot(gradient(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(gradient(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(gradient(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return clamp(0.5 + 0.8 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y), 0.0, 1.0);
}
float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p = p * 2.03 + 17.1;
    amplitude *= 0.5;
  }
  return value;
}
mat2 rotation(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, s, -s, c);
}
`;

/** Uniforms and the warp every step shader starts with. */
const STEP_HEADER = `${FRAGMENT_HEADER}
uniform sampler2D previous;
/** The state's size in pixels. */
uniform vec2 resolution;
/**
 * Half the width and the height the state covers, in units of half the frame's height: past
 * the frame's corners in every direction, so the spin never turns its edge into view.
 */
uniform vec2 extent;
/** The frame's width by its height. */
uniform float frameAspect;
uniform float time;
uniform float dt;
uniform float kick;
uniform float snare;
uniform float hat;
uniform float bass;
uniform float energy;
uniform float treble;
uniform float beat;
/** 1 for one step right after a detected kick or beat, else 0. */
uniform float kickPulse;
uniform float beatPulse;
uniform float paletteOffset;
uniform float p_flow;
uniform float p_twist;
uniform float p_trails;
uniform float p_intensity;
${NOISE}
/** Centred coordinates: y from -1 to 1 over the frame's height, x on the same scale. */
vec2 centred(vec2 uv) {
  return (uv - 0.5) * 2.0 * extent;
}
/**
 * Beyond the circle around the frame's corners nothing is ever shown: the state stays dark
 * there, and the step costs little.
 */
bool unseen(vec2 p) {
  return dot(p, p) > extent.y * extent.y;
}
/** The previous state at centred position q, faded by the trails and towards the state's edge. */
vec4 fetch(vec2 q) {
  vec2 source = q / extent * 0.5 + 0.5;
  vec2 edge = smoothstep(vec2(0.0), vec2(0.03), source) * smoothstep(vec2(0.0), vec2(0.03), 1.0 - source);
  float halfLife = mix(0.08, 2.5, p_trails * p_trails);
  // A little sharpening counters the blur that resampling adds on every step.
  vec2 texel = 1.0 / resolution;
  vec4 centre = texture(previous, source);
  vec4 around = texture(previous, source + vec2(texel.x, 0.0)) + texture(previous, source - vec2(texel.x, 0.0))
    + texture(previous, source + vec2(0.0, texel.y)) + texture(previous, source - vec2(0.0, texel.y));
  vec4 sharp = max(centre + 0.05 * (centre - around * 0.25), 0.0);
  return sharp * exp2(-dt / halfLife) * edge.x * edge.y;
}
`;

const VORTEX = `${STEP_HEADER}
uniform float p_arms;
uniform float p_swirl;
uniform float p_strands;
uniform float p_fiber;

void main() {
  vec2 p = centred(uv);
  if (unseen(p)) {
    color = vec4(0.0);
    return;
  }
  float r = length(p);

  // Where the light now at p came from: pulled in (flow < 0) or pushed out, twisted, swirled
  // faster near the core, and frayed by fine turbulence into fibres.
  float flow = p_flow * (1.0 + 1.5 * kick);
  float scale = exp(-flow * 0.8 * dt);
  float turn = (p_twist * 1.2 + p_swirl * 0.9 / (0.25 + r)) * (1.0 + 0.6 * bass) * dt;
  vec2 q = rotation(turn) * p * scale;
  vec2 turbulence = vec2(gnoise(q * 9.0 + time * 0.3), gnoise(q * 9.0 - time * 0.3 + 13.7)) - 0.5;
  q += turbulence * p_fiber * 0.004;
  vec4 state = fetch(q);
  // The core swallows the light.
  state *= mix(0.9, 1.0, smoothstep(0.02, 0.3, r));

  // New strands: short, thin ridges of noise all over the outer part, repeated around the
  // circle (the arms). The flow and the twist draw them out into spiral fibres.
  float a = atan(p.y, p.x);
  vec2 around = vec2(cos(a * p_arms), sin(a * p_arms));
  float outer = smoothstep(0.55, 1.1, r) * (1.0 - smoothstep(1.25, 1.6, r));
  float density = 4.0 + 10.0 * p_strands;
  float ridge = 1.0 - abs(2.0 * gnoise(around * density + vec2(time * 0.5, r * 5.0)) - 1.0);
  float strand = pow(ridge, 14.0) * smoothstep(0.35, 0.7, gnoise(p * 2.0 + time * 0.1));
  float light = outer * strand * (0.4 + 1.5 * energy + 2.5 * kick) * p_intensity;
  light *= dt * 8.0;
  // A bright, broken ring on every kick, which spirals in.
  light += kickPulse * p_intensity * 0.5 * exp(-pow((r - 1.05) / 0.025, 2.0)) * smoothstep(0.35, 0.8, noise(around * 5.0 + time));
  // Two tones: which one depends on the angle, slowly drifting.
  float tone = step(0.5, noise(around * 0.9 + vec2(time * 0.05, 3.1)));
  float index = fract(mix(0.22, 0.8, tone) + paletteOffset);
  // Sparks on the hi-hats: small round dots in the outer part.
  vec2 grid = p * 36.0;
  vec2 local = fract(grid) - 0.5;
  float slot = floor(time * 20.0);
  float spark = hat * step(0.995, hash(floor(grid) + slot * 1.37)) * exp(-dot(local, local) * 60.0);
  spark *= outer * 0.8;
  color = state + vec4(light, light * index, spark + light * 0.3 * kick, 0.0);
}`;

const CRYSTAL = `${STEP_HEADER}
uniform float p_points;
uniform float p_starSize;
uniform float p_shards;
uniform float p_sparks;

void main() {
  vec2 p = centred(uv);
  if (unseen(p)) {
    color = vec4(0.0);
    return;
  }
  float r = length(p);
  float a = atan(p.y, p.x);

  // Pushed outward (flow > 0) with a slight twist: shards stretch into streaks. Kicks push
  // the tunnel on.
  float flow = p_flow * (1.0 + 3.0 * kick);
  vec2 q = rotation(p_twist * 0.8 * dt) * p * exp(-flow * 0.9 * dt);
  vec4 state = fetch(q);

  // A pulsing star outline in the centre, swelling with the kick and the bass; the outward flow
  // turns it into a tunnel of stars.
  float size = p_starSize * (1.0 + 0.35 * kick + 0.15 * bass);
  float spikes = pow(0.5 + 0.5 * cos(p_points * a), 3.0);
  float edge = size * mix(0.5, 1.0, spikes);
  float outline = exp(-pow((r - edge) / 0.014, 2.0));
  // One star per kick and per beat: separate glowing stars travel outward.
  float light = outline * (0.02 + 0.15 * energy + 2.0 * kick + 18.0 * kickPulse + 8.0 * beatPulse) * p_intensity;
  float index = 0.62;

  // Crystal shards: sharp angular ridges just outside the star.
  vec2 around = vec2(cos(a), sin(a));
  float ridge = 1.0 - abs(2.0 * gnoise(around * (6.0 + 18.0 * p_shards) + vec2(time * 0.3, r * 3.0)) - 1.0);
  float shardBand = smoothstep(size * 1.1, size * 1.4, r) * (1.0 - smoothstep(size * 1.6, size * 2.4, r));
  float shard = pow(ridge, 12.0) * shardBand * p_shards * (0.12 + 0.4 * energy + 3.5 * snare + 0.8 * kick) * p_intensity;
  light += shard;
  index = mix(index, 0.4 + 0.35 * noise(around * 3.0 + time * 0.1), shard / max(light, 1e-4));
  light *= dt * 4.0;

  // Sparks fly out from the star on the hi-hats: round dots with a cyan colour.
  vec2 grid = p * 40.0;
  vec2 local = fract(grid) - 0.5;
  float cell = hash(floor(grid) + floor(time * 20.0) * 1.37);
  float spark = hat * p_sparks * step(0.985, cell) * exp(-dot(local, local) * 40.0);
  spark *= smoothstep(size * 3.0, size, r) * 2.0;
  float sparkIndex = 0.93;
  float total = light + spark * 0.5;
  float mixedIndex = fract((light * index + spark * 0.5 * sparkIndex) / max(total, 1e-4) + paletteOffset);
  color = state + vec4(total, total * mixedIndex, spark * 0.6, 0.0);
}`;

const RIBBONS = `${STEP_HEADER}
uniform float p_ribbons;
uniform float p_lobes;
uniform float p_weave;
uniform float p_thickness;
uniform float p_depth;
uniform float p_blossoms;
uniform float p_flowers;
uniform float p_halo;
uniform float p_bokeh;
uniform float p_sheen;

const float TAU = 6.28318530718;
const int MAX_RIBBONS = 4;
const int FLOWERS = 24;

/**
 * A fractal blossom around 0 (radius about 1), 0…1: folded five ways, each petal an outline
 * with a smaller blossom at its tip, three levels deep.
 */
float blossomAt(vec2 u) {
  float petals = 0.0;
  float level = 1.0;
  for (int i = 0; i < 3; i++) {
    float fold = TAU / 5.0;
    float angle = abs(mod(atan(u.y, u.x) + fold * 0.5, fold) - fold * 0.5);
    u = vec2(cos(angle), sin(angle)) * length(u);
    vec2 petal = (u - vec2(0.5, 0.0)) * vec2(1.0, 2.4);
    petals += exp(-pow((length(petal) - 0.34) / (0.06 * level), 2.0)) / level;
    // The next, smaller blossom sits at the tip of this petal.
    u = (u - vec2(0.78, 0.0)) * 2.6;
    level *= 2.6;
  }
  return min(1.0, petals);
}

/**
 * A palette position in the bright part (0.25…1: pink, yellow, green, cyan in the Ribbons
 * palette), moved on by the colour step per bar and wrapping within that part.
 */
float bright(float index) {
  return 0.25 + mod(index - 0.25 + paletteOffset, 0.7501);
}

void main() {
  vec2 screen = centred(uv);
  if (unseen(screen)) {
    color = vec4(0.0);
    return;
  }

  // What was here flows on (outward in the look) and twists: the tubes leave neon trails and
  // the flowers float away. Kicks push it on.
  float flow = p_flow * (1.0 + 2.0 * kick);
  vec2 q = rotation(p_twist * 0.8 * dt) * screen * exp(-flow * 0.6 * dt);
  vec4 state = fetch(q);

  // The wreath fits a narrow frame too (9:16): everything is drawn a little smaller there.
  vec2 p = screen / min(1.0, frameAspect / 0.9);
  float r = length(p);
  float a = atan(p.y, p.x);

  float lobes = p_lobes;
  float count = p_ribbons;
  float lobeAngle = TAU / lobes;
  float turn = time * 0.12;
  float radius = 0.5 * (1.0 + 0.08 * kick + 0.04 * bass);
  float swing = (0.04 + 0.22 * p_weave) * (1.0 + 0.25 * bass);
  float glow = (0.9 + 0.2 * energy + 0.15 * kick) * p_intensity;
  float pixel = 2.0 * extent.y / resolution.y;

  // The middle of the lobe at this angle, and the size of what lights it and the centre.
  float slot = floor((a - turn) / lobeAngle + 0.5);
  float centreAngle = turn + slot * lobeAngle;
  vec2 centre = vec2(cos(centreAngle), sin(centreAngle)) * (radius + swing * 0.5);
  float pulse = 1.0 + 0.3 * snare;
  float size = (0.06 + 0.3 * swing) * pulse;
  float inner = (radius - swing) * 0.55 * pulse;

  // Blossoms in the lobes, and a larger one in the centre: small fractals, glowing orange on
  // the snare. Light behind the tubes.
  if (p_blossoms > 0.0) {
    float blossom = max(
      blossomAt(rotation(time * 0.25 - centreAngle) * (p - centre) / size),
      blossomAt(rotation(-time * 0.15) * p / inner) * 0.8
    ) * p_blossoms;
    float blossomLight = (0.55 + 0.3 * energy + 0.6 * snare) * p_intensity;
    state = mix(state, vec4(blossomLight, blossomLight * bright(0.4), 0.1 * snare, 0.0), blossom);
  }

  // Halo: fine rings of light in the lobes and around the centre, pulsing with the snare, and
  // a breath of light inside them (the feedback adds up a small share step by step, about six
  // times over). Light behind the tubes, as from a lens rather than a drawing.
  if (p_halo > 0.0) {
    float lobeR = length(p - centre) / size;
    float coreR = r / inner;
    float ringWidth = 0.025 + 0.03 * snare;
    float lobeRing = (lobeR - 1.0) / ringWidth;
    float coreRing = (coreR - 0.8) / (ringWidth * 0.5);
    float lobeHalo = exp(-lobeR * lobeR * 0.8) * 0.015 + exp(-lobeRing * lobeRing) * 0.5;
    float coreHalo = exp(-coreR * coreR * 0.7) * 0.01 + exp(-coreRing * coreRing) * 0.35;
    float halo = clamp(max(lobeHalo, coreHalo), 0.0, 1.0) * p_halo;
    float haloLight = (0.5 + 0.35 * energy + 0.8 * snare) * p_intensity;
    state = mix(state, vec4(haloLight, haloLight * bright(0.5), 0.12 * snare, 0.0), halo);
  }

  // Bokeh: soft round lights drift outward, as if out of focus: the nearer, the larger, softer
  // and fainter. They brighten on the hi-hats. Each owns a sector and may reach into the next
  // ones, so a pixel looks at three.
  if (p_bokeh > 0.0) {
    const float LIGHTS = 18.0;
    float lightAngle = TAU / LIGHTS;
    float own = floor(a / lightAngle);
    for (int k = -1; k <= 1; k++) {
      float sectorK = own + float(k);
      float seedK = mod(sectorK, LIGHTS) * 3.71 + 100.0;
      float lifeK = 5.0 + 4.0 * hash(vec2(seedK, 1.0));
      float cycleK = time / lifeK + hash(vec2(seedK, 2.0));
      float ageK = fract(cycleK);
      float bornK = floor(cycleK);
      if (hash(vec2(seedK, bornK + 7.0)) >= p_bokeh) continue;
      float nearK = hash(vec2(seedK, bornK + 3.0));
      float angleK = (sectorK + 0.2 + 0.6 * hash(vec2(seedK, bornK))) * lightAngle;
      float start = radius + swing * (hash(vec2(seedK, bornK + 9.0)) * 2.0 - 1.0) + 0.1;
      vec2 at = vec2(cos(angleK), sin(angleK)) * (start + ageK * (0.25 + 0.35 * nearK));
      float sizeK = mix(0.02, 0.11, nearK * nearK) * (1.0 + 0.15 * hat);
      float dist = length(p - at) / sizeK;
      if (dist > 1.2) continue;
      float soft = mix(0.25, 0.75, nearK);
      float disc = 1.0 - smoothstep(1.0 - soft, 1.0, dist);
      float rimDistance = (dist - 0.9) / 0.08;
      float rim = exp(-rimDistance * rimDistance) * (1.0 - nearK) * 0.5;
      float fade = smoothstep(0.0, 0.25, ageK) * (1.0 - smoothstep(0.55, 1.0, ageK));
      float amount = clamp(disc * 0.6 + rim, 0.0, 1.0) * fade * mix(0.85, 0.45, nearK);
      float bokehLight = (0.6 + 0.8 * hat) * p_intensity;
      float bokehIndex = bright(0.25 + 0.75 * hash(vec2(seedK, bornK + 5.0)));
      state = mix(state, vec4(bokehLight, bokehLight * bokehIndex, 0.2 * bokehLight, 0.0), amount);
    }
  }

  // Flowers: small five-petal flowers float outward from the ribbons, each for a few seconds,
  // turning slowly; they light up on the hi-hats. Each owns a sector of the circle and stays
  // inside it, so a pixel looks at one flower only.
  float sectorAngle = TAU / float(FLOWERS);
  float sector = floor(a / sectorAngle);
  float seed = mod(sector, float(FLOWERS)) * 7.13;
  float life = 4.0 + 3.0 * hash(vec2(seed, 1.0));
  float cycle = time / life + hash(vec2(seed, 2.0));
  float age = fract(cycle);
  float born = floor(cycle);
  // The flower count: some sectors stay empty.
  if (p_flowers > 0.0 && hash(vec2(seed, born + 7.0)) < p_flowers) {
    float angle = (sector + 0.25 + 0.5 * hash(vec2(seed, born))) * sectorAngle;
    vec2 at = vec2(cos(angle), sin(angle)) * (radius + swing + age * 0.8);
    float flowerSize = 0.028 * (0.7 + 0.6 * hash(vec2(seed, born + 3.0))) * (1.0 + 0.4 * hat);
    vec2 d = p - at;
    if (dot(d, d) < flowerSize * flowerSize * 1.5) {
      d = rotation(time * (hash(vec2(seed, 4.0)) - 0.5) * 3.0) * d;
      float outline = flowerSize * (0.55 + 0.45 * pow(abs(cos(atan(d.y, d.x) * 2.5)), 0.8));
      float fade = smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.6, 1.0, age));
      float flower = smoothstep(pixel, -pixel, length(d) - outline) * fade;
      float light = (0.5 + 0.6 * hat) * p_intensity;
      float flowerIndex = bright(0.25 + fract(hash(vec2(seed, born + 5.0)) * 4.0) * 0.75);
      state = mix(state, vec4(light, light * flowerIndex, 0.3 * hat, 0.0), flower);
    }
  }

  // The ribbons: closed tubes around the centre, each with the same lobes, set off from each
  // other so that they cross, over and under in turn (their depth is cos of the lobe phase).
  float depths[MAX_RIBBONS];
  float cover[MAX_RIBBONS];
  vec4 tube[MAX_RIBBONS];
  for (int i = 0; i < MAX_RIBBONS; i++) {
    depths[i] = 10.0;
    cover[i] = 0.0;
    tube[i] = vec4(0.0);
    if (float(i) >= count) continue;
    float x = lobes * (a - turn - float(i) * lobeAngle / count);
    // On a kick, every other ribbon swings further out and the others less: they breathe.
    float amplitude = swing * (1.0 + 0.3 * kick * (mod(float(i), 2.0) * 2.0 - 1.0));
    float f = radius + amplitude * sin(x);
    // The distance across the curve (its slope measured on the curve, so it holds up near the
    // centre too).
    float slope = amplitude * lobes * cos(x) / f;
    float d = (r - f) / sqrt(1.0 + slope * slope);
    float z = cos(x);
    float near = 0.5 + 0.5 * z;
    float width = (0.012 + 0.045 * p_thickness) * (1.0 + 0.15 * kick) * mix(1.0, 0.7 + 0.3 * near, p_depth);
    float s = d / width;
    float edge = min(1.0, pixel / width);
    cover[i] = 1.0 - smoothstep(1.0 - edge, 1.0, abs(s));
    // A tube: bright along the middle, darker to its sides and further away; a highlight on
    // the side towards the light.
    float facing = sqrt(max(0.0, 1.0 - s * s));
    float dim = mix(1.0, 0.35 + 0.65 * near, p_depth);
    float shade = (0.22 + 0.78 * facing) * dim * glow;
    float highlight = exp(-pow((s + 0.4) / 0.22, 2.0)) * dim * 0.9 * glow;
    // Spread over the bright part (in the Ribbons palette: pink, yellow, green and cyan for four;
    // pink and cyan for two).
    float index = bright(0.25 + 0.75 * float(i) / max(1.0, count - 1.0));
    // Sheen: the colour drifts along each tube, rather than one flat colour.
    index = clamp(index + p_sheen * 0.16 * sin((a - turn) * 2.0 + time * 0.5 + float(i) * 1.9), 0.25, 1.0);
    tube[i] = vec4(shade, shade * index, highlight, 0.0);
    depths[i] = z;
  }
  // From the farthest tube to the nearest: each covers what is behind it.
  for (int pass = 0; pass < MAX_RIBBONS; pass++) {
    int far = -1;
    float farthest = 9.0;
    for (int i = 0; i < MAX_RIBBONS; i++) {
      if (depths[i] < farthest) {
        far = i;
        farthest = depths[i];
      }
    }
    if (far < 0) break;
    state = mix(state, tube[far], cover[far]);
    depths[far] = 10.0;
  }
  color = state;
}`;

const STEP_SHADERS: Record<KaleidoSceneId, string> = {
  vortex: VORTEX,
  crystal: CRYSTAL,
  ribbons: RIBBONS,
};

/**
 * A state of the frame's shape, as exports begun with an older version kept it, drawn into the
 * state as it is now: where the frame lies, and dark around it.
 */
const REFRAME = `${FRAGMENT_HEADER}
uniform sampler2D framed;
uniform vec2 extent;
uniform float frameAspect;

void main() {
  vec2 p = (uv - 0.5) * 2.0 * extent;
  vec2 source = p / vec2(frameAspect, 1.0) * 0.5 + 0.5;
  bool inside = all(greaterThanEqual(source, vec2(0.0))) && all(lessThanEqual(source, vec2(1.0)));
  color = inside ? texture(framed, source) : vec4(0.0);
}`;

/**
 * The state at a new reach: what it held where it reached before, and dark beyond (the flow
 * fills that in), so a new zoom keeps the picture.
 */
const RESCALE = `${FRAGMENT_HEADER}
uniform sampler2D state;
uniform float reach;
uniform float before;

void main() {
  vec2 p = (uv - 0.5) * 2.0 * reach;
  vec2 source = p / before * 0.5 + 0.5;
  bool inside = all(greaterThanEqual(source, vec2(0.0))) && all(lessThanEqual(source, vec2(1.0)));
  color = inside ? texture(state, source) : vec4(0.0);
}`;

const COMPOSITE = `${FRAGMENT_HEADER}
uniform sampler2D previousState;
uniform sampler2D latestState;
uniform float blend;
uniform sampler2D palette;
uniform vec2 resolution;
/** What the state covers (see the steps). */
uniform vec2 extent;
uniform float angle;
uniform float hue;
uniform vec3 coreColor;
uniform float coreGlow;
uniform float p_segments;
uniform float p_mirror;
uniform float p_zoom;
uniform float p_centerX;
uniform float p_centerY;
uniform float p_haze;

const float TAU = 6.28318530718;

vec3 hueRotate(vec3 c, float amount) {
  const vec3 k = vec3(0.57735027);
  float cosine = cos(amount);
  return c * cosine + cross(k, c) * sin(amount) + k * dot(k, c) * (1.0 - cosine);
}

void main() {
  vec2 aspect = vec2(resolution.x / resolution.y, 1.0);
  vec2 p = (uv - 0.5) * 2.0 * aspect - vec2(p_centerX, p_centerY) * 2.0 * aspect;
  float r = length(p) / p_zoom;
  float a = atan(p.y, p.x) + angle;
  if (p_segments > 1.5) {
    // Fold into segments; mirrored segments have no seams.
    float segment = TAU / p_segments;
    a = mod(a, segment);
    if (p_mirror > 0.5) a = abs(a - segment * 0.5);
  }
  vec2 q = vec2(cos(a), sin(a)) * r;
  vec2 source = q / extent * 0.5 + 0.5;
  // Beyond the state (zoomed out far, or moved off centre) fade out softly, not at an edge.
  vec2 inside = smoothstep(vec2(-0.02), vec2(0.04), source) * smoothstep(vec2(-0.02), vec2(0.04), 1.0 - source);
  vec4 state = mix(texture(previousState, source), texture(latestState, source), blend) * inside.x * inside.y;
  // Accumulated light saturates softly instead of blowing out; the brightest parts move to
  // the bright end of the palette (bright edges).
  float intensity = 1.0 - exp(-1.6 * state.r);
  float index = clamp(state.g / max(state.r, 1e-5), 0.0, 1.0);
  index = mix(index, 1.0, smoothstep(2.0, 6.0, state.r));
  vec3 tint = max(hueRotate(texture(palette, vec2(index, 0.5)).rgb, hue), 0.0);
  vec3 c = tint * intensity + vec3(1.0 - exp(-state.b));
  // Haze: a faint light in the dark, in the palette's darkest colours, brighter towards the
  // centre: the picture does not sit on black.
  vec3 hazeColor = max(hueRotate(texture(palette, vec2(0.12, 0.5)).rgb, hue), 0.0);
  c += hazeColor * p_haze * 0.45 * (0.3 + 0.7 * exp(-dot(p, p) * 0.4));
  // The core glow is drawn on top, not fed back.
  float d = length(p);
  c += coreColor * coreGlow * (exp(-d * d / 0.0012) * 1.5 + exp(-d * d / 0.02) * 0.35);
  color = vec4(c, 1.0);
}`;

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

export class KaleidoscopeScene implements Scene {
  readonly floatTargets: boolean;
  private readonly gl: WebGL2RenderingContext;
  private readonly triangle: WebGLVertexArrayObject;
  private readonly steps: Record<KaleidoSceneId, Program>;
  private readonly composite: Program;
  private readonly reframe: Program;
  private readonly rescaleProgram: Program;
  private readonly post: PostProcessing;
  private readonly paletteTexture: WebGLTexture;
  private readonly stepper = new FixedStepper(STEPS_PER_SECOND);
  private settings: KaleidoSettings = DEFAULT_KALEIDO;
  /** The colours of the covers heard (VE-12) for the gradient; null: the look's own. */
  private coverColors: CoverColors | null = null;
  private paletteKey = '';
  private width = 1;
  private height = 1;
  /** The side of the feedback buffers (pixels): a square around the frame. */
  private stateSize = 1;
  /** Half that side at zoom 1 in the middle of the frame, in units of half its height. */
  private baseReach = 1;
  /** Half that side now: further out when zoomed out or off centre (see viewReach). */
  private reach = 1;
  /** Feedback buffers: [previous step, latest step]. */
  private states: [Target, Target] | null = null;
  private scene: Target | null = null;
  private frameCount = 0;
  private simulationTime = 0;
  private angle = 0;
  private hue = 0;
  private beats = 0;
  private paletteTarget = 0;
  private paletteOffset = 0;
  /** A kick or beat arrived and has not been simulated yet. */
  private kickPending = false;
  private beatPending = false;

  private readonly drives = {
    kick: new Follower(0.008, 0.16),
    snare: new Follower(0.008, 0.14),
    hat: new Follower(0.004, 0.08),
    bass: new Follower(0.03, 0.3),
    energy: new Follower(0.08, 0.6),
    treble: new Follower(0.03, 0.25),
    beat: new Follower(0.005, 0.12),
  };

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.floatTargets = supportsFloatTargets(gl);
    this.triangle = createFullscreenTriangle(gl);
    this.steps = Object.fromEntries(
      Object.entries(STEP_SHADERS).map(([id, source]) => [
        id,
        new Program(gl, FULLSCREEN_VERTEX, source),
      ]),
    ) as Record<KaleidoSceneId, Program>;
    this.composite = new Program(gl, FULLSCREEN_VERTEX, COMPOSITE);
    this.reframe = new Program(gl, FULLSCREEN_VERTEX, REFRAME);
    this.rescaleProgram = new Program(gl, FULLSCREEN_VERTEX, RESCALE);
    this.post = new PostProcessing(gl, this.floatTargets);
    this.paletteTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, PALETTE_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    setSampling(gl, gl.LINEAR, gl.CLAMP_TO_EDGE);
    this.updatePalette();
  }

  /** Reduce flashing (VE-06): sudden jumps in brightness are damped. */
  setReduceFlashing(on: boolean): void {
    this.post.setReduceFlashing(on);
  }

  setSettings(settings: KaleidoSettings): void {
    const sceneChanged = settings.scene !== this.settings.scene;
    this.settings = settings;
    this.updatePalette();
    if (sceneChanged) this.clear();
  }

  /** The gradient takes the colours of the covers heard (VE-12); null: the look's own. */
  setCoverColors(colors: CoverColors | null): void {
    this.coverColors = colors;
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height && this.scene) return;
    const gl = this.gl;
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    // The feedback runs on a square around the circle that the frame's corners turn on, at the
    // frame's pixel density (less only beyond the largest size): the spin turns the frame on
    // it, and never shows its edge (a turning rectangle).
    const square = stateSquare(
      this.width,
      this.height,
      gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    );
    this.stateSize = square.side;
    this.baseReach = square.reach;
    // New buffers start dark: they take the reach of the view at once.
    this.reach = nextReach(this.baseReach, this.neededReach(), this.baseReach);
    deleteTarget(gl, this.scene);
    if (this.states) for (const target of this.states) deleteTarget(gl, target);
    this.scene = createTarget(gl, this.width, this.height, this.floatTargets);
    this.states = [
      createTarget(gl, this.stateSize, this.stateSize, this.floatTargets),
      createTarget(gl, this.stateSize, this.stateSize, this.floatTargets),
    ];
    this.post.resize(this.width, this.height);
  }

  render(input: SceneInput): void {
    const scene = this.draw(input);
    if (!scene) return;
    this.post.present(
      scene,
      this.settings.common['bloom'] as number,
      this.width,
      this.height,
      this.frameCount,
      NO_CAMERA,
      Math.min(Math.max(input.dt, 0), 0.25),
    );
    this.gl.bindVertexArray(null);
  }

  /**
   * Draws the picture as a layer behind another scene (VE-08): the same steps, without the
   * bloom and the output. Returns its texture (the size set by resize).
   */
  renderLayer(input: SceneInput): WebGLTexture | null {
    const scene = this.draw(input);
    this.gl.bindVertexArray(null);
    return scene?.texture ?? null;
  }

  /** The simulation steps and the composite into the scene target (null: no size yet). */
  private draw(input: SceneInput): Target | null {
    const gl = this.gl;
    const states = this.states;
    const scene = this.scene;
    if (!states || !scene) return null;
    this.frameCount++;
    const { features } = input;
    const common = this.settings.common;
    const dt = Math.min(Math.max(input.dt, 0), 0.25);

    // New bar (every fourth beat): step the colours (KA-08).
    if (features[F.beatHit] === 1) {
      this.beats++;
      this.beatPending = true;
      if (this.beats % 4 === 0) this.paletteTarget += common['barShift'] as number;
    }
    if (features[F.kickHit] === 1) this.kickPending = true;

    // The covers' colours blend from frame to frame.
    this.updatePalette();
    gl.bindVertexArray(this.triangle);
    gl.disable(gl.BLEND);
    this.fitView();
    const count = this.stepper.advance(dt);
    for (let i = 0; i < count; i++) this.simulate(features);

    // Display: fold, colour and interpolate between the last two steps.
    this.angle += ((common['spin'] as number) / 60) * Math.PI * 2 * dt;
    this.hue = nextHue(this.hue, common['hueCycle'] as number, dt);
    const coreScene = this.settings.scene === 'vortex';
    const params = this.settings.scenes.vortex;
    const [cr, cg, cb] = parseColor(params['coreColor'] as string);
    const coreGlow = coreScene
      ? (params['core'] as number) *
        (0.6 + 0.8 * this.drives.kick.value + 0.4 * this.drives.bass.value)
      : 0;
    bindTarget(gl, scene, this.width, this.height);
    this.composite
      .use()
      .texture('previousState', states[0].texture, 0)
      .texture('latestState', states[1].texture, 1)
      .texture('palette', this.paletteTexture, 2)
      .float('blend', this.stepper.blend)
      .vec2('resolution', this.width, this.height)
      .vec2('extent', this.reach, this.reach)
      .float('angle', this.angle)
      .float('hue', this.hue)
      .vec3('coreColor', cr, cg, cb)
      .float('coreGlow', coreGlow);
    this.setParams(this.composite, COMMON_PARAMS, common);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    return scene;
  }

  saveState(): SceneSnapshot {
    const values: SceneSnapshot['values'] = {
      frameCount: this.frameCount,
      simulationTime: this.simulationTime,
      angle: this.angle,
      hue: this.hue,
      reach: this.reach,
      beats: this.beats,
      paletteTarget: this.paletteTarget,
      paletteOffset: this.paletteOffset,
      kickPending: this.kickPending,
      beatPending: this.beatPending,
      pending: this.stepper.pendingTime,
    };
    for (const [name, follower] of Object.entries(this.drives))
      values[`drive.${name}`] = follower.value;
    const buffers = this.states
      ? this.states.map((target) => readTarget(this.gl, target, this.floatTargets))
      : [];
    const calm = this.post.saveState();
    values['calm'] = calm !== null;
    if (calm) buffers.push(calm);
    return { values, buffers };
  }

  restoreState(snapshot: SceneSnapshot): void {
    const { values, buffers } = snapshot;
    const calm = values['calm'] === true;
    if (!this.states || buffers.length !== (calm ? 3 : 2)) {
      throw new Error('Snapshot does not match the Kaleidoscope scene');
    }
    // The reach the buffers were simulated at; a snapshot from before views had one at zoom 1.
    const reach = values['reach'];
    this.reach = typeof reach === 'number' ? reach : this.baseReach;
    for (const [k, target] of this.states.entries()) {
      const buffer = buffers[k]!;
      if (
        buffer.length === this.width * this.height * 4 &&
        buffer.length !== target.width * target.height * 4
      ) {
        this.restoreFramed(buffer, target);
      } else {
        writeTarget(this.gl, target, buffer);
      }
    }
    this.frameCount = Number(values['frameCount']);
    this.simulationTime = Number(values['simulationTime']);
    this.angle = Number(values['angle']);
    this.hue = Number(values['hue']);
    this.beats = Number(values['beats']);
    this.paletteTarget = Number(values['paletteTarget']);
    this.paletteOffset = Number(values['paletteOffset']);
    this.kickPending = values['kickPending'] === true;
    this.beatPending = values['beatPending'] === true;
    this.stepper.pendingTime = Number(values['pending']);
    for (const [name, follower] of Object.entries(this.drives)) {
      follower.value = Number(values[`drive.${name}`]);
    }
    this.post.restoreState(calm ? buffers[2] : null);
  }

  dispose(): void {
    const gl = this.gl;
    this.post.dispose();
    deleteTarget(gl, this.scene);
    if (this.states) for (const target of this.states) deleteTarget(gl, target);
    gl.deleteTexture(this.paletteTexture);
  }

  /** One fixed step of the feedback, into the older buffer, which then becomes the latest. */
  private simulate(features: Float32Array): void {
    const gl = this.gl;
    const states = this.states!;
    const step = this.stepper.step;
    const common = this.settings.common;
    const reactivity = common['reactivity'] as number;
    const d = this.drives;
    const drive = (follower: Follower, value: number) =>
      Math.min(2, follower.update(value, step) * reactivity);
    const kick = drive(d.kick, features[F.kick]!);
    const snare = drive(d.snare, features[F.snare]!);
    const hat = drive(d.hat, features[F.hat]!);
    const bass = drive(d.bass, 0.5 * features[F.bands]! + 0.5 * features[F.bands + 1]!);
    const energy = drive(d.energy, features[F.energy]!);
    const treble = drive(d.treble, features[F.bands + 5]!);
    const beat = drive(d.beat, features[F.beat]!);
    this.paletteOffset += (this.paletteTarget - this.paletteOffset) * (1 - Math.exp(-step / 0.5));
    this.simulationTime += step;

    const [previous, latest] = states;
    const program = this.steps[this.settings.scene];
    bindTarget(gl, previous, this.stateSize, this.stateSize);
    program
      .use()
      .texture('previous', latest.texture, 0)
      .vec2('resolution', this.stateSize, this.stateSize)
      .vec2('extent', this.reach, this.reach)
      .float('frameAspect', this.width / this.height)
      .float('time', this.simulationTime)
      .float('dt', step)
      .float('kick', kick)
      .float('snare', snare)
      .float('hat', hat)
      .float('bass', bass)
      .float('energy', energy)
      .float('treble', treble)
      .float('beat', beat)
      .float('kickPulse', this.kickPending ? Math.min(1, reactivity) : 0)
      .float('beatPulse', this.beatPending ? Math.min(1, reactivity) : 0)
      .float('paletteOffset', this.paletteOffset % 1);
    this.kickPending = false;
    this.beatPending = false;
    this.setParams(program, COMMON_PARAMS, common);
    const scene = sceneById(this.settings.scene);
    this.setParams(program, scene.params, this.settings.scenes[scene.id]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.states = [latest, previous];
  }

  /** How far the state must reach for the zoom and the centre of the look. */
  private neededReach(): number {
    const common = this.settings.common;
    return Math.max(
      this.baseReach,
      viewReach(
        this.width / this.height,
        common['zoom'] as number,
        common['centerX'] as number,
        common['centerY'] as number,
      ),
    );
  }

  /** Redraws the state at the reach the view needs, when that changed. */
  private fitView(): void {
    const reach = nextReach(this.baseReach, this.neededReach(), this.reach);
    if (Math.abs(reach - this.reach) < 1e-9 || !this.states) return;
    const gl = this.gl;
    this.states = this.states.map((target) => {
      const fresh = createTarget(gl, this.stateSize, this.stateSize, this.floatTargets);
      bindTarget(gl, fresh, this.stateSize, this.stateSize);
      this.rescaleProgram
        .use()
        .texture('state', target.texture, 0)
        .float('reach', reach)
        .float('before', this.reach);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      deleteTarget(gl, target);
      return fresh;
    }) as [Target, Target];
    this.reach = reach;
  }

  /** Passes numbers and switches as uniforms named p_<key> (KA-01). */
  private setParams(
    program: Program,
    specs: readonly ParamSpec[],
    values: Record<string, unknown>,
  ): void {
    for (const spec of specs) {
      const value = values[spec.key];
      if (spec.kind === 'number') program.float(`p_${spec.key}`, value as number);
      else if (spec.kind === 'boolean') program.float(`p_${spec.key}`, value ? 1 : 0);
      else if (spec.kind === 'color') {
        const [r, g, b] = parseColor(value as string);
        program.vec3(`p_${spec.key}`, r, g, b);
      }
    }
  }

  /** Renders the gradient into the palette texture when it changed. */
  private updatePalette(): void {
    const colors = coverBlend(
      this.coverColors,
      gradientColors(this.settings),
      (cover) => cover.gradient,
    );
    const key = colors.join();
    if (key === this.paletteKey) return;
    this.paletteKey = key;
    const stops = colors.map(parseColor);
    const data = new Uint8Array(PALETTE_SIZE * 4);
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const position = (i / (PALETTE_SIZE - 1)) * (stops.length - 1);
      const index = Math.min(stops.length - 2, Math.floor(position));
      const t = position - index;
      const a = stops[index]!;
      const b = stops[index + 1]!;
      for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round((a[c]! + (b[c]! - a[c]!) * t) * 255);
      data[i * 4 + 3] = 255;
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PALETTE_SIZE, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  /** Clears the feedback (when switching scenes). */
  /** A buffer of the frame's shape (an export begun with an older version) into `target`. */
  private restoreFramed(buffer: SnapshotBuffer, target: Target): void {
    const gl = this.gl;
    const framed = createTarget(gl, this.width, this.height, this.floatTargets);
    try {
      writeTarget(gl, framed, buffer);
      bindTarget(gl, target, this.stateSize, this.stateSize);
      gl.bindVertexArray(this.triangle);
      gl.disable(gl.BLEND);
      this.reframe
        .use()
        .texture('framed', framed.texture, 0)
        .vec2('extent', this.reach, this.reach)
        .float('frameAspect', this.width / this.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    } finally {
      deleteTarget(gl, framed);
    }
  }

  private clear(): void {
    const gl = this.gl;
    if (!this.states) return;
    for (const target of this.states) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.stepper.reset();
  }
}
