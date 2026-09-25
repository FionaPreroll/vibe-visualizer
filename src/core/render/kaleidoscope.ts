import { F } from '../analysis/features';
import {
  bindTarget,
  createFullscreenTriangle,
  createTarget,
  deleteTarget,
  FRAGMENT_HEADER,
  FULLSCREEN_VERTEX,
  Program,
  setSampling,
  supportsFloatTargets,
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
import { PostProcessing } from './post';
import { FixedStepper, type Scene, type SceneInput } from './scene';
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
uniform vec2 resolution;
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
/** Centred coordinates: y from -1 to 1, x scaled by the aspect ratio. */
vec2 centred(vec2 uv, vec2 aspect) {
  return (uv - 0.5) * 2.0 * aspect;
}
/** The previous state at centred position q, faded by the trails and towards the buffer edge. */
vec4 fetch(vec2 q, vec2 aspect) {
  vec2 source = q / aspect * 0.5 + 0.5;
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
  vec2 aspect = vec2(resolution.x / resolution.y, 1.0);
  vec2 p = centred(uv, aspect);
  float r = length(p);

  // Where the light now at p came from: pulled in (flow < 0) or pushed out, twisted, swirled
  // faster near the core, and frayed by fine turbulence into fibres.
  float flow = p_flow * (1.0 + 1.5 * kick);
  float scale = exp(-flow * 0.8 * dt);
  float turn = (p_twist * 1.2 + p_swirl * 0.9 / (0.25 + r)) * (1.0 + 0.6 * bass) * dt;
  vec2 q = rotation(turn) * p * scale;
  vec2 turbulence = vec2(gnoise(q * 9.0 + time * 0.3), gnoise(q * 9.0 - time * 0.3 + 13.7)) - 0.5;
  q += turbulence * p_fiber * 0.004;
  vec4 state = fetch(q, aspect);
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
  vec2 aspect = vec2(resolution.x / resolution.y, 1.0);
  vec2 p = centred(uv, aspect);
  float r = length(p);
  float a = atan(p.y, p.x);

  // Pushed outward (flow > 0) with a slight twist: shards stretch into streaks.
  float flow = p_flow * (1.0 + 1.2 * kick);
  vec2 q = rotation(p_twist * 0.8 * dt) * p * exp(-flow * 0.9 * dt);
  vec4 state = fetch(q, aspect);

  // A pulsing star outline in the centre; the outward flow turns it into a tunnel of stars.
  float size = p_starSize;
  float spikes = pow(0.5 + 0.5 * cos(p_points * a), 3.0);
  float edge = size * mix(0.5, 1.0, spikes);
  float outline = exp(-pow((r - edge) / 0.014, 2.0));
  // One star per kick and per beat: separate glowing stars travel outward.
  float light = outline * (0.03 + 0.08 * energy + 18.0 * kickPulse + 8.0 * beatPulse) * p_intensity;
  float index = 0.62;

  // Crystal shards: sharp angular ridges just outside the star.
  vec2 around = vec2(cos(a), sin(a));
  float ridge = 1.0 - abs(2.0 * gnoise(around * (6.0 + 18.0 * p_shards) + vec2(time * 0.3, r * 3.0)) - 1.0);
  float shardBand = smoothstep(size * 1.1, size * 1.4, r) * (1.0 - smoothstep(size * 1.6, size * 2.4, r));
  float shard = pow(ridge, 12.0) * shardBand * p_shards * (0.12 + 0.45 * energy + 2.5 * snare) * p_intensity;
  light += shard;
  index = mix(index, 0.4 + 0.35 * noise(around * 3.0 + time * 0.1), shard / max(light, 1e-4));
  light *= dt * 4.0;

  // Sparks fly out from the star on the hi-hats: round dots with a cyan colour.
  vec2 grid = p * 40.0;
  vec2 local = fract(grid) - 0.5;
  float cell = hash(floor(grid) + floor(time * 20.0) * 1.37);
  float spark = hat * p_sparks * step(0.99, cell) * exp(-dot(local, local) * 40.0);
  spark *= smoothstep(size * 2.5, size, r) * 1.5;
  float sparkIndex = 0.93;
  float total = light + spark * 0.5;
  float mixedIndex = fract((light * index + spark * 0.5 * sparkIndex) / max(total, 1e-4) + paletteOffset);
  color = state + vec4(total, total * mixedIndex, spark * 0.6, 0.0);
}`;

const STEP_SHADERS: Record<KaleidoSceneId, string> = { vortex: VORTEX, crystal: CRYSTAL };

const COMPOSITE = `${FRAGMENT_HEADER}
uniform sampler2D previousState;
uniform sampler2D latestState;
uniform float blend;
uniform sampler2D palette;
uniform vec2 resolution;
uniform float angle;
uniform float hue;
uniform vec3 coreColor;
uniform float coreGlow;
uniform float p_segments;
uniform float p_mirror;
uniform float p_zoom;
uniform float p_centerX;
uniform float p_centerY;

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
  vec2 source = q / aspect * 0.5 + 0.5;
  // Beyond the feedback buffer (far corners) fade out softly instead of a hard edge.
  vec2 inside = smoothstep(vec2(-0.02), vec2(0.04), source) * smoothstep(vec2(-0.02), vec2(0.04), 1.0 - source);
  vec4 state = mix(texture(previousState, source), texture(latestState, source), blend) * inside.x * inside.y;
  // Accumulated light saturates softly instead of blowing out; the brightest parts move to
  // the bright end of the palette (bright edges).
  float intensity = 1.0 - exp(-1.6 * state.r);
  float index = clamp(state.g / max(state.r, 1e-5), 0.0, 1.0);
  index = mix(index, 1.0, smoothstep(2.0, 6.0, state.r));
  vec3 tint = max(hueRotate(texture(palette, vec2(index, 0.5)).rgb, hue), 0.0);
  vec3 c = tint * intensity + vec3(1.0 - exp(-state.b));
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
  private readonly post: PostProcessing;
  private readonly paletteTexture: WebGLTexture;
  private readonly stepper = new FixedStepper(STEPS_PER_SECOND);
  private settings: KaleidoSettings = DEFAULT_KALEIDO;
  private paletteKey = '';
  private width = 1;
  private height = 1;
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
    this.steps = {
      vortex: new Program(gl, FULLSCREEN_VERTEX, STEP_SHADERS.vortex),
      crystal: new Program(gl, FULLSCREEN_VERTEX, STEP_SHADERS.crystal),
    };
    this.composite = new Program(gl, FULLSCREEN_VERTEX, COMPOSITE);
    this.post = new PostProcessing(gl, this.floatTargets);
    this.paletteTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, PALETTE_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    setSampling(gl, gl.LINEAR, gl.CLAMP_TO_EDGE);
    this.updatePalette();
  }

  setSettings(settings: KaleidoSettings): void {
    const sceneChanged = settings.scene !== this.settings.scene;
    this.settings = settings;
    this.updatePalette();
    if (sceneChanged) this.clear();
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height && this.scene) return;
    const gl = this.gl;
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    deleteTarget(gl, this.scene);
    if (this.states) for (const target of this.states) deleteTarget(gl, target);
    this.scene = createTarget(gl, this.width, this.height, this.floatTargets);
    this.states = [
      createTarget(gl, this.width, this.height, this.floatTargets),
      createTarget(gl, this.width, this.height, this.floatTargets),
    ];
    this.post.resize(this.width, this.height);
  }

  render(input: SceneInput): void {
    const gl = this.gl;
    const states = this.states;
    const scene = this.scene;
    if (!states || !scene) return;
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

    gl.bindVertexArray(this.triangle);
    gl.disable(gl.BLEND);
    const count = this.stepper.advance(dt);
    for (let i = 0; i < count; i++) this.simulate(features);

    // Display: fold, colour and interpolate between the last two steps.
    this.angle += ((common['spin'] as number) / 60) * Math.PI * 2 * dt;
    this.hue += ((common['hueCycle'] as number) / 60) * Math.PI * 2 * dt;
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
      .float('angle', this.angle)
      .float('hue', this.hue)
      .vec3('coreColor', cr, cg, cb)
      .float('coreGlow', coreGlow);
    this.setParams(this.composite, COMMON_PARAMS, common);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.post.present(scene, common['bloom'] as number, this.width, this.height, this.frameCount);
    gl.bindVertexArray(null);
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
    bindTarget(gl, previous, this.width, this.height);
    program
      .use()
      .texture('previous', latest.texture, 0)
      .vec2('resolution', this.width, this.height)
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
    const colors = gradientColors(this.settings);
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
